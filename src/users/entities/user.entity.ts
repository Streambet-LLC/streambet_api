import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToOne } from 'typeorm';
import { Exclude } from 'class-transformer';
import { Wallet } from '../../wallets/entities/wallet.entity';
import { UserRole } from 'src/enums/user-role.enum';

export class NotificationPreference {
  emailNotification: boolean;
  inAppNotification: boolean;
}

@Entity('users')
export class User extends BaseEntity {
  @Column({ length: 255, type: 'varchar', nullable: true })
  name: string;

  @Column({ length: 255, type: 'varchar', nullable: true, name: 'first_name' })
  firstName: string;

  @Column({ length: 255, type: 'varchar', nullable: true, name: 'last_name' })
  lastName: string;

  @Column({ unique: true, length: 255, type: 'varchar' })
  username: string;

  @Column({ unique: true, length: 255, type: 'varchar' })
  email: string;

  @Column({ length: 255, type: 'varchar' })
  @Exclude()
  password: string;

  @Column({ length: 255, type: 'varchar', nullable: true })
  city: string;

  @Column({ length: 255, type: 'varchar', nullable: true })
  state: string;

  @Column({ length: 500, type: 'varchar', nullable: true, name: 'address' })
  address: string;

  @Column({ length: 200, type: 'varchar', nullable: true, name: 'address2' })
  address2: string;

  @Column({ length: 20, type: 'varchar', nullable: true, name: 'zip_code' })
  zipCode: string;

  @Column({ length: 100, type: 'varchar', nullable: true, name: 'country' })
  country: string;

  @Column({
    length: 2048,
    type: 'varchar',
    nullable: true,
    name: 'profile_image_url',
  })
  profileImageUrl: string;

  @Column({
    unique: true,
    length: 255,
    type: 'varchar',
    nullable: true,
    name: 'google_id',
  })
  googleId: string;

  @Column({
    nullable: false,
    type: 'jsonb',
    default: {
      emailNotification: true,
      inAppNotification: true,
    },
    name: 'notification_preferences',
  })
  notificationPreferences: NotificationPreference;

