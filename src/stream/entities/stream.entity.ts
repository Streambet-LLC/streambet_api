import { BettingVariable } from '../../betting/entities/betting-variable.entity';
import { BettingRound } from '../../betting/entities/betting-round.entity';
import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { StreamEventType, StreamStatus } from 'src/enums/stream.enum';
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

  @Column({
    type: 'enum',
    enum: StreamEventType,
    default: StreamEventType.STREAM,
  })
  type: StreamEventType;

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

  @Column({ type: 'boolean', default: false })
  isPromoted: boolean;

  @OneToMany(() => BettingVariable, (variable) => variable.stream)
  bettingVariables: BettingVariable[];

  @OneToMany(() => BettingRound, (round) => round.stream)
  bettingRounds: BettingRound[];

  // ManyToOne relationship: One creator (User) can have many streams
  // Unidirectional - User entity has no inverse @OneToMany relationship
  // Changed from @OneToOne to @ManyToOne to match actual data model where creators can create multiple streams
  @ManyToOne(() => User)
  @JoinColumn({ name: 'creatorId' })
  creator: User;
}
