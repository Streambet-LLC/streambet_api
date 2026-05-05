import { Entity, Column, JoinColumn, OneToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { PrizeConfiguration } from './prize-configuration.entity';

@Entity('prize_item_ebay_sync_state')
export class PrizeItemEbaySyncState extends BaseEntity {
  @Column({ type: 'uuid', name: 'item_id', unique: true })
  itemId: string;

  @OneToOne(() => PrizeConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'item_id' })
  item: PrizeConfiguration;

  @Column({ type: 'timestamp', name: 'last_fetch_attempted_at', nullable: true })
  lastFetchAttemptedAt: Date | null;

  @Column({ type: 'timestamp', name: 'last_fetch_succeeded_at', nullable: true })
  lastFetchSucceededAt: Date | null;

  @Column({ type: 'timestamp', name: 'last_seen_sold_at', nullable: true })
  lastSeenSoldAt: Date | null;

  @Column({
    type: 'varchar',
    name: 'last_seen_provider_item_id',
    length: 128,
    nullable: true,
  })
  lastSeenProviderItemId: string | null;

  @Column({ type: 'timestamp', name: 'next_fetch_at', nullable: true })
  nextFetchAt: Date | null;

  @Column({ type: 'timestamp', name: 'last_calculated_at', nullable: true })
  lastCalculatedAt: Date | null;
}
