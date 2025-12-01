import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, OneToMany, JoinColumn, OneToOne } from 'typeorm';
import { Stream } from '../../stream/entities/stream.entity';
import { BettingVariable } from './betting-variable.entity';
import { BettingRoundStatus } from '../../enums/round-status.enum';
import { Bet } from './bet.entity';
import { User } from 'src/users/entities/user.entity';

@Entity('betting_rounds')
export class BettingRound extends BaseEntity {
  @ManyToOne(() => Stream, (stream) => stream.bettingRounds, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @Column({ name: 'stream_id' })
  streamId: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  roundName: string;

  @Column({ type: 'timestamp', nullable: true })
  lockDate: Date;

  @Column({
    type: 'enum',
    enum: BettingRoundStatus,
    default: BettingRoundStatus.CREATED,
  })
  status: BettingRoundStatus;

  @OneToMany(() => BettingVariable, (bettingVariable) => bettingVariable.round)
  bettingVariables: BettingVariable[];

  @OneToMany(() => Bet, (bet) => bet.round)
  bet: Bet[];

  @Column({ type: 'uuid', nullable: true })
  createdBy: string;

  @ManyToOne(() => User, (creator) => creator.username)
  @JoinColumn({ name: 'createdBy' })
  creator: User;
}
