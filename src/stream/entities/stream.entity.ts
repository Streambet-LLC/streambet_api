import { BettingVariable } from '../../betting/entities/betting-variable.entity';
import { BettingRound } from '../../betting/entities/betting-round.entity';
import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToMany, OneToOne, JoinColumn } from 'typeorm';
import { StreamStatus } from 'src/enums/stream.enum';
import { User } from 'src/users/entities/user.entity';

@Entity('streams')
export class Stream extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  embeddedUrl: string;

  @Column({ nullable: true })
  thumbnailUrl: string;

  @Column({ nullable: true })
  platformName: string;

  @Column({
    type: 'enum',
    enum: StreamStatus,
    default: StreamStatus.SCHEDULED,
  })
  status: StreamStatus;

  @Column({ type: 'timestamp', nullable: true })
  scheduledStartTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  actualStartTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  endTime: Date;

  @Column({ type: 'integer', default: 0 })
  viewerCount: number;

  @Column({ type: 'uuid', nullable: true })
  creatorId: string;

  @OneToMany(() => BettingVariable, (variable) => variable.stream)
  bettingVariables: BettingVariable[];

  @OneToMany(() => BettingRound, (round) => round.stream)
  bettingRounds: BettingRound[];

  @OneToOne(() => User, (creator) => creator.username)
  @JoinColumn({ name: 'creatorId' })
  creator: User;
}
