import { BettingRound } from 'src/betting/entities/betting-round.entity';
import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from 'src/users/entities/user.entity';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';

@Entity('bet_round_history')
export class BetRoundHistory extends BaseEntity {
  @Column({ name: 'bet_round_uuid' })
  bet_round_uuid: string;

  @ManyToOne(() => BettingRound, (round) => round.id, {})
  @JoinColumn({ name: 'bet_round_uuid' })
  betRound: BettingRound;

  @Column({ name: 'event_type' })
  event_type: string;

  @Column({ name: 'description' })
  description: string;

  @Column({ name: 'causer_id' })
  causer_id: string;

  @ManyToOne(() => User, (user) => user.id, {})
  @JoinColumn({ name: 'causer_id' })
  user: User;
}
