import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  config() {
    return {
      programId: this.crypto.programIdString,
      paymentMint: this.crypto.usdcMintString,
      treasuryAta: this.crypto.treasuryAtaString,
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
}
