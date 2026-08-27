import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index, Unique } from 'typeorm';

export type TaxonomyKind = 'market' | 'subcategory' | 'set' | 'player' | 'card';

/**
 * The market-taxonomy backbone: one hierarchy (market → sub-category → set →
 * card) plus cross-cutting player/character subject nodes, that BOTH the eBay
 * heat metrics and first-party engagement (views/saves/sales) hang off — so
 * every metric can roll up and drill down by any dimension.
 *
 * Adjacency is by `parentKey` (a stable slug) rather than a uuid FK, so the
 * default tree can be re-seeded idempotently. `matchTerms` drives auto-tagging
 * (a card name/brand → its node keys) and, where `query` is set, the eBay heat
 * search. Keys deliberately reuse the existing heat-topic keys where they
 * overlap (`pokemon`, `set_pkm_151`, `card_moonbreon`, …) so the taxonomy stays
 * continuous with the live `market_heat_points` / `market_listings` data.
 */
@Entity('market_taxonomy')
@Unique('UQ_market_taxonomy_key', ['key'])
@Index('IDX_market_taxonomy_root', ['rootMarket'])
@Index('IDX_market_taxonomy_kind', ['kind'])
@Index('IDX_market_taxonomy_parent', ['parentKey'])
export class MarketTaxonomyNode extends BaseEntity {
  @Column({ type: 'varchar', length: 24 })
  kind: TaxonomyKind;

  /** Market slug this node lives under ('pokemon', …); for market nodes == key. */
  @Column({ type: 'varchar', length: 64 })
  rootMarket: string;

  /** Parent node's key; null for market roots. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  parentKey: string | null;

  /** Globally-unique slug. Reuses existing heat-topic keys where they overlap. */
  @Column({ type: 'varchar', length: 128 })
  key: string;

  @Column({ type: 'varchar', length: 160 })
  label: string;

  /** Keywords for auto-tagging card names + (optionally) the eBay query seed. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  matchTerms: string[];

  /** eBay search string when this node is snapshotted as a heat topic. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  query: string | null;

  /** Heat scope this node feeds ('segment'|'set'|'card'|'player'), if any. */
  @Column({ type: 'varchar', length: 24, nullable: true })
  heatScope: string | null;

  /** Human-reviewed (vs. auto-seeded). */
  @Column({ type: 'boolean', default: false })
  curated: boolean;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'jsonb', nullable: true })
  extra: Record<string, unknown> | null;
}
