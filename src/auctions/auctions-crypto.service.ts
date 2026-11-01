/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { usdToUsdcUnits, usdcUnitsToUsd } from './hermes.pricing';
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const bs58Raw = require('bs58');
const bs58: { decode: (s: string) => Uint8Array } = bs58Raw.default ?? bs58Raw;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const idl = require('./idl/hermes_auctions.json');

const MEMO_PROGRAM_ID = new PublicKey(
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
);

export interface HermesCryptoConfig {
  enabled: boolean;
  cluster: 'devnet' | 'mainnet-beta' | 'custom';
  programId: string | null;
  paymentMint: string | null;
  authority: string | null;
}

export interface DepositQuote {
  /** Base64 legacy transaction; the bidder's wallet signs + sends it. */
  transaction: string;
  escrow: string;
  vault: string;
  amountUnits: string;
}

/**
 * Wraps the `hermes-auctions` escrow program.
 *
 *  - The backend authority (same key as the marketplace authority) opens an
 *    on-chain auction lazily at the first USDC deposit, and signs refunds and
 *    the winner's settlement. It can never move escrow anywhere but back to
 *    the bidder or (settle) to the configured treasury.
 *  - Deposits are signed by the bidder. The server builds the transaction
 *    and adds a memo signed by the bidder wallet that binds it to the
 *    Hermes user, so nobody can claim someone else's escrow as their own.
 *  - Escrow balances are always read back from chain; client-reported
 *    amounts are never trusted.
 */
@Injectable()
export class AuctionsCryptoService implements OnModuleInit {
  private readonly logger = new Logger(AuctionsCryptoService.name);
  private connection: Connection | null = null;
  private authority: Keypair | null = null;
  private program: anchor.Program | null = null;
  private programId: PublicKey | null = null;
  private mint: PublicKey | null = null;
  private cluster: HermesCryptoConfig['cluster'] = 'custom';
  private memoSecret = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const rpcUrl = this.config.get<string>('solana.rpcUrl');
    const mint = this.config.get<string>('solana.usdcMint');
    const authBase58 = this.config.get<string>('solana.authoritySecretBase58');
    const programId =
      this.config.get<string>('HERMES_PROGRAM_ID') || idl.address || '';
    this.memoSecret =
      this.config.get<string>('JWT_SECRET') || authBase58 || 'hermes';

