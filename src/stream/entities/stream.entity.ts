import { BettingVariable } from 'src/betting/entities/betting-variable.entity';
import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToMany } from 'typeorm';

export enum StreamStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  ENDED = 'ended',
}

@Entity('streams')
export class Stream extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column()
  kickEmbedUrl: string;

  @Column({ nullable: true })
  thumbnailUrl: string;

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

  @OneToMany(() => BettingVariable, (variable) => variable.stream)
  bettingVariables: BettingVariable[];
}
