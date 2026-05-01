/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const bs58Raw = require('bs58');
const bs58: {
  decode: (s: string) => Uint8Array;
  encode: (b: Uint8Array) => string;
} = bs58Raw.default ?? bs58Raw;
import {
  marketplacePda,
  sellerProfilePda,
  sellerGroupPda,
  buyerWaiverPda,
  cryptoSellerAllowancePda,
  invoicePda,
  randomInvoiceId,
  DEFAULT_SELLER_GROUP_ID,
  INVOICE_ID_LEN,
} from './pdas';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const idl = require('./idl.json');

/**
 * Quote returned to the web client; includes everything the wallet needs to
 * build the pay_invoice transaction and what the client should display.
 */
export interface CryptoPaymentQuote {
  invoiceId: string; // hex (32 chars)
  amount: string; // USDC base units (6 decimals) as string for u64 safety
  shipping: string;
  buyerFeeBps: number;
  sellerFeeBps: number;
  buyerFee: string;
  sellerFee: string;
  totalBuyerPays: string;
  programId: string;
  paymentMint: string;
  sellerWallet: string;
  treasuryAta: string;
  marketplacePda: string;
  sellerProfilePda: string;
  sellerGroupPda: string;
  buyerWaiverPda: string;
  cryptoSellerAllowancePda: string;
  invoicePda: string;
  sellerIsAuthority: boolean;
  sellerOverridden: boolean;
}

/**
 * Result of verifying an on-chain pay_invoice tx for an order.
 */
export interface CryptoPaymentVerification {
  ok: boolean;
  txSignature: string;
  invoiceId: string; // hex
  buyerWallet: string;
  sellerWallet: string;
  amount: string;
  reason?: string; // populated when ok=false
}

/**
 * Wraps the deployed Cardcade marketplace contract. Holds an Anchor provider
 * built from the marketplace authority keypair (env), and exposes high-level
 * methods used by the prize/admin services.
 */
@Injectable()
export class CryptoPaymentsService implements OnModuleInit {
  private readonly logger = new Logger(CryptoPaymentsService.name);
  private connection!: Connection;
  private authorityKp!: Keypair;
  /**
   * Treasury signer. Defaults to the authority keypair when
   * `CARDCADE_TREASURY_SECRET_BASE58` is not provided (matches the devnet
   * setup where authority and treasury are the same wallet). Used to sign
   * USDC withdrawals from the treasury ATA.
   */
  private treasuryKp?: Keypair;
  private provider!: anchor.AnchorProvider;
  private program!: anchor.Program;
  private programId!: PublicKey;
  private paymentMint!: PublicKey;
  private treasuryAta!: PublicKey;
  private marketplaceAddr!: PublicKey;
  private cachedMarketplace?: {
    authority: PublicKey;
    treasury: PublicKey;
    paymentMint: PublicKey;
    buyerFeeBps: number;
    defaultSellerFeeBps: number;
    paused: boolean;
  };

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const rpcUrl = this.config.get<string>('solana.rpcUrl');
    const programIdStr = this.config.get<string>('solana.programId');
    const usdcMintStr = this.config.get<string>('solana.usdcMint');
    const treasuryAtaStr = this.config.get<string>('solana.treasuryAta');
    const authBase58 = this.config.get<string>('solana.authoritySecretBase58');

    if (!rpcUrl || !programIdStr || !usdcMintStr) {
      this.logger.warn(
        'Solana config incomplete; CryptoPaymentsService will be inert.',
      );
      return;
    }
    if (!authBase58) {
      this.logger.warn(
        'CARDCADE_AUTHORITY_SECRET_BASE58 not set; admin instructions will fail.',
      );
    }

    this.connection = new Connection(rpcUrl, 'confirmed');
    this.programId = new PublicKey(programIdStr);
    this.paymentMint = new PublicKey(usdcMintStr);

    if (authBase58) {
      const secret = bs58.decode(authBase58);
      if (secret.length !== 64) {
        throw new Error(
          `CARDCADE_AUTHORITY_SECRET_BASE58 must decode to 64 bytes, got ${secret.length}`,
        );
      }
      this.authorityKp = Keypair.fromSecretKey(secret);
    } else {
      // Read-only mode — generate ephemeral key, won't be used for signing.
      this.authorityKp = Keypair.generate();
    }

