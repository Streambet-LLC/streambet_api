import {
  Entity,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PrizeConfiguration } from './prize-configuration.entity';

@Entity('item_configuration_images')
@Index('idx_item_configuration_images_prize_configuration_id', [
  'prizeConfigurationId',
])
@Index('idx_item_configuration_images_prize_configuration_id_display_order', [
  'prizeConfigurationId',
  'displayOrder',
])
export class ItemConfigurationImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'prize_configuration_id' })
  prizeConfigurationId: string;

  @Column({ type: 'varchar', length: 500, name: 'image_url' })
  imageUrl: string;

  @Column({ type: 'integer', name: 'display_order' })
  displayOrder: number;

  @ManyToOne(() => PrizeConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration;
}
