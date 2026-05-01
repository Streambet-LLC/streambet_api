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
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
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