    if (!rpcUrl || !mint || !authBase58 || !programId) {
      this.logger.warn(
        'Hermes escrow not configured (RPC / mint / authority / program); USDC bidding disabled.',
      );
      return;
    }
    try {
      const secret = bs58.decode(authBase58);
      this.authority = Keypair.fromSecretKey(secret);
      this.connection = new Connection(rpcUrl, 'confirmed');
      this.programId = new PublicKey(programId);
      this.mint = new PublicKey(mint);
      this.cluster = /devnet/i.test(rpcUrl)
        ? 'devnet'
        : /mainnet/i.test(rpcUrl)
          ? 'mainnet-beta'
          : 'custom';
      const provider = new anchor.AnchorProvider(
        this.connection,
        new anchor.Wallet(this.authority),
        { commitment: 'confirmed' },
      );
      this.program = new anchor.Program(
        { ...idl, address: this.programId.toBase58() } as anchor.Idl,
        provider,
      );
      this.logger.log(
        `Hermes escrow client: program=${this.programId.toBase58()} cluster=${this.cluster} authority=${this.authority.publicKey.toBase58()}`,
      );
      void this.refreshReadiness();
    } catch (err) {
      this.logger.error(
        `Hermes escrow init failed; USDC bidding disabled: ${(err as Error).message}`,
      );
      this.program = null;
    }
  }

  /**
   * USDC bidding is only offered once the program's config exists and names
   * this backend as its authority — otherwise refunds/settles would fail.
   */
  private ready = false;
  private readyCheckedAt = 0;

  private async refreshReadiness(): Promise<boolean> {
    if (!this.program) return false;
    this.readyCheckedAt = Date.now();
    try {
      const cfg = await this.accounts().hermesConfig.fetchNullable(
        this.configPda(),
      );
      const ok =
        !!cfg &&
        (cfg.authority as PublicKey).equals(this.authority.publicKey) &&
        (cfg.paymentMint as PublicKey).equals(this.mint);
      if (ok !== this.ready) {
        this.logger.log(
          `Hermes escrow ${ok ? 'READY' : 'not ready'} (config ${cfg ? 'found' : 'missing'})`,
        );
      }
      this.ready = ok;
    } catch (err) {
      this.logger.warn(
        `Hermes readiness check failed: ${(err as Error).message}`,
      );
    }
    return this.ready;
  }

  isEnabled(): boolean {
    if (
      this.program &&
      !this.ready &&
      Date.now() - this.readyCheckedAt > 60_000
    ) {
      void this.refreshReadiness();
    }
    return !!this.program && this.ready;
  }

  publicConfig(): HermesCryptoConfig {
    return {
      enabled: this.isEnabled(),
      cluster: this.cluster,
      programId: this.programId?.toBase58() ?? null,
      paymentMint: this.mint?.toBase58() ?? null,
      authority: this.authority?.publicKey.toBase58() ?? null,
    };
  }

  // ───────────────────────────────────────────────────────────────────
  // PDAs
  // ───────────────────────────────────────────────────────────────────

  private require(): {
    program: anchor.Program;
    connection: Connection;
    authority: Keypair;
    programId: PublicKey;
    mint: PublicKey;
  } {
    if (!this.program) {
      throw new BadRequestException('USDC bidding is not available right now.');
    }
    return {
      program: this.program,
      connection: this.connection,
      authority: this.authority,
      programId: this.programId,
      mint: this.mint,
    };
  }

  /** Account clients by IDL name (the IDL JSON is loaded untyped). */
  private accounts(): Record<
    'hermesConfig' | 'hermesAuction' | 'bidEscrow',
    {
      fetch(addr: PublicKey): Promise<any>;
      fetchNullable(addr: PublicKey): Promise<any>;
    }
  > {
    return this.require().program.account as any;
  }

  static auctionIdBytes(auctionId: string): Buffer {
    const hex = auctionId.replace(/-/g, '');
    if (!/^[0-9a-f]{32}$/i.test(hex)) {
      throw new Error(`Invalid auction uuid: ${auctionId}`);
    }
    return Buffer.from(hex, 'hex');
  }

  configPda(): PublicKey {
    const { programId } = this.require();
    return PublicKey.findProgramAddressSync(
      [Buffer.from('hermes_config')],
      programId,
    )[0];
  }

  auctionPda(auctionId: string): PublicKey {
    const { programId } = this.require();
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('hermes_auction'),
        AuctionsCryptoService.auctionIdBytes(auctionId),
      ],
      programId,
    )[0];
  }

  escrowPda(auctionId: string, bidder: PublicKey): PublicKey {
    const { programId } = this.require();
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('hermes_escrow'),
        this.auctionPda(auctionId).toBuffer(),
        bidder.toBuffer(),
      ],
      programId,
    )[0];
  }

  private vaultFor(escrow: PublicKey): PublicKey {
    const { mint } = this.require();
    return getAssociatedTokenAddressSync(mint, escrow, true);
  }

  /** Deterministic per-(auction, user, wallet) memo — no storage needed. */
  depositMemo(auctionId: string, userId: string, wallet: string): string {
    const tag = createHmac('sha256', this.memoSecret)
      .update(`${auctionId}:${userId}:${wallet}`)
      .digest('hex')
      .slice(0, 24);
    return `hermes:${auctionId}:${tag}`;
  }

  // ───────────────────────────────────────────────────────────────────
  // Authority operations
  // ───────────────────────────────────────────────────────────────────

  /** Opens the on-chain auction if it isn't already. Returns its PDA. */
  async ensureAuctionOpened(auctionId: string, endsAt: Date): Promise<string> {
    const { program, authority } = this.require();
    const pda = this.auctionPda(auctionId);
    const existing = await this.accounts().hermesAuction.fetchNullable(pda);
    if (existing) return pda.toBase58();

    const refundAfter = Math.floor(
      (endsAt.getTime() + 7 * 24 * 60 * 60 * 1000) / 1000,
    );
    const sig = await program.methods
      .openAuction(
        Array.from(AuctionsCryptoService.auctionIdBytes(auctionId)),
        new anchor.BN(refundAfter),
      )
      .accountsPartial({
        authority: authority.publicKey,
        config: this.configPda(),
        auction: pda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    this.logger.log(
      `Opened on-chain auction ${auctionId} (${pda.toBase58()}) tx=${sig}`,
    );
    return pda.toBase58();
  }

  private async treasury(): Promise<PublicKey> {
    const cfg = await this.accounts().hermesConfig.fetch(this.configPda());
    return cfg.treasury as PublicKey;
  }

  /** Current escrow balance in USD (floored to the cent); null if closed. */
  async escrowBalanceUsd(
    auctionId: string,
    wallet: string,
  ): Promise<number | null> {
    const bidder = new PublicKey(wallet);
    const escrow = this.escrowPda(auctionId, bidder);
    const acct = await this.accounts().bidEscrow.fetchNullable(escrow);
    if (!acct) return null;
    if (!(acct.bidder as PublicKey).equals(bidder)) return null;
    return usdcUnitsToUsd(BigInt((acct.amount as anchor.BN).toString()));
  }

  /** Returns the escrow back to the bidder. Null if it was already closed. */
  async refund(auctionId: string, wallet: string): Promise<string | null> {
    const { program, authority, mint } = this.require();
    const bidder = new PublicKey(wallet);
    const escrow = this.escrowPda(auctionId, bidder);
    if (!(await this.accounts().bidEscrow.fetchNullable(escrow))) return null;
    const bidderToken = getAssociatedTokenAddressSync(mint, bidder);
    return program.methods
      .refund()
      .accountsPartial({
        authority: authority.publicKey,
        config: this.configPda(),
        auction: this.auctionPda(auctionId),
        escrow,
        escrowVault: this.vaultFor(escrow),
        bidder,
        bidderToken,
        paymentMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          bidderToken,
          bidder,
          mint,
        ),
      ])
      .rpc();
  }

  /** Pays `amountUsd` to the treasury and returns the rest to the winner. */
  async settle(
    auctionId: string,
    wallet: string,
    amountUsd: number,
  ): Promise<string> {
    const { program, authority, mint } = this.require();
    const bidder = new PublicKey(wallet);
    const escrow = this.escrowPda(auctionId, bidder);
    const bidderToken = getAssociatedTokenAddressSync(mint, bidder);
    return program.methods
      .settle(new anchor.BN(usdToUsdcUnits(amountUsd).toString()))
      .accountsPartial({
        authority: authority.publicKey,
        config: this.configPda(),
        auction: this.auctionPda(auctionId),
        escrow,
        escrowVault: this.vaultFor(escrow),
        bidder,
        bidderToken,
        treasury: await this.treasury(),
        paymentMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([
        createAssociatedTokenAccountIdempotentInstruction(
          authority.publicKey,
          bidderToken,
          bidder,
          mint,
        ),
      ])
      .rpc();
  }

  // ───────────────────────────────────────────────────────────────────
  // Bidder deposits
  // ───────────────────────────────────────────────────────────────────

  async buildDepositTx(params: {
    auctionId: string;
    userId: string;
    wallet: string;
    amountUsd: number;
  }): Promise<DepositQuote> {
    const { program, connection, mint } = this.require();
    const bidder = new PublicKey(params.wallet);
    const auction = this.auctionPda(params.auctionId);
    const escrow = this.escrowPda(params.auctionId, bidder);
    const vault = this.vaultFor(escrow);
    const units = usdToUsdcUnits(params.amountUsd);

    const depositIx = await program.methods
      .deposit(new anchor.BN(units.toString()))
      .accountsPartial({
        bidder,
        config: this.configPda(),
        auction,
        escrow,
        escrowVault: vault,
        bidderToken: getAssociatedTokenAddressSync(mint, bidder),
        paymentMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const memoIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: bidder, isSigner: true, isWritable: false }],
      data: Buffer.from(
        this.depositMemo(params.auctionId, params.userId, params.wallet),
        'utf8',
      ),
    });

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: bidder,
      blockhash,
      lastValidBlockHeight,
    }).add(depositIx, memoIx);

    return {
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      escrow: escrow.toBase58(),
      vault: vault.toBase58(),
      amountUnits: units.toString(),
    };
  }

  /**
   * Confirms a deposit transaction belongs to this user: it succeeded, it
   * was signed by `wallet`, it hit the escrow program, and it carries this
   * user's memo. Returns the escrow's verified on-chain balance in USD.
   */
  async verifyDeposit(params: {
    auctionId: string;
    userId: string;
    wallet: string;
    signature: string;
  }): Promise<{ balanceUsd: number; escrow: string }> {
    const { connection, programId } = this.require();
    const tx = await connection.getParsedTransaction(params.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) {
      throw new BadRequestException(
        'Transaction not found yet — wait a few seconds and try again.',
      );
    }
    if (tx.meta?.err) {
      throw new BadRequestException(
        'That deposit transaction failed on-chain.',
      );
    }
    const keys = tx.transaction.message.accountKeys;
    const signedByWallet = keys.some(
      (k) => k.signer && k.pubkey.toBase58() === params.wallet,
    );
    if (!signedByWallet) {
      throw new BadRequestException('Deposit was not signed by that wallet.');
    }
    const touchedProgram = tx.transaction.message.instructions.some((ix) =>
      ix.programId.equals(programId),
    );
    const expectedMemo = this.depositMemo(
      params.auctionId,
      params.userId,
      params.wallet,
    );
    const memoOk = (tx.meta?.logMessages ?? []).some((l) =>
      l.includes(expectedMemo),
    );
    if (!touchedProgram || !memoOk) {
      throw new BadRequestException(
        'That transaction is not a Hermes deposit for your account.',
      );
    }

    const balanceUsd = await this.escrowBalanceUsd(
      params.auctionId,
      params.wallet,
    );
    if (balanceUsd === null) {
      throw new BadRequestException('Escrow account not found on-chain.');
    }
    return {
      balanceUsd,
      escrow: this.escrowPda(
        params.auctionId,
        new PublicKey(params.wallet),
      ).toBase58(),
    };
  }
}
