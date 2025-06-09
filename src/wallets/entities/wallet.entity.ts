import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('wallets')
export class Wallet extends BaseEntity {
  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'integer', default: 1000 })
  freeTokens: number;

  @Column({ type: 'integer', default: 0 })
  streamCoins: number;

  @Column({ type: 'boolean', default: false })
  autoReloadEnabled: boolean;

  @Column({ type: 'integer', nullable: true })
  autoReloadAmount: number;
}
