import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Bet } from './bet.entity';
import { BettingVariable } from './betting-variable.entity';
import { BettingRound } from './betting-round.entity';
import { Stream } from '../../stream/entities/stream.entity';
import { CurrencyType } from '../../enums/currency.enum';
import { BetEditType } from '../../enums/bet-edit-type.enum';

@Entity('bet_edit_history')
export class BetEditHistory extends BaseEntity {
  @ManyToOne(() => Bet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bet_id' })
  bet: Bet;

  @Column({ name: 'bet_id' })
  betId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => BettingRound, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'round_id' })
  round: BettingRound;

  @Column({ name: 'round_id' })
  roundId: string;

  @ManyToOne(() => Stream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @Column({ name: 'stream_id' })
  streamId: string;

  @ManyToOne(() => BettingVariable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'old_betting_variable_id' })
  oldBettingVariable: BettingVariable;

  @Column({ name: 'old_betting_variable_id' })
  oldBettingVariableId: string;

  @ManyToOne(() => BettingVariable, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'new_betting_variable_id' })
  newBettingVariable: BettingVariable;

  @Column({ name: 'new_betting_variable_id' })
  newBettingVariableId: string;

  @Column({ type: 'decimal', precision: 12, scale: 3, name: 'old_amount' })
  oldAmount: number;

  @Column({ type: 'decimal', precision: 12, scale: 3, name: 'new_amount' })
  newAmount: number;

  @Column({
    type: 'enum',
    enum: CurrencyType,
  })
  currency: CurrencyType;

  @Column({
    type: 'enum',
    enum: BetEditType,
    name: 'edit_type',
  })
  editType: BetEditType;

  @Column({ type: 'timestamp', name: 'edited_at' })
  editedAt: Date;
}
