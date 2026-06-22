import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { SellerInventoryUpload } from './seller-inventory-upload.entity';

/**
 * A single inventory row from a seller upload, with the normalized product
 * name we match on and a snapshot of how many buyers it matched.
 */
@Entity('seller_inventory_items')
export class SellerInventoryItem extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  uploadId: string;

  @ManyToOne(() => SellerInventoryUpload, (u) => u.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'uploadId' })
  upload: SellerInventoryUpload;

  /** Position in the source file (0-based), for stable display order. */
  @Column({ type: 'int', default: 0 })
  rowIndex: number;

  /** Product / card name as provided by the seller. */
  @Column({ type: 'text' })
  productName: string;

  /** Lowercased, punctuation-stripped name used for fuzzy matching. */
  @Index()
  @Column({ type: 'text', default: '' })
  normalizedName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sku: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  setName: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  condition: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  grade: string | null;

  @Column({ type: 'int', nullable: true })
  quantity: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  priceUsd: string | null;

  /** Original row as provided, so nothing is lost in mapping. */
  @Column({ type: 'jsonb', nullable: true })
  raw: Record<string, unknown> | null;

  /** Snapshot: distinct buyers matched for this item at ingest time. */
  @Column({ type: 'int', default: 0 })
  matchedBuyerCount: number;

  /** prize_configuration ids this item matched, for detail recompute. */
  @Column({ type: 'jsonb', nullable: true })
  matchedProductIds: string[] | null;
}
