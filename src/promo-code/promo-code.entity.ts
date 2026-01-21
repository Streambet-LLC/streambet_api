import { BaseEntity } from 'src/common/entities/base.entity';
import { Column, Entity } from 'typeorm';

@Entity('promo_codes')
export class PromoCode extends BaseEntity {
  @Column({ name: 'code' })
  code: string;

  @Column({ name: 'currency' })
  currency: string;

  @Column({ name: 'amount' })
  amount: number;
}
