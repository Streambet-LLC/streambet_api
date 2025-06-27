import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Bet } from './bet.entity';
import { BettingRound } from './betting-round.entity';
import { Stream } from '../../stream/entities/stream.entity';
import { BettingVariableStatus } from '../../enums/betting-variable-status.enum';

@Entity('betting_variables')
export class BettingVariable extends BaseEntity {
  @ManyToOne(() => BettingRound, (round) => round.bettingVariables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'round_id' })
  round: BettingRound;

  @ManyToOne(() => Stream, (stream) => stream.bettingVariables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'boolean', default: false })
  is_winning_option: boolean;

  @Column({
    type: 'enum',
    enum: BettingVariableStatus,
    default: BettingVariableStatus.ACTIVE,
  })
  status: BettingVariableStatus;

  @Column({ type: 'bigint', default: 0 })
  totalBetsAmount: number;

  @Column({ type: 'int', default: 0 })
  betCount: number;

  @OneToMany(() => Bet, (bet) => bet.bettingVariable)
  bets: Bet[];
}
