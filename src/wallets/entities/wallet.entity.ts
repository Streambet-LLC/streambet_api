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

  @Column({ type: 'decimal', default: 1000, name: 'gold_coins' })
  goldCoins: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    nullable: true,
    name: 'sweep_coins',
  })
  sweepCoins: number;

  @Column({ type: 'boolean', default: false })
  autoReloadEnabled: boolean;

  @Column({ type: 'integer', nullable: true })
  autoReloadAmount: number;

  @OneToOne(() => Wallet, (wallet) => wallet.user)
  wallet: Wallet;
}
