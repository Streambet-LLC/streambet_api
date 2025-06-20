import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TransactionType {
  DEPOSIT = 'deposit',
  WITHDRAWAL = 'withdrawal',
  BET_PLACEMENT = 'bet_placement',
  BET_WINNINGS = 'bet_winnings',
  PURCHASE = 'purchase',
  SYSTEM_ADJUSTMENT = 'system_adjustment',
  INITIAL_CREDIT = 'initial_credit',
  ADMIN_CREDIT = 'admin_credit',
}

export enum CurrencyType {
  FREE_TOKENS = 'free_tokens',
  STREAM_COINS = 'stream_coins',
}

@Entity('transactions')
export class Transaction extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: CurrencyType,
  })
  currencyType: CurrencyType;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'integer' })
  balanceAfter: number;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'uuid', nullable: true })
  relatedEntityId: string;

  @Column({ nullable: true })
  relatedEntityType: string;
}
