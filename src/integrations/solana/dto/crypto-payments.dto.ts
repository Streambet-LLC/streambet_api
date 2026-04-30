import { IsString, IsOptional, Length, IsInt, Min, Max } from 'class-validator';

export class QuoteCryptoPaymentDto {
  /** Order ID to quote. The seller, amount and shipping are derived server-side. */
  @IsString()
  orderId: string;

  /** Buyer's Solana wallet (base58, 32-44 chars). Required to compute waiver / fees. */
  @IsString()
  @Length(32, 44)
  buyerWallet: string;
}

export class ConfirmCryptoPaymentDto {
  @IsString()
  orderId: string;

  /** Solana tx signature (base58) of the pay_invoice call. */
  @IsString()
  txSignature: string;

  /** Buyer wallet that signed the payment. Cross-checked against on-chain Invoice.buyer. */
  @IsString()
  @Length(32, 44)
  buyerWallet: string;
}

export class SetSolanaWalletDto {
  /** Base58 wallet address; pass null/empty to clear. */
  @IsOptional()
  @IsString()
  @Length(32, 44)
  walletAddress?: string;
}

export class GrantCryptoSellerDto {
  @IsString()
  @Length(32, 44)
  sellerWallet: string;
}

export class SetSellerOverrideFeeDto {
  @IsString()
  @Length(32, 44)
  sellerWallet: string;

  /**
   * Fee in basis points (0-10000). Pass null/omit to clear the override
   * and fall back to the seller's group fee.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  overrideFeeBps?: number | null;
}
