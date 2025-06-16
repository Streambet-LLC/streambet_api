import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column } from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
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
    nullable: true,
    type: 'jsonb',
    default: {},
    name: 'notification_preferences',
  })
  notificationPreferences: string;

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

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;
}