  @Column({
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
    name: 'tos_acceptance_timestamp',
  })
  tosAcceptanceTimestamp: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
    name: 'account_creation_date',
  })
  accountCreationDate: Date;

  @Column({ nullable: true, type: 'inet', name: 'last_known_ip' })
  lastKnownIp: string;

  @Column({ nullable: true, type: 'boolean', name: 'is_suspended' })
  isSuspended: string;

  @Column({ nullable: true, type: 'boolean', name: 'is_banned' })
  isBanned: string;

  @Column({ type: 'boolean', default: false, name: 'is_google_account' })
  isGoogleAccount: boolean;

  @Column({ type: 'boolean', default: false, name: 'is_creator' })
  isCreator: boolean;

  @Column({ type: 'boolean', default: false, name: 'is_seller' })
  isSeller: boolean;

  @Column({ type: 'decimal', default: 0, name: 'revShare' })
  revShare: number;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'timestamp', nullable: true, name: 'last_login' })
  lastLogin: Date;

  @Column({
    type: 'boolean',
    default: true,
    nullable: true,
    name: 'tos_accepted',
  })
  tosAccepted: boolean;

  @Column({ type: 'timestamp', nullable: true, name: 'tos_accepted_at' })
  tosAcceptedAt: Date;

  @Column({ default: true, name: 'is_active', type: 'boolean' })
  isActive: boolean;

  @Column({ default: false, name: 'is_verify', type: 'boolean' })
  isVerify: boolean;

  @Column({ type: 'text', nullable: true, name: 'verification_token' })
  @Exclude()
  refreshToken: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    name: 'refresh_token_expires_at',
  })
  refreshTokenExpiresAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'deleted_at' })
  deletedAt: Date;

  @Column({ type: 'date', nullable: true, name: 'date_of_birth' })
  dateOfBirth: Date;

  @Column({
    nullable: true,
    type: 'jsonb',
    name: 'socials',
  })
  socials: { [social: string]: string };

  @Column({
    type: 'jsonb',
    nullable: true,
    default: '[]',
    name: 'collection_preferences',
  })
  collectionPreferences: string[];

  @Column({ length: 255, type: 'varchar', nullable: true, name: 'promo_code' })
  promoCode: string;

  @Column({
    length: 255,
    type: 'varchar',
    nullable: true,
    name: 'shop_name',
  })
  shopName: string;

  @OneToOne(() => Wallet, (wallet) => wallet.user)
  wallet: Wallet;

  @Column({
    length: 255,
    type: 'varchar',
    nullable: true,
    name: 'ref_link',
    unique: true,
  })
  refLink: string;

  @Column({
    length: 100,
    type: 'varchar',
    nullable: true,
    name: 'stripe_account_id',
  })
  stripeAccountId: string;

  /**
   * Stripe Customer id used for auction autopay (saved card off-session
   * charges). Backfilled from any existing subscription row on migration;
   * lazily created by the auctions service for new bidders.
   */
  @Column({
    length: 100,
    type: 'varchar',
    nullable: true,
    name: 'stripe_customer_id',
  })
  stripeCustomerId: string | null;

  @Column({ default: false, name: 'stripe_account_connected', type: 'boolean' })
  stripeAccountConnected: boolean;

  @Column({
    type: 'boolean',
    default: false,
    nullable: false,
    name: 'seller_onboarding_completed',
  })
  sellerOnboardingCompleted: boolean;

  /**
   * `true` once the user has completed the in-app seller questionnaire
   * (location, trading experience, shop name, socials, profile picture).
   * This flag flips `is_seller` to `true` and is independent from
   * `seller_onboarding_completed`, which is reserved for Stripe Connect
   * verification (charges_enabled + payouts_enabled).
   */
  @Column({
    type: 'boolean',
    default: false,
    nullable: false,
    name: 'seller_profile_completed',
  })
  sellerProfileCompleted: boolean;

  @Column({
    type: 'boolean',
    default: true,
    nullable: false,
    name: 'read_receipts_enabled',
  })
  readReceiptsEnabled: boolean;

  @Column({
    type: 'text',
    nullable: true,
    name: 'seller_trading_experience',
  })
  sellerTradingExperience: string;

  @Column({
    type: 'decimal',
    default: 2,
    nullable: false,
    name: 'application_fee_percent',
  })
  applicationFeePercent: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 1,
    nullable: true,
    name: 'admin_fee_override_percent',
  })
  adminFeeOverridePercent?: number | null;

  @Column({
    type: 'boolean',
    default: false,
    nullable: false,
    name: 'is_pro_subscriber',
  })
  isProSubscriber: boolean;

  /**
   * Per-user feature flag enabling auction creation. When false the user
   * cannot create an auction (UI hides the option, backend returns 403).
   * Admins are NOT auto-enabled — they must also have this flag set, so
   * we can phase rollout to a subset of trusted users.
   */
  @Column({
    type: 'boolean',
    default: false,
    nullable: false,
    name: 'auctions_enabled',
  })
  auctionsEnabled: boolean;

  /**
   * Solana wallet address (base58 public key) for crypto payments.
   * Used to receive USDC via pay_invoice contract instruction.
   */
  @Column({
    type: 'varchar',
    length: 88,
    nullable: true,
    name: 'solana_wallet',
  })
  solanaWallet?: string;

  /**
   * Whether this user/seller is enabled to receive crypto payments.
   * Defaults to false; Cardcade (authority) is implicitly true on-chain.
   */
  @Column({
    type: 'boolean',
    default: false,
    nullable: false,
    name: 'crypto_payments_enabled',
  })
  cryptoPaymentsEnabled: boolean;

  /**
   * Optional per-seller fee override (in basis points) for crypto payments.
   * When set, overrides the default seller group fee on pay_invoice.
   * Mirrors the on-chain SellerProfile.override_fee_bps for UI display.
   */
  @Column({
    type: 'smallint',
    nullable: true,
    name: 'crypto_override_fee_bps',
  })
  cryptoOverrideFeeBps?: number;
}