    const treasuryBase58 = this.config.get<string>(
      'solana.treasurySecretBase58',
    );
    if (treasuryBase58) {
      const tSecret = bs58.decode(treasuryBase58);
      if (tSecret.length !== 64) {
        throw new Error(
          `CARDCADE_TREASURY_SECRET_BASE58 must decode to 64 bytes, got ${tSecret.length}`,
        );
      }
      this.treasuryKp = Keypair.fromSecretKey(tSecret);
    } else if (authBase58) {
      // Fall back to authority keypair (devnet setup).
      this.treasuryKp = this.authorityKp;
    }

    const wallet = new anchor.Wallet(this.authorityKp);
    this.provider = new anchor.AnchorProvider(this.connection, wallet, {
      commitment: 'confirmed',
    });
    this.program = new anchor.Program(idl as anchor.Idl, this.provider);

    [this.marketplaceAddr] = marketplacePda(this.programId);

    if (treasuryAtaStr) {
      this.treasuryAta = new PublicKey(treasuryAtaStr);
    } else {
      // Derive from authority + USDC mint.
      this.treasuryAta = await getAssociatedTokenAddress(
        this.paymentMint,
        this.authorityKp.publicKey,
      );
    }

    this.logger.log(
      `Cardcade ready: program=${this.programId.toBase58()} marketplace=${this.marketplaceAddr.toBase58()} authority=${this.authorityKp.publicKey.toBase58()}`,
    );

