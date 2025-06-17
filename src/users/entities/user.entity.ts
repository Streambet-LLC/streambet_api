import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column } from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true, length: 255, type: 'varchar' })
  username: string;

  @Column({ unique: true, length: 255, type: 'varchar' })
  email: string;

  @Column({ length: 255, type: 'varchar' })
  @Exclude()
  password: string;

  @Column({ length: 255, type: 'varchar', nullable: true })
  profile_image_url: string;

  @Column({ unique: true, length: 255, type: 'varchar', nullable: true })
  google_id: string;

  @Column({ nullable: true, type: 'jsonb', default: {} })
  notification_preferences: string;

  @Column({
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  @Column({ nullable: true })
  tos_acceptance_timestamp: Date;

  @Column({
    type: 'timestamp',
    nullable: true,
    default: () => 'CURRENT_TIMESTAMP',
  })
  @Column({ nullable: true, type: 'date' })
  account_creation_date: Date;

  @Column({ nullable: true, type: 'inet' })
  last_known_ip: string;

  @Column({ nullable: true, type: 'boolean' })
  is_suspended: string;

  @Column({ nullable: true, type: 'boolean' })
  is_banned: string;

  @Column({ type: 'boolean', default: false })
  isGoogleAccount: boolean;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'timestamp', nullable: true })
  lastLogin: Date;

  @Column({ type: 'boolean', default: true, nullable: true })
  tosAccepted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  tosAcceptedAt: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  @Exclude()
  refreshToken: string;

  @Column({ type: 'timestamp', nullable: true })
  refreshTokenExpiresAt: Date;
}
