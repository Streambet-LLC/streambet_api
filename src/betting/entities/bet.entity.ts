import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BettingVariable } from './betting-variable.entity';
import { Stream } from 'src/stream/entities/stream.entity';
import { BettingRound } from './betting-round.entity';
import { BetStatus } from '../../enums/bet-status.enum';

@Entity('bets')
export class Bet extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Stream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @ManyToOne(() => BettingRound, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'round_id' })
  round: BettingRound;

  @ManyToOne(() => BettingVariable, (bettingVariable) => bettingVariable.bets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'betting_variable_id' })
  bettingVariable: BettingVariable;

  @Column({ type: 'bigint' })
  amount: number;

  @Column({ type: 'varchar', length: 20 })
  currency: string;

  @Column({ type: 'enum', enum: BetStatus, default: BetStatus.Active })
  status: BetStatus;

  @Column({ type: 'bigint', default: 0 })
  payout: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
