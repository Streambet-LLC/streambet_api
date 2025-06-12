import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Stream } from './stream.entity';
import { Bet } from './bet.entity';

export enum BettingVariableStatus {
  ACTIVE = 'active',
  LOCKED = 'locked',
  WINNER = 'winner',
  LOSER = 'loser',
  CANCELED = 'canceled',
}

@Entity('betting_variables')
export class BettingVariable extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToOne(() => Stream, (stream) => stream.bettingVariables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  stream: Stream;

  @Column({ type: 'uuid' })
  streamId: string;

  @Column({
    type: 'enum',
    enum: BettingVariableStatus,
    default: BettingVariableStatus.ACTIVE,
  })
  status: BettingVariableStatus;

  @Column({ type: 'integer', default: 0 })
  totalBetsAmount: number;

  @Column({ type: 'integer', default: 0 })
  betCount: number;

  @OneToMany(() => Bet, (bet) => bet.bettingVariable)
  bets: Bet[];
}
