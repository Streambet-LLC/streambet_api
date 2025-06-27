import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Stream } from 'src/stream/entities/stream.entity';
import { BettingVariable } from './betting-variable.entity';

@Entity('betting_rounds')
export class BettingRound extends BaseEntity {
  @ManyToOne(() => Stream, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'stream_id' })
  stream: Stream;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @OneToMany(() => BettingVariable, (bettingVariable) => bettingVariable.round)
  bettingVariables: BettingVariable[];

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;
}
