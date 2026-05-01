import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, IsNull, ILike, Repository } from 'typeorm';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../enums/user-role.enum';
import { EmailType } from '../../enums/email-type.enum';
import { QueueService } from '../../queue/queue.service';
import { CryptoPaymentsService } from './crypto-payments.service';
import { CryptoOrderService } from './crypto-order.service';
import {
  QuoteCryptoPaymentDto,
  ConfirmCryptoPaymentDto,
  SetSolanaWalletDto,
  GrantCryptoSellerDto,
  SetSellerOverrideFeeDto,
  UpdateMarketplaceConfigDto,
  UpsertSellerGroupDto,
  SetSellerGroupDto,
  BuyerWaiverDto,
  WithdrawTreasuryDto,
} from './dto/crypto-payments.dto';

interface RequestWithUser {
  user: User;
}

/** Buyer-facing endpoints: quote + confirm crypto payment for an order. */
@Controller('crypto')
@UseGuards(JwtAuthGuard)
export class CryptoPaymentsController {
  private readonly logger = new Logger(CryptoPaymentsController.name);

  constructor(
    private readonly orderService: CryptoOrderService,
    private readonly crypto: CryptoPaymentsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /** Public-ish config so the web client can build a wallet provider. */
  @Get('config')
  async config() {
    // Best-effort marketplace fetch so the client can hide / disable the
    // crypto checkout option when admins have paused on-chain sales. Falls
    // back to `paused: false` if the RPC call fails so the endpoint never
    // throws on the public path.
    let paused = false;
    try {
      const m = await this.crypto.getMarketplaceConfig();
      paused = m.paused;
    } catch {
      /* swallow */
    }
    return {
      programId: this.crypto.programIdString,
      paymentMint: this.crypto.usdcMintString,
      treasuryAta: this.crypto.treasuryAtaString,
      paused,
    };
  }

  @Post('quote')
  async quote(
    @Request() req: RequestWithUser,
    @Body() dto: QuoteCryptoPaymentDto,
  ) {
    return this.orderService.quote({
      orderId: dto.orderId,
      buyerUserId: req.user.id,
      buyerWallet: dto.buyerWallet,
    });
  }

  @Post('confirm')
  async confirm(
    @Request() req: RequestWithUser,
    @Body() dto: ConfirmCryptoPaymentDto,
  ) {
    return this.orderService.confirm({
      orderId: dto.orderId,
      buyerUserId: req.user.id,
      txSignature: dto.txSignature,
      buyerWallet: dto.buyerWallet,
    });
  }

  /**
   * Logged-in user sets/clears their Solana wallet. If the user has already
   * been approved by an admin to accept crypto payments
   * (`cryptoPaymentsEnabled = true`) but doesn't yet have an on-chain
   * allowance PDA, this also fires `grant_crypto_seller` so they can
   * immediately receive payments without further admin action.
   */
  @Patch('me/wallet')
  async setMyWallet(
    @Request() req: RequestWithUser,
    @Body() dto: SetSolanaWalletDto,
  ) {
    const newWallet = dto.walletAddress ?? null;
    await this.userRepo.update(
      { id: req.user.id },
      { solanaWallet: newWallet },
    );

    let txSignature: string | null = null;
    let alreadyOnChain = false;

    // Auto-grant on-chain allowance for pre-approved sellers.
    if (newWallet && req.user.cryptoPaymentsEnabled) {
      try {
        alreadyOnChain = await this.crypto.hasCryptoAllowance(newWallet);
        if (!alreadyOnChain) {
          txSignature = await this.crypto.grantCryptoSeller(newWallet);
        }
      } catch (err) {
        this.logger.warn(
          `Failed to auto-grant crypto seller for ${newWallet}: ${
            (err as Error)?.message
          }`,
        );
      }
    }

    return {
      ok: true,
      solanaWallet: newWallet,
      txSignature,
      alreadyOnChain,
    };
  }
}

/** Admin endpoints: manage seller crypto allowance + fee overrides. */
@Controller('admin/crypto')
@UseGuards(JwtAuthGuard)
export class AdminCryptoPaymentsController {
  private readonly logger = new Logger(AdminCryptoPaymentsController.name);

