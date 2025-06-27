import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Stream } from '../../stream/entities/stream.entity';
import { BettingVariable } from './betting-variable.entity';
import { BettingVariableStatus } from '../../enums/betting-variable-status.enum';

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

  @Column({
    type: 'enum',
    enum: BettingVariableStatus,
    default: BettingVariableStatus.ACTIVE,
  })
  freeTokenStatus: BettingVariableStatus;

  @Column({
    type: 'enum',
    enum: BettingVariableStatus,
    default: BettingVariableStatus.ACTIVE,
  })
  coinStatus: BettingVariableStatus;

  @OneToMany(() => BettingVariable, (bettingVariable) => bettingVariable.round)
  bettingVariables: BettingVariable[];
}
