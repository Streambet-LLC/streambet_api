import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, OneToMany, Index } from 'typeorm';
import { SellerInventoryItem } from './seller-inventory-item.entity';

/**
 * One seller-inventory ingest batch (a CSV / Excel / Google Sheet upload).
 *
 * Each upload holds many {@link SellerInventoryItem} rows. When ingested we
 * fuzzy-match every item's product name against products actually sold on
 * CardCade and snapshot the match counts here so the list view is cheap; the
 * full per-item buyer lists are recomputed on demand in the detail endpoint.
 */
@Entity('seller_inventory_uploads')
export class SellerInventoryUpload extends BaseEntity {
  /**
   * The seller this inventory belongs to, when linked to a real CardCade
   * account. Optional — admins can ingest for an off-platform seller and just
   * label them with {@link sellerLabel}.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  sellerUserId: string | null;

  /** Free-text seller name when not tied to a `users` row. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  sellerLabel: string | null;

  /** Origin of the data: 'csv' | 'excel' | 'google_sheets'. */
  @Column({ type: 'varchar', length: 32, default: 'csv' })
  source: string;

  /** Original file name / sheet title for display. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  fileName: string | null;

  /** Total inventory rows ingested. */
  @Column({ type: 'int', default: 0 })
  rowCount: number;

  /** Rows that matched at least one CardCade buyer. */
  @Column({ type: 'int', default: 0 })
  matchedItemCount: number;

  /** Distinct buyers matched across the whole upload. */
  @Column({ type: 'int', default: 0 })
  matchedBuyerCount: number;

  /** Admin user that performed the ingest. */
  @Column({ type: 'uuid', nullable: true })
  createdByAdminId: string | null;

  @OneToMany(() => SellerInventoryItem, (item) => item.upload)
  items: SellerInventoryItem[];
}
