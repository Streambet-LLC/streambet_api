import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Bet } from './bet.entity';
import { Stream } from '../../stream/entities/stream.entity';
import { BettingRound } from './betting-round.entity';
import { BettingVariableStatus } from '../../enums/betting-variable-status.enum';

@Entity('betting_variables')
export class BettingVariable extends BaseEntity {
  @ManyToOne(() => Stream, (stream) => stream.bettingVariables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @Column({ name: 'stream_id' })
  streamId: string;

  @ManyToOne(() => BettingRound, (round) => round.bettingVariables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'round_id' })
  round: BettingRound;

  @Column({ name: 'round_id', nullable: true })
  roundId: string;

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
  totalBetsGoldCoinAmount: number;

  @Column({ type: 'bigint', default: 0 })
  totalBetsSweepCoinAmount: number;

  @Column({ type: 'int', default: 0 })
  betCountGoldCoin: number;

  @Column({ type: 'int', default: 0 })
  betCountSweepCoin: number;

  @OneToMany(() => Bet, (bet) => bet.bettingVariable)
  bets: Bet[];
}
