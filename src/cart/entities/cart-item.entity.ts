import { Entity, Column, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { Cart } from './cart.entity';
import { PrizeConfiguration } from '../../prize/entities/prize-configuration.entity';

@Entity('cart_items')
@Unique(['cartId', 'prizeConfigurationId'])
export class CartItem extends BaseEntity {
  @Column({ type: 'uuid', name: 'cart_id' })
  cartId: string;

  @Column({ type: 'uuid', name: 'prize_configuration_id' })
  prizeConfigurationId: string;

  @Column({ type: 'integer', default: 1 })
  quantity: number;

  @ManyToOne(() => Cart, (cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: Cart;

  @ManyToOne(() => PrizeConfiguration, { eager: true })
  @JoinColumn({ name: 'prize_configuration_id' })
  prizeConfiguration: PrizeConfiguration;
}
