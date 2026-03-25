import { Entity, Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * Entity for storing shop-level settings for virtual shops (e.g., CardCade).
 * Each shop is identified by a unique shopKey (e.g., 'cardcade').
 */
@Entity('shop_settings')
export class ShopSettings extends BaseEntity {
  @Column({ type: 'varchar', length: 100, unique: true, name: 'shop_key' })
  shopKey: string;

  @Column({
    type: 'varchar',
    length: 255,
    name: 'display_name',
    nullable: true,
  })
  displayName: string | null;

  @Column({
    type: 'varchar',
    length: 500,
    name: 'profile_image_url',
    nullable: true,
  })
  profileImageUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  socials: Record<string, string> | null;

  @Column({ type: 'text', name: 'seller_trading_experience', nullable: true })
  sellerTradingExperience: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  country: string | null;
}
