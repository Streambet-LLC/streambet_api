import { registerAs } from '@nestjs/config';

/**
 * Solana / Cardcade Marketplace configuration.
 * Env vars:
 *   SOLANA_RPC_URL              - Solana RPC endpoint (devnet / mainnet)
 *   CARDCADE_PROGRAM_ID         - Deployed program ID
 *   CARDCADE_USDC_MINT          - USDC mint address
 *   CARDCADE_TREASURY_ATA       - Treasury USDC ATA address
 *   CARDCADE_AUTHORITY_SECRET_BASE58 - Authority keypair (base58 secret key)
 */
export default registerAs('solana', () => ({
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
  programId:
    process.env.CARDCADE_PROGRAM_ID ||
    'HcMUewaCXRFMi8KAwBwgRRdScJ5Z4KSffqtYG6Dmpfzk',
  usdcMint:
    process.env.CARDCADE_USDC_MINT ||
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  treasuryAta: process.env.CARDCADE_TREASURY_ATA || '',
  authoritySecretBase58: process.env.CARDCADE_AUTHORITY_SECRET_BASE58 || '',
  /**
   * Optional. If unset, the authority key is reused as the treasury signer
   * (matches our devnet setup where authority and treasury are the same
   * keypair). For mainnet, set this to a separate keypair / multisig signer.
   */
  treasurySecretBase58: process.env.CARDCADE_TREASURY_SECRET_BASE58 || '',
}));
