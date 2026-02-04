import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PrizeConfiguration } from './prize-configuration.entity';
import { PrizeCategory } from '../enums/prize-category.enum';

/**
 * Entity for tracking prize redemptions by users.
 * Records which users achieved which prize tiers and when.
 * Address information is stored in User entity, not duplicated here.
 */
@Entity('prize_redemptions')
export class PrizeRedemption extends BaseEntity {
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @Column({ type: 'uuid', name: 'prize_configuration_id' })
  prizeConfigurationId: string;

  @Column({ type: 'integer', name: 'prize_tier' })
  prizeTier: number;

  @Column({
    type: 'enum',
    enum: PrizeCategory,
    nullable: true,
    name: 'prize_category',
  })
  prizeCategory: PrizeCategory;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'open',
    name: 'shipping_status',
  })
  shippingStatus: string;

  @Column({
    type: 'varchar',
    length: 200,
    nullable: true,
    name: 'tracking_number',
  })
  trackingNumber: string;

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'shipping_carrier',
  })
  shippingCarrier: string;

  @Column({ type: 'boolean', default: false, name: 'fulfilled' })
  fulfilled: boolean;

  @Column({
    type: 'timestamp',
    name: 'date_redeemed',
  })
  dateRedeemed: Date;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => PrizeConfiguration, { nullable: false })
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration;
}