  constructor(
    private readonly crypto: CryptoPaymentsService,
    private readonly queueService: QueueService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private ensureAdmin(user: User) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }
  }

  /**
   * List users that have a Solana wallet on file. Used by the admin
   * `Crypto Sellers` tab — the legacy `GET /admin/users` endpoint paginates
   * to 10 by default and requires JSON-stringified filter/range params, so
   * crypto sellers were getting truncated out of the response. This is a
   * dedicated, narrow query that returns just the fields the UI needs.
   */
  @Get('sellers')
  async listCryptoSellers(
    @Request() req: RequestWithUser,
    @Query('search') search?: string,
  ) {
    this.ensureAdmin(req.user);
    const trimmed = (search ?? '').trim();
    const baseWhere = { solanaWallet: Not(IsNull()) } as Record<
      string,
      unknown
    >;
    const where = trimmed
      ? [
          { ...baseWhere, username: ILike(`%${trimmed}%`) },
          { ...baseWhere, email: ILike(`%${trimmed}%`) },
          { ...baseWhere, name: ILike(`%${trimmed}%`) },
        ]
      : baseWhere;

    const rows = await this.userRepo.find({
      where: where as never,
      select: [
        'id',
        'username',
        'email',
        'name',
        'isSeller',
        'solanaWallet',
        'cryptoPaymentsEnabled',
        'cryptoOverrideFeeBps',
      ],
      order: { cryptoPaymentsEnabled: 'DESC', username: 'ASC' },
      take: 200,
    });

    // Resolve on-chain group + fee in parallel. We don't fail the whole list
    // if a single lookup throws — just leave the seller's group fields null
    // and let the UI render "—".
    const enriched = await Promise.all(
      rows.map(async (u) => {
        let onChain: Awaited<
          ReturnType<typeof this.crypto.getSellerFeeStatus>
        > | null = null;
        if (u.solanaWallet) {
          try {
            onChain = await this.crypto.getSellerFeeStatus(u.solanaWallet);
          } catch (err) {
            this.logger.warn(
              `getSellerFeeStatus(${u.solanaWallet}) failed: ${(err as Error)?.message}`,
            );
          }
        }
        return {
          id: u.id,
          username: u.username,
          email: u.email,
          name: u.name,
          isSeller: !!u.isSeller,
          solanaWallet: u.solanaWallet ?? null,
          cryptoPaymentsEnabled: !!u.cryptoPaymentsEnabled,
          cryptoOverrideFeeBps:
            u.cryptoOverrideFeeBps !== null &&
            u.cryptoOverrideFeeBps !== undefined
              ? Number(u.cryptoOverrideFeeBps)
              : null,
          // On-chain group/fee snapshot (null if no wallet or RPC failed).
          onChainGroupId: onChain?.groupId ?? null,
          onChainGroupLabel: onChain?.groupLabel ?? null,
          onChainGroupFeeBps: onChain?.groupFeeBps ?? null,
          onChainOverrideFeeBps: onChain?.overrideFeeBps ?? null,
          onChainEffectiveFeeBps: onChain?.effectiveFeeBps ?? null,
          onChainProfileExists: onChain?.profileExists ?? false,
          onChainIsDefaultGroup: onChain?.isDefaultGroup ?? null,
        };
      }),
    );

    return { data: enriched, total: enriched.length };
  }

