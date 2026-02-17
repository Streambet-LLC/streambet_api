import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

/**
 * Entity for storing prize tier configurations.
 * Each prize tier (level) gets its own row with a unique ID.
 * Data hardening: Updates create new rows instead of modifying existing ones.
 */
@Entity('prize_configurations')
export class PrizeConfiguration extends BaseEntity {
  @Column({ type: 'integer', name: 'prize_tier' })
  prizeTier: number;

  @Column({ type: 'decimal', precision: 12, scale: 3 })
  amount: number;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 500, name: 'image_url', nullable: true })
  imageUrl: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({
    type: 'enum',
    enum: ['slab', 'sealed'],
    name: 'category',
    nullable: false,
    default: 'slab',
  })
  category: 'slab' | 'sealed';

  @Column({ type: 'integer', name: 'stock', default: 0, nullable: false })
  stock: number;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'uuid', name: 'updated_by', nullable: true })
  updatedBy: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'updated_by' })
  updater: User;
}
