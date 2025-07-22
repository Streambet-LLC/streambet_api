import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TransactionType {
  DEPOSIT = 'Deposit',
  WITHDRAWAL = 'Withdrawal',
  BET_PLACEMENT = 'Bet placement',
  BET_WON = 'Bet winnings',
  BET_LOST = 'Bet loss',
  PURCHASE = 'Purchase coins',
  REFUND = 'Refund',
  INITIAL_CREDIT = 'Initial credit',
  ADMIN_CREDIT = 'Admin credit',
  ADMIN_DEBITED = 'Admin debited',
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
