import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/users/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne, OneToOne } from 'typeorm';

@Entity('platform_payouts')
export class PlatformPayout extends BaseEntity {
  @Column({ name: 'betting_round' })
  bettingRoundId: string;

  @OneToOne(() => BettingRound, (round) => round.id, {})
  @JoinColumn({ name: 'betting_round' })
  bettingRound: BettingRound;

  @Column({ name: 'assigned_creator', nullable: true })
  assignedCreatorId: string;

  @ManyToOne(() => User, (user) => user.id, {})
  @JoinColumn({ name: 'assigned_creator' })
  creator: User;

  @Column({ type: 'decimal' })
  creator_split_pct: number;

  @Column({ type: 'decimal' })
  platform_payout_amount: number;

  @Column({ type: 'decimal' })
  creator_split_amount: number;
}
