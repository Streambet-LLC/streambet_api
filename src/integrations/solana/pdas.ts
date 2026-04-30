import { PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';

/**
 * Seed constants (must match cardcade-contracts/programs/cardcade-marketplace/src/state.rs).
 */
export const MARKETPLACE_SEED = Buffer.from('marketplace');
export const SELLER_PROFILE_SEED = Buffer.from('seller_profile');
export const SELLER_GROUP_SEED = Buffer.from('seller_group');
export const BUYER_WAIVER_SEED = Buffer.from('buyer_waiver');
export const CRYPTO_SELLER_SEED = Buffer.from('crypto_seller');
export const INVOICE_SEED = Buffer.from('invoice');
export const DEFAULT_SELLER_GROUP_ID = 0;
export const INVOICE_ID_LEN = 16;

/** Marketplace singleton PDA. */
export function marketplacePda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MARKETPLACE_SEED], programId);
}

/** SellerProfile PDA for a given seller wallet. */
export function sellerProfilePda(
  programId: PublicKey,
  seller: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SELLER_PROFILE_SEED, seller.toBuffer()],
    programId,
  );
}

/** SellerGroup PDA for a given group ID. */
export function sellerGroupPda(
  programId: PublicKey,
  groupId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SELLER_GROUP_SEED, Buffer.from([groupId])],
    programId,
  );
}

/** BuyerWaiver PDA for a given buyer wallet. */
export function buyerWaiverPda(
  programId: PublicKey,
  buyer: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BUYER_WAIVER_SEED, buyer.toBuffer()],
    programId,
  );
}

/** CryptoSellerAllowance PDA for a given seller wallet. */
export function cryptoSellerAllowancePda(
  programId: PublicKey,
  seller: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CRYPTO_SELLER_SEED, seller.toBuffer()],
    programId,
  );
}

/** Invoice PDA for a given 16-byte invoice ID. */
export function invoicePda(
  programId: PublicKey,
  invoiceId: Buffer,
): [PublicKey, number] {
  if (invoiceId.length !== INVOICE_ID_LEN) {
    throw new Error(
      `invoice_id must be ${INVOICE_ID_LEN} bytes, got ${invoiceId.length}`,
    );
  }
  return PublicKey.findProgramAddressSync([INVOICE_SEED, invoiceId], programId);
}

/** Generate a random 16-byte invoice ID. */
export function randomInvoiceId(): Buffer {
  return crypto.randomBytes(INVOICE_ID_LEN);
}
