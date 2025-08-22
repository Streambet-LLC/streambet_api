import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('coin_packages')
export class CoinPackage extends BaseEntity {
  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'total_amount' })
  totalAmount: number;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'sweep_coin_count' })
  sweepCoinCount: number;

  @Column({ type: 'bigint', name: 'gold_coin_count'})
  goldCoinCount: number;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'image_url' })
  imageUrl?: string;

  @Column({ type: 'boolean', default: true })
  status: boolean;
}
