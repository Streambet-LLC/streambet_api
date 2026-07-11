import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * A cached Claude-generated predictive intelligence brief for one card
 * (prize_configuration). Regenerated on demand; stored so we don't re-run the
 * (web-search-backed, billable) analysis on every view.
 */
@Entity('card_forecasts')
export class CardForecast extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  prizeConfigurationId: string;

  /** The full forecast object (outlook, catalysts, sources, …). */
  @Column({ type: 'jsonb' })
  forecast: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  generatedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  generatedByAdminId: string | null;
}
