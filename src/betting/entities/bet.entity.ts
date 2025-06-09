import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { BettingVariable } from './betting-variable.entity';

export enum BetStatus {
  ACTIVE = 'active',
  WON = 'won',
  LOST = 'lost',
  REFUNDED = 'refunded',
  CANCELED = 'canceled',
}

@Entity('bets')
export class Bet extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => BettingVariable, (bettingVariable) => bettingVariable.bets, {
    onDelete: 'CASCADE',
  })
  @JoinColumn()
  bettingVariable: BettingVariable;

  @Column({ type: 'uuid' })
  bettingVariableId: string;

  @Column({ type: 'integer' })
  amount: number;

  @Column({
    type: 'enum',
    enum: BetStatus,
    default: BetStatus.ACTIVE,
  })
  status: BetStatus;

  @Column({ type: 'integer', nullable: true })
  payoutAmount: number;

  @Column({ type: 'boolean', default: false })
  isProcessed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  processedAt: Date;
}