    // Warm cache.
    void this.getMarketplaceConfig().catch((e) =>
      this.logger.warn(`Failed to fetch marketplace config: ${e.message}`),
    );
  }

  /** Fetch (and cache) the on-chain Marketplace account. */
  async getMarketplaceConfig(): Promise<
    NonNullable<typeof this.cachedMarketplace>
  > {
    if (this.cachedMarketplace) return this.cachedMarketplace;
    const acct: any = await (this.program.account as any).marketplace.fetch(
      this.marketplaceAddr,
    );
    this.cachedMarketplace = {
      authority: acct.authority as PublicKey,
      treasury: acct.treasury as PublicKey,
      paymentMint: acct.paymentMint as PublicKey,
      buyerFeeBps: Number(acct.buyerFeeBps),
      defaultSellerFeeBps: Number(acct.defaultSellerFeeBps),
      paused: !!acct.paused,
    };
    return this.cachedMarketplace;
  }

  /** Force re-fetch of the cached marketplace config. */
  invalidateMarketplaceCache(): void {
    this.cachedMarketplace = undefined;
  }

  /**
   * Resolve a seller's on-chain fee status: which `SellerGroup` they're in,
   * that group's label + base fee, and any per-seller override. Used by the
   * admin Crypto Sellers tab so each row can render
   * `"Group <label> · X.XX%"` (or `"Override · X.XX%"`).
   *
   * Returns `null` for the group when no SellerProfile exists yet (the
   * seller hasn't been assigned to anything, so the marketplace
   * `default_seller_fee_bps` is what would apply at quote time).
   */
  async getSellerFeeStatus(sellerWallet: string): Promise<{
    profileExists: boolean;
    groupId: number;
    groupLabel: string | null;
    groupFeeBps: number;
    overrideFeeBps: number | null;
    /** profile.override_fee_bps ?? group.fee_bps */
    effectiveFeeBps: number;
    isDefaultGroup: boolean;
  }> {
    const seller = new PublicKey(sellerWallet);
    const market = await this.getMarketplaceConfig();
    const [profileAddr] = sellerProfilePda(this.programId, seller);

    let profileExists = false;
    let groupId = DEFAULT_SELLER_GROUP_ID;
    let overrideFeeBps: number | null = null;
    try {
      const profile: any = await (
        this.program.account as any
      ).sellerProfile.fetch(profileAddr);
      profileExists = true;
      groupId = Number(profile.groupId);
      overrideFeeBps =
        profile.overrideFeeBps !== null && profile.overrideFeeBps !== undefined
          ? Number(profile.overrideFeeBps)
          : null;
    } catch {
      // No profile on-chain yet → fall back to default group view.
    }

    let groupFeeBps = market.defaultSellerFeeBps;
    let groupLabel: string | null = null;
    try {
      const [groupAddr] = sellerGroupPda(this.programId, groupId);
      const group: any = await (this.program.account as any).sellerGroup.fetch(
        groupAddr,
      );
      groupFeeBps = Number(group.feeBps);
      groupLabel = decodeGroupLabel(group.label);
    } catch {
      // Group account missing — keep marketplace default.
    }

    const effectiveFeeBps = overrideFeeBps ?? groupFeeBps;
    return {
      profileExists,
      groupId,
      groupLabel,
      groupFeeBps,
      overrideFeeBps,
      effectiveFeeBps,
      isDefaultGroup: groupId === DEFAULT_SELLER_GROUP_ID,
    };
  }

  /**
   * Build a payment quote for a given seller + amount. Used by the prize
   * service when a buyer chooses crypto checkout. Does NOT submit anything
   * on-chain.
   */
  async buildQuote(input: {
    sellerWallet: string;
    buyerWallet: string;
    amountBaseUnits: bigint; // USDC 1e6
    shippingBaseUnits: bigint;
  }): Promise<CryptoPaymentQuote> {
    const seller = new PublicKey(input.sellerWallet);
    const buyer = new PublicKey(input.buyerWallet);

    const market = await this.getMarketplaceConfig();
    const sellerIsAuthority = seller.equals(market.authority);

    // Resolve seller fee: profile.override_fee_bps ?? group.fee_bps.
    let sellerFeeBps = market.defaultSellerFeeBps;
    let groupId = DEFAULT_SELLER_GROUP_ID;
    let sellerOverridden = false;
    const [profileAddr] = sellerProfilePda(this.programId, seller);
    try {
      const profile: any = await (
        this.program.account as any
      ).sellerProfile.fetch(profileAddr);
      groupId = Number(profile.groupId);
      if (
        profile.overrideFeeBps !== null &&
        profile.overrideFeeBps !== undefined
      ) {
        sellerFeeBps = Number(profile.overrideFeeBps);
        sellerOverridden = true;
      } else {
        const [groupAddr] = sellerGroupPda(this.programId, groupId);
        const group: any = await (
          this.program.account as any
        ).sellerGroup.fetch(groupAddr);
        sellerFeeBps = Number(group.feeBps);
      }
    } catch {
      // No profile — fall back to default group.
    }
    const [groupAddr] = sellerGroupPda(this.programId, groupId);

    // Buyer fee — waiver check.
    let buyerFeeBps = market.buyerFeeBps;
    const [waiverAddr] = buyerWaiverPda(this.programId, buyer);
    const waiverInfo = await this.connection.getAccountInfo(waiverAddr);
    const isWaived =
      waiverInfo !== null && waiverInfo.owner.equals(this.programId);
    if (isWaived) buyerFeeBps = 0;

    // Compute fees on amount only (shipping passes through).
    const buyerFee = (input.amountBaseUnits * BigInt(buyerFeeBps)) / 10000n;
    const sellerFee = (input.amountBaseUnits * BigInt(sellerFeeBps)) / 10000n;
    const totalBuyerPays =
      input.amountBaseUnits + input.shippingBaseUnits + buyerFee;

    const invIdBuf = randomInvoiceId();
    const [invAddr] = invoicePda(this.programId, invIdBuf);
    const [allowanceAddr] = cryptoSellerAllowancePda(this.programId, seller);

    return {
      invoiceId: invIdBuf.toString('hex'),
      amount: input.amountBaseUnits.toString(),
      shipping: input.shippingBaseUnits.toString(),
      buyerFeeBps,
      sellerFeeBps,
      buyerFee: buyerFee.toString(),
      sellerFee: sellerFee.toString(),
      totalBuyerPays: totalBuyerPays.toString(),
      programId: this.programId.toBase58(),
      paymentMint: this.paymentMint.toBase58(),
      sellerWallet: seller.toBase58(),
      treasuryAta: this.treasuryAta.toBase58(),
      marketplacePda: this.marketplaceAddr.toBase58(),
      sellerProfilePda: profileAddr.toBase58(),
      sellerGroupPda: groupAddr.toBase58(),
      buyerWaiverPda: waiverAddr.toBase58(),
      cryptoSellerAllowancePda: allowanceAddr.toBase58(),
      invoicePda: invAddr.toBase58(),
      sellerIsAuthority,
      sellerOverridden,
    };
  }

  /**
   * Verify an on-chain pay_invoice tx by signature. Confirms it called this
   * program with the right invoice_id, buyer, seller, and amount. Returns
   * a structured verdict; never throws.
   */
  async verifyPaymentTx(input: {
    txSignature: string;
    expectedInvoiceIdHex: string;
    expectedSellerWallet: string;
    expectedBuyerWallet?: string;
    expectedAmount: bigint;
  }): Promise<CryptoPaymentVerification> {
    const fail = (reason: string): CryptoPaymentVerification => ({
      ok: false,
      reason,
      txSignature: input.txSignature,
      invoiceId: input.expectedInvoiceIdHex,
      buyerWallet: input.expectedBuyerWallet ?? '',
      sellerWallet: input.expectedSellerWallet,
      amount: input.expectedAmount.toString(),
    });

    let parsed: ParsedTransactionWithMeta | null;
    try {
      parsed = await this.connection.getParsedTransaction(input.txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
    } catch (e: any) {
      return fail(`RPC error: ${e.message}`);
    }
    if (!parsed) return fail('tx not found');
    if (parsed.meta?.err)
      return fail(`tx failed on-chain: ${JSON.stringify(parsed.meta.err)}`);

    // Look for an instruction targeting our program.
    const ixs = parsed.transaction.message.instructions as any[];
    const programIdStr = this.programId.toBase58();
    const programIxs = ixs.filter(
      (ix) => ix.programId?.toBase58?.() === programIdStr,
    );
    if (programIxs.length === 0) {
      return fail('tx did not invoke the cardcade program');
    }

    // Verify the Invoice PDA was created (single-use receipt).
    const expectedInvIdBuf = Buffer.from(input.expectedInvoiceIdHex, 'hex');
    if (expectedInvIdBuf.length !== INVOICE_ID_LEN) {
      return fail(`invalid invoice_id length ${expectedInvIdBuf.length}`);
    }
    const [expectedInvAddr] = invoicePda(this.programId, expectedInvIdBuf);

    // Fetch the Invoice account; if it exists and matches, the tx is good.
    let invoiceAcct: any;
    try {
      invoiceAcct = await (this.program.account as any).invoice.fetch(
        expectedInvAddr,
      );
    } catch (e: any) {
      return fail(
        `invoice account not found / not owned by program: ${e.message}`,
      );
    }

    const invoiceIdOnChain = Buffer.from(invoiceAcct.invoiceId).toString('hex');
    if (invoiceIdOnChain !== input.expectedInvoiceIdHex) {
      return fail(
        `invoice_id mismatch: chain=${invoiceIdOnChain} expected=${input.expectedInvoiceIdHex}`,
      );
    }
    const sellerOnChain = (invoiceAcct.seller as PublicKey).toBase58();
    if (sellerOnChain !== input.expectedSellerWallet) {
      return fail(
        `seller mismatch: chain=${sellerOnChain} expected=${input.expectedSellerWallet}`,
      );
    }
    const buyerOnChain = (invoiceAcct.buyer as PublicKey).toBase58();
    if (
      input.expectedBuyerWallet &&
      buyerOnChain !== input.expectedBuyerWallet
    ) {
      return fail(
        `buyer mismatch: chain=${buyerOnChain} expected=${input.expectedBuyerWallet}`,
      );
    }
    const amountOnChain = BigInt(invoiceAcct.amount.toString());
    if (amountOnChain !== input.expectedAmount) {
      return fail(
        `amount mismatch: chain=${amountOnChain} expected=${input.expectedAmount}`,
      );
    }

    return {
      ok: true,
      txSignature: input.txSignature,
      invoiceId: invoiceIdOnChain,
      buyerWallet: buyerOnChain,
      sellerWallet: sellerOnChain,
      amount: amountOnChain.toString(),
    };
  }

  /**
   * Admin: grant a seller permission to receive crypto payments. Creates
   * the CryptoSellerAllowance PDA. Idempotent only at the contract level —
   * a re-grant of an existing allowance will fail.
   */
  async grantCryptoSeller(sellerWallet: string): Promise<string> {
    const seller = new PublicKey(sellerWallet);
    const [allowance] = cryptoSellerAllowancePda(this.programId, seller);
    const sig = await (this.program.methods as any)
      .grantCryptoSeller()
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        seller,
        allowance,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(`grant_crypto_seller(${sellerWallet}) tx=${sig}`);
    return sig;
  }

  /** Admin: revoke crypto seller permission, closing the allowance PDA. */
  async revokeCryptoSeller(sellerWallet: string): Promise<string> {
    const seller = new PublicKey(sellerWallet);
    const [allowance] = cryptoSellerAllowancePda(this.programId, seller);
    const sig = await (this.program.methods as any)
      .revokeCryptoSeller()
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        seller,
        allowance,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(`revoke_crypto_seller(${sellerWallet}) tx=${sig}`);
    return sig;
  }

  /**
   * Admin: set or clear an individualized fee override for a seller.
   * Pass `null` to clear and fall back to the seller's group fee.
   */
  async setSellerOverrideFee(
    sellerWallet: string,
    overrideFeeBps: number | null,
  ): Promise<string> {
    const seller = new PublicKey(sellerWallet);
    const [profile] = sellerProfilePda(this.programId, seller);
    const sig = await (this.program.methods as any)
      .setSellerOverrideFee(overrideFeeBps)
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        seller,
        profile,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(
      `set_seller_override_fee(${sellerWallet}, ${overrideFeeBps}) tx=${sig}`,
    );
    return sig;
  }

  /** Check if a seller currently holds a CryptoSellerAllowance on-chain. */
  async hasCryptoAllowance(sellerWallet: string): Promise<boolean> {
    const seller = new PublicKey(sellerWallet);
    const market = await this.getMarketplaceConfig();
    if (seller.equals(market.authority)) return true; // implicit
    const [addr] = cryptoSellerAllowancePda(this.programId, seller);
    const info = await this.connection.getAccountInfo(addr);
    return info !== null && info.owner.equals(this.programId);
  }

  // ─── Treasury (admin) ──────────────────────────────────────────────
  /** True if we hold a treasury signer secret in env (or fall back to authority). */
  get canSignTreasury(): boolean {
    return !!this.treasuryKp;
  }

  /**
   * Admin read: USDC balance of the configured treasury ATA + native SOL
   * balance of the owner wallet (used for paying gas on withdrawals).
   * Returns nulls for fields that fail to fetch instead of throwing.
   */
  async getTreasuryStatus(): Promise<{
    treasuryAta: string;
    treasuryOwner: string | null;
    treasurySignerLoaded: boolean;
    treasurySignerMatchesOwner: boolean | null;
    usdcBalance: string | null; // base units (u64)
    usdcBalanceUi: number | null;
    decimals: number;
    ownerSolLamports: number | null;
  }> {
    const decimals = 6;
    let usdcBalance: string | null = null;
    let usdcBalanceUi: number | null = null;
    let owner: PublicKey | null = null;
    try {
      const acct = await getAccount(this.connection, this.treasuryAta);
      usdcBalance = acct.amount.toString();
      usdcBalanceUi = Number(acct.amount) / 10 ** decimals;
      owner = acct.owner;
    } catch (e) {
      this.logger.warn(
        `getAccount(treasuryAta) failed: ${(e as Error).message}`,
      );
    }

    let ownerSolLamports: number | null = null;
    if (owner) {
      try {
        ownerSolLamports = await this.connection.getBalance(owner);
      } catch (e) {
        this.logger.warn(
          `getBalance(treasury owner) failed: ${(e as Error).message}`,
        );
      }
    }

    const signerMatches =
      owner && this.treasuryKp ? owner.equals(this.treasuryKp.publicKey) : null;

    return {
      treasuryAta: this.treasuryAta.toBase58(),
      treasuryOwner: owner ? owner.toBase58() : null,
      treasurySignerLoaded: !!this.treasuryKp,
      treasurySignerMatchesOwner: signerMatches,
      usdcBalance,
      usdcBalanceUi,
      decimals,
      ownerSolLamports,
    };
  }

  /**
   * Admin: withdraw USDC from the treasury ATA to an arbitrary destination
   * wallet. The destination's USDC ATA is auto-created (rent paid by the
   * treasury signer) if it doesn't already exist.
   *
   * `amountBaseUnits` is u64 base units (USDC has 6 decimals → 1 USDC = 1_000_000).
   */
  async withdrawTreasuryUsdc(
    destinationWallet: string,
    amountBaseUnits: bigint,
  ): Promise<{ txSignature: string; destinationAta: string }> {
    if (!this.treasuryKp) {
      throw new Error(
        'No treasury signer loaded (set CARDCADE_TREASURY_SECRET_BASE58 or CARDCADE_AUTHORITY_SECRET_BASE58)',
      );
    }
    if (amountBaseUnits <= 0n) {
      throw new Error('amountBaseUnits must be > 0');
    }
    const dest = new PublicKey(destinationWallet);

    // Verify on-chain that our signer actually owns the treasury ATA before
    // attempting the transfer — avoids cryptic SPL errors if env is wrong.
    const tAcct = await getAccount(this.connection, this.treasuryAta);
    if (!tAcct.owner.equals(this.treasuryKp.publicKey)) {
      throw new Error(
        `Treasury signer (${this.treasuryKp.publicKey.toBase58()}) does not own treasury ATA owner=${tAcct.owner.toBase58()}`,
      );
    }
    if (tAcct.amount < amountBaseUnits) {
      throw new Error(
        `Insufficient treasury USDC: have=${tAcct.amount.toString()} want=${amountBaseUnits.toString()}`,
      );
    }

    // getOrCreateAssociatedTokenAccount handles "create if missing" with the
    // treasury signer paying ~0.002 SOL of rent for new ATAs.
    const destAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.treasuryKp,
      this.paymentMint,
      dest,
      true, // allowOwnerOffCurve — be lenient about PDA destinations
    );

    const ix = createTransferCheckedInstruction(
      this.treasuryAta,
      this.paymentMint,
      destAta.address,
      this.treasuryKp.publicKey,
      amountBaseUnits,
      6,
    );
    const tx = new anchor.web3.Transaction().add(ix);
    const sig = await anchor.web3.sendAndConfirmTransaction(
      this.connection,
      tx,
      [this.treasuryKp],
      { commitment: 'confirmed' },
    );
    this.logger.log(
      `withdraw_treasury_usdc(${destinationWallet}, ${amountBaseUnits.toString()}) ata=${destAta.address.toBase58()} tx=${sig}`,
    );
    return { txSignature: sig, destinationAta: destAta.address.toBase58() };
  }

  // ─── Marketplace config (admin) ─────────────────────────────────────
  /** Admin: update buyer fee (basis points). */
  async updateBuyerFee(buyerFeeBps: number): Promise<string> {
    const sig = await (this.program.methods as any)
      .updateBuyerFee(buyerFeeBps)
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
      })
      .signers([this.authorityKp])
      .rpc();
    this.invalidateMarketplaceCache();
    this.logger.log(`update_buyer_fee(${buyerFeeBps}) tx=${sig}`);
    return sig;
  }

  /**
   * Admin: update marketplace `default_seller_fee_bps` (the fallback used
   * when a seller has no SellerProfile). NOTE: this does NOT mutate the
   * group-0 SellerGroup PDA — call `upsertSellerGroup(0, ...)` to keep them
   * aligned.
   */
  async updateDefaultSellerFee(defaultSellerFeeBps: number): Promise<string> {
    const sig = await (this.program.methods as any)
      .updateDefaultSellerFee(defaultSellerFeeBps)
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
      })
      .signers([this.authorityKp])
      .rpc();
    this.invalidateMarketplaceCache();
    this.logger.log(
      `update_default_seller_fee(${defaultSellerFeeBps}) tx=${sig}`,
    );
    return sig;
  }

  /** Admin: rotate the treasury wallet (USDC ATA recipient). */
  async updateTreasury(newTreasury: string): Promise<string> {
    const sig = await (this.program.methods as any)
      .updateTreasury(new PublicKey(newTreasury))
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
      })
      .signers([this.authorityKp])
      .rpc();
    this.invalidateMarketplaceCache();
    this.logger.log(`update_treasury(${newTreasury}) tx=${sig}`);
    return sig;
  }

  /**
   * Admin: rotate the on-chain authority. ⚠️ After this succeeds, the API's
   * `CARDCADE_AUTHORITY_SECRET_BASE58` must be rotated to the new key or
   * subsequent admin calls will fail with `UnauthorizedAuthority`.
   */
  async updateAuthority(newAuthority: string): Promise<string> {
    const sig = await (this.program.methods as any)
      .updateAuthority(new PublicKey(newAuthority))
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
      })
      .signers([this.authorityKp])
      .rpc();
    this.invalidateMarketplaceCache();
    this.logger.log(`update_authority(${newAuthority}) tx=${sig}`);
    return sig;
  }

  /** Admin: pause / unpause new payments + sales contract-wide. */
  async setPaused(paused: boolean): Promise<string> {
    const sig = await (this.program.methods as any)
      .setPaused(paused)
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
      })
      .signers([this.authorityKp])
      .rpc();
    this.invalidateMarketplaceCache();
    this.logger.log(`set_paused(${paused}) tx=${sig}`);
    return sig;
  }

  // ─── Seller groups (admin) ──────────────────────────────────────────
  /**
   * Admin: create-or-update a SellerGroup tier. `label` is encoded as a
   * NUL-padded 32-byte UTF-8 buffer. Group 0 is the implicit "default" tier.
   */
  async upsertSellerGroup(
    groupId: number,
    feeBps: number,
    label: string,
  ): Promise<string> {
    if (!Number.isInteger(groupId) || groupId < 0 || groupId > 255) {
      throw new Error(`groupId must be a u8 (0-255), got ${groupId}`);
    }
    const labelBuf = encodeGroupLabel(label);
    const [groupAddr] = sellerGroupPda(this.programId, groupId);
    const sig = await (this.program.methods as any)
      .upsertSellerGroup(groupId, feeBps, Array.from(labelBuf))
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        group: groupAddr,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(
      `upsert_seller_group(${groupId}, ${feeBps}, "${label}") tx=${sig}`,
    );
    return sig;
  }

  /**
   * Admin: assign / move a seller into an existing group. Creates the
   * SellerProfile PDA on first assignment.
   */
  async setSellerGroup(sellerWallet: string, groupId: number): Promise<string> {
    const seller = new PublicKey(sellerWallet);
    const [profile] = sellerProfilePda(this.programId, seller);
    const [group] = sellerGroupPda(this.programId, groupId);
    const sig = await (this.program.methods as any)
      .setSellerGroup(groupId)
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        seller,
        profile,
        group,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(`set_seller_group(${sellerWallet}, ${groupId}) tx=${sig}`);
    return sig;
  }

  /**
   * List every SellerGroup PDA on-chain. Used by the admin Groups panel.
   * Each row is `{ groupId, feeBps, label }` sorted by groupId ascending.
   */
  async listSellerGroups(): Promise<
    Array<{
      groupId: number;
      feeBps: number;
      label: string | null;
      pda: string;
    }>
  > {
    const all: any[] = await (this.program.account as any).sellerGroup.all();
    const rows = all.map((entry) => {
      const acct = entry.account;
      return {
        groupId: Number(acct.groupId),
        feeBps: Number(acct.feeBps),
        label: decodeGroupLabel(acct.label),
        pda: (entry.publicKey as PublicKey).toBase58(),
      };
    });
    rows.sort((a, b) => a.groupId - b.groupId);
    return rows;
  }

  // ─── Buyer fee waivers (admin) ──────────────────────────────────────
  /** Admin: grant a buyer a permanent fee waiver (sets buyer_fee to 0). */
  async grantBuyerWaiver(buyerWallet: string): Promise<string> {
    const buyer = new PublicKey(buyerWallet);
    const [waiver] = buyerWaiverPda(this.programId, buyer);
    const sig = await (this.program.methods as any)
      .grantBuyerWaiver()
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        buyer,
        waiver,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(`grant_buyer_waiver(${buyerWallet}) tx=${sig}`);
    return sig;
  }

  /** Admin: revoke a buyer's fee waiver (closes the waiver PDA). */
  async revokeBuyerWaiver(buyerWallet: string): Promise<string> {
    const buyer = new PublicKey(buyerWallet);
    const [waiver] = buyerWaiverPda(this.programId, buyer);
    const sig = await (this.program.methods as any)
      .revokeBuyerWaiver()
      .accountsPartial({
        authority: this.authorityKp.publicKey,
        marketplace: this.marketplaceAddr,
        buyer,
        waiver,
      })
      .signers([this.authorityKp])
      .rpc();
    this.logger.log(`revoke_buyer_waiver(${buyerWallet}) tx=${sig}`);
    return sig;
  }

  /** Quick check: does a buyer currently have a fee waiver on-chain? */
  async hasBuyerWaiver(buyerWallet: string): Promise<boolean> {
    const buyer = new PublicKey(buyerWallet);
    const [addr] = buyerWaiverPda(this.programId, buyer);
    const info = await this.connection.getAccountInfo(addr);
    return info !== null && info.owner.equals(this.programId);
  }

  /** List every BuyerWaiver PDA on-chain. */
  async listBuyerWaivers(): Promise<
    Array<{ buyer: string; grantedAt: number; pda: string }>
  > {
    const all: any[] = await (this.program.account as any).buyerWaiver.all();
    return all
      .map((entry) => ({
        buyer: (entry.account.buyer as PublicKey).toBase58(),
        grantedAt: Number(entry.account.grantedAt),
        pda: (entry.publicKey as PublicKey).toBase58(),
      }))
      .sort((a, b) => b.grantedAt - a.grantedAt);
  }

  /** Expose constants for callers (e.g. for response shaping). */
  get programIdString(): string {
    return this.programId.toBase58();
  }
  get treasuryAtaString(): string {
    return this.treasuryAta.toBase58();
  }
  get usdcMintString(): string {
    return this.paymentMint.toBase58();
  }
  get tokenProgramId(): PublicKey {
    return TOKEN_PROGRAM_ID;
  }
}