  /**
   * Approve a seller to accept crypto payments WITHOUT requiring their wallet
   * up front. Sets the DB flag and emails them a CardCade-styled approval
   * message. The on-chain allowance is granted later, automatically, the
   * first time the seller links their Solana wallet via `/crypto/me/wallet`.
   */
  @Post('sellers/:userId/approve')
  async approveSeller(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
  ) {
    this.ensureAdmin(req.user);
    if (!userId) {
      throw new BadRequestException('userId is required (path param)');
    }
    const target = await this.userRepo.findOne({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');

    const wasNewlyEnabled = !target.cryptoPaymentsEnabled;

    if (wasNewlyEnabled) {
      await this.userRepo.update(
        { id: target.id },
        { cryptoPaymentsEnabled: true },
      );
    }

    // If they already have a wallet on file, grant on-chain right now so they
    // don't have to log out and back in.
    let txSignature: string | null = null;
    let alreadyOnChain = false;
    if (target.solanaWallet) {
      try {
        alreadyOnChain = await this.crypto.hasCryptoAllowance(
          target.solanaWallet,
        );
        if (!alreadyOnChain) {
          txSignature = await this.crypto.grantCryptoSeller(
            target.solanaWallet,
          );
        }
      } catch (err) {
        this.logger.warn(
          `approveSeller: on-chain grant failed for ${target.solanaWallet}: ${
            (err as Error)?.message
          }`,
        );
      }
    }

    let emailSent = false;
    if (wasNewlyEnabled && target.email) {
      try {
        const host = (
          this.configService.get<string>('email.HOST_URL') ||
          this.configService.get<string>('APP_HOST_URL') ||
          ''
        ).replace(/\/$/, '');
        const settingsCryptoLink = `${host}/profile/settings#crypto`;

        await this.queueService.addEmailJob(
          {
            toAddress: [target.email],
            subject:
              'You\u2019re approved to accept crypto payments on CardCade',
            params: {
              username: target.username || 'there',
              settingsCryptoLink,
            },
          } as never,
          EmailType.CryptoEnabled,
        );
        emailSent = true;
      } catch (err) {
        this.logger.warn(
          `Failed to dispatch crypto_enabled email to ${target.email}: ${
            (err as Error)?.message
          }`,
        );
      }
    }

    return {
      ok: true,
      wasNewlyEnabled,
      emailSent,
      hasWalletOnFile: !!target.solanaWallet,
      txSignature,
      alreadyOnChain,
    };
  }

  /** Grant a user permission to receive crypto payments (on-chain + DB flag). */
  @Post('sellers/:userId/enable')
  async enableSeller(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body() dto: GrantCryptoSellerDto,
  ) {
    this.ensureAdmin(req.user);
    if (!userId) {
      throw new BadRequestException('userId is required (path param)');
    }
    const target = await this.userRepo.findOne({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');

    // Ensure their wallet matches what admin is granting.
    if (!target.solanaWallet) {
      await this.userRepo.update(
        { id: target.id },
        { solanaWallet: dto.sellerWallet },
      );
    } else if (target.solanaWallet !== dto.sellerWallet) {
      throw new BadRequestException(
        `User wallet (${target.solanaWallet}) does not match supplied sellerWallet`,
      );
    }

    let txSig: string | null = null;
    const already = await this.crypto.hasCryptoAllowance(dto.sellerWallet);
    if (!already) {
      txSig = await this.crypto.grantCryptoSeller(dto.sellerWallet);
    }

    await this.userRepo.update(
      { id: target.id },
      { cryptoPaymentsEnabled: true },
    );
    return { ok: true, txSignature: txSig, alreadyOnChain: already };
  }

  /** Revoke crypto seller permission (closes on-chain allowance + clears DB flag). */
  @Post('sellers/:userId/disable')
  async disableSeller(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body() body: { sellerWallet?: string },
  ) {
    this.ensureAdmin(req.user);
    const target = await this.userRepo.findOne({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');

    // Prefer the body wallet (admin override), fall back to the user's
    // on-file wallet. If neither exists, just clear the DB flag.
    const wallet =
      (body.sellerWallet && body.sellerWallet.trim()) ||
      target.solanaWallet ||
      null;

    let txSig: string | null = null;
    let removedOnChain = false;
    if (wallet) {
      try {
        const has = await this.crypto.hasCryptoAllowance(wallet);
        if (has) {
          txSig = await this.crypto.revokeCryptoSeller(wallet);
          removedOnChain = true;
        }
      } catch (err) {
        this.logger.warn(
          `disableSeller: on-chain revoke failed for ${wallet}: ${
            (err as Error)?.message
          }`,
        );
      }
    }

    await this.userRepo.update(
      { id: target.id },
      { cryptoPaymentsEnabled: false, cryptoOverrideFeeBps: null },
    );
    return { ok: true, txSignature: txSig, removedOnChain };
  }

  /** Set or clear a per-seller fee override (basis points). */
  @Patch('sellers/:userId/fee')
  async setOverrideFee(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body() dto: SetSellerOverrideFeeDto,
  ) {
    this.ensureAdmin(req.user);
    const target = await this.userRepo.findOne({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');

    const bps = dto.overrideFeeBps ?? null;
    const txSig = await this.crypto.setSellerOverrideFee(dto.sellerWallet, bps);
    await this.userRepo.update(
      { id: target.id },
      { cryptoOverrideFeeBps: bps },
    );
    return { ok: true, txSignature: txSig, overrideFeeBps: bps };
  }

  // ─── Marketplace config ──────────────────────────────────────────
  /** Read-only: current on-chain marketplace config. */
  @Get('marketplace')
  async getMarketplace(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    this.crypto.invalidateMarketplaceCache();
    const cfg = await this.crypto.getMarketplaceConfig();
    return {
      programId: this.crypto.programIdString,
      paymentMint: this.crypto.usdcMintString,
      treasuryAta: this.crypto.treasuryAtaString,
      authority: cfg.authority.toBase58(),
      treasury: cfg.treasury.toBase58(),
      buyerFeeBps: cfg.buyerFeeBps,
      defaultSellerFeeBps: cfg.defaultSellerFeeBps,
      paused: cfg.paused,
    };
  }

  /**
   * Update one or more marketplace config fields. Each provided field
   * triggers its own on-chain instruction; partial successes are reported.
   */
  @Patch('marketplace')
  async updateMarketplace(
    @Request() req: RequestWithUser,
    @Body() dto: UpdateMarketplaceConfigDto,
  ) {
    this.ensureAdmin(req.user);
    const results: Record<string, string> = {};
    if (dto.buyerFeeBps !== undefined) {
      results.buyerFeeBps = await this.crypto.updateBuyerFee(dto.buyerFeeBps);
    }
    if (dto.defaultSellerFeeBps !== undefined) {
      results.defaultSellerFeeBps = await this.crypto.updateDefaultSellerFee(
        dto.defaultSellerFeeBps,
      );
    }
    if (dto.treasury !== undefined) {
      results.treasury = await this.crypto.updateTreasury(dto.treasury);
    }
    if (dto.authority !== undefined) {
      results.authority = await this.crypto.updateAuthority(dto.authority);
    }
    if (dto.paused !== undefined) {
      results.paused = await this.crypto.setPaused(dto.paused);
    }
    return { ok: true, txSignatures: results };
  }

  // ─── Seller groups ────────────────────────────────────────────────
  /** List every on-chain SellerGroup (id, label, fee). */
  @Get('groups')
  async listGroups(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    const groups = await this.crypto.listSellerGroups();
    return { data: groups, total: groups.length };
  }

  /** Create or update a SellerGroup tier. */
  @Post('groups')
  async upsertGroup(
    @Request() req: RequestWithUser,
    @Body() dto: UpsertSellerGroupDto,
  ) {
    this.ensureAdmin(req.user);
    const txSig = await this.crypto.upsertSellerGroup(
      dto.groupId,
      dto.feeBps,
      dto.label,
    );
    return { ok: true, txSignature: txSig, groupId: dto.groupId };
  }

  /** Move a seller into a group (creates SellerProfile on first assign). */
  @Post('sellers/:userId/group')
  async setSellerGroup(
    @Request() req: RequestWithUser,
    @Param('userId') userId: string,
    @Body() dto: SetSellerGroupDto,
  ) {
    this.ensureAdmin(req.user);
    const target = await this.userRepo.findOne({ where: { id: userId } });
    if (!target) throw new NotFoundException('User not found');
    if (target.solanaWallet && target.solanaWallet !== dto.sellerWallet) {
      throw new BadRequestException(
        `User wallet (${target.solanaWallet}) does not match supplied sellerWallet`,
      );
    }
    const txSig = await this.crypto.setSellerGroup(
      dto.sellerWallet,
      dto.groupId,
    );
    return { ok: true, txSignature: txSig, groupId: dto.groupId };
  }

  // ─── Buyer waivers ────────────────────────────────────────────────
  /** List every on-chain BuyerWaiver. */
  @Get('waivers')
  async listWaivers(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    const rows = await this.crypto.listBuyerWaivers();
    // Best-effort join with users by solanaWallet so the UI can show names.
    const wallets = rows.map((r) => r.buyer);
    const users = wallets.length
      ? await this.userRepo.find({
          where: wallets.map((w) => ({ solanaWallet: w })) as never,
          select: ['id', 'username', 'email', 'solanaWallet'],
        })
      : [];
    const byWallet = new Map(users.map((u) => [u.solanaWallet, u]));
    return {
      data: rows.map((r) => {
        const u = byWallet.get(r.buyer);
        return {
          ...r,
          user: u ? { id: u.id, username: u.username, email: u.email } : null,
        };
      }),
      total: rows.length,
    };
  }

  /** Grant a buyer fee waiver. */
  @Post('waivers')
  async grantWaiver(
    @Request() req: RequestWithUser,
    @Body() dto: BuyerWaiverDto,
  ) {
    this.ensureAdmin(req.user);
    const txSig = await this.crypto.grantBuyerWaiver(dto.buyerWallet);
    return { ok: true, txSignature: txSig };
  }

  /** Revoke a buyer fee waiver (closes the PDA). */
  @Post('waivers/:buyerWallet/revoke')
  async revokeWaiver(
    @Request() req: RequestWithUser,
    @Param('buyerWallet') buyerWallet: string,
  ) {
    this.ensureAdmin(req.user);
    if (!buyerWallet) {
      throw new BadRequestException('buyerWallet is required (path param)');
    }
    const txSig = await this.crypto.revokeBuyerWaiver(buyerWallet);
    return { ok: true, txSignature: txSig };
  }

  // ─── Treasury ──────────────────────────────────────────────────────
  /**
   * Read-only: USDC + SOL snapshot of the treasury ATA and its owner. Used
   * by the admin Treasury card to decide whether withdrawals are possible.
   */
  @Get('treasury')
  async getTreasury(@Request() req: RequestWithUser) {
    this.ensureAdmin(req.user);
    return this.crypto.getTreasuryStatus();
  }

  /**
   * Withdraw USDC from the treasury ATA to a destination wallet. The
   * destination's USDC ATA is auto-created if needed (~0.002 SOL rent paid
   * by the treasury signer). Requires CARDCADE_TREASURY_SECRET_BASE58 (or
   * the authority key, used as a fallback signer in dev).
   */
  @Post('treasury/withdraw')
  async withdrawTreasury(
    @Request() req: RequestWithUser,
    @Body() dto: WithdrawTreasuryDto,
  ) {
    this.ensureAdmin(req.user);
    let amount: bigint;
    try {
      amount = BigInt(dto.amountBaseUnits);
    } catch {
      throw new BadRequestException(
        'amountBaseUnits must be a u64-compatible integer string',
      );
    }
    if (amount <= 0n) {
      throw new BadRequestException('amountBaseUnits must be > 0');
    }
    const r = await this.crypto.withdrawTreasuryUsdc(
      dto.destinationWallet,
      amount,
    );
    return { ok: true, ...r, amountBaseUnits: amount.toString() };
  }
}
