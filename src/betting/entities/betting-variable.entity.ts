import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Bet } from './bet.entity';
import { BettingRound } from './betting-round.entity';

@Entity('betting_variables')
export class BettingVariable extends BaseEntity {
  @ManyToOne(() => BettingRound, (round) => round.bettingVariables, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'round_id' })
  round: BettingRound;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'boolean', default: false })
  is_winning_option: boolean;

  @OneToMany(() => Bet, (bet) => bet.bettingVariable)
  bets: Bet[];
}