/**
 * On-chain `SellerGroup.label` is a fixed-size 32-byte UTF-8 buffer with
 * trailing NULs. Anchor decodes it as `number[]` (or `Buffer`); strip the
 * padding and return a plain string for display.
 */
/**
 * Encode a human label to the contract's fixed 32-byte UTF-8 buffer.
 * Truncates to fit; pads the remainder with NULs.
 */
function encodeGroupLabel(label: string): Buffer {
  const buf = Buffer.alloc(32);
  const src = Buffer.from((label ?? '').slice(0, 32), 'utf8');
  src.copy(buf, 0, 0, Math.min(src.length, 32));
  return buf;
}

function decodeGroupLabel(raw: unknown): string | null {
  if (raw == null) return null;
  let bytes: Buffer;
  if (Buffer.isBuffer(raw)) bytes = raw;
  else if (Array.isArray(raw)) bytes = Buffer.from(raw as number[]);
  else if (raw instanceof Uint8Array) bytes = Buffer.from(raw);
  else return null;
  const trimmed = bytes.subarray(
    0,
    bytes.findIndex((b) => b === 0) === -1
      ? bytes.length
      : bytes.findIndex((b) => b === 0),
  );
  const text = trimmed.toString('utf8').trim();
  return text.length > 0 ? text : null;
}
