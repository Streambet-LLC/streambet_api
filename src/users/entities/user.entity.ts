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

  @Column({
    length: 255,
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

  @Column({ type: 'decimal', default: 0, name: 'revShare' })
  revShare: boolean;

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

  @Column({ length: 255, type: 'varchar', nullable: true, name: 'promo_code' })
  promoCode: string;

  @OneToOne(() => Wallet, (wallet) => wallet.user)
  wallet: Wallet;
}
