import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column } from 'typeorm';
import { Exclude } from 'class-transformer';

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
}

@Entity('users')
export class User extends BaseEntity {
  @Column({ unique: true })
  username: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  @Exclude()
  password: string;

  @Column({ nullable: true })
  profileImage: string;

  @Column({ type: 'boolean', default: false })
  isGoogleAccount: boolean;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role: UserRole;

  @Column({ type: 'timestamp', nullable: true })
  lastLogin: Date;

  @Column({ type: 'boolean', default: true })
  tosAccepted: boolean;

  @Column({ type: 'timestamp' })
  tosAcceptedAt: Date;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;
}
