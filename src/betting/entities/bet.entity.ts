import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BettingVariable } from './betting-variable.entity';
import { Stream } from '../../stream/entities/stream.entity';
import { BetStatus } from '../../enums/bet-status.enum';
import { CurrencyType } from '../../wallets/entities/transaction.entity';
import { BettingRound } from './betting-round.entity';

@Entity('bets')
export class Bet extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => Stream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @Column({ name: 'stream_id' })
  streamId: string;

  @ManyToOne(() => BettingVariable, (bettingVariable) => bettingVariable.bets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'betting_variable_id' })
  bettingVariable: BettingVariable;

  @Column({ name: 'betting_variable_id' })
  bettingVariableId: string;

  @Column({ type: 'bigint' })
  amount: number;

  @Column({
    type: 'enum',
    enum: CurrencyType,
    nullable: true,
  })
  currency: CurrencyType;

  @Column({ type: 'enum', enum: BetStatus, default: BetStatus.Active })
  status: BetStatus;

  @Column({ type: 'bigint', default: 0 })
  payout: number;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  payoutAmount: number;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;

  @Column({ type: 'boolean', default: false })
  isProcessed: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @ManyToOne(() => BettingRound, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'round_id' })
  round: BettingRound;

  @Column({ name: 'round_id', nullable: true })
  roundId: string;
}
