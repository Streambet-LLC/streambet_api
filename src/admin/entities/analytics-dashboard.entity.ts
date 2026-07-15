import { BaseEntity } from '../../common/entities/base.entity';
import { Entity, Column, Index } from 'typeorm';

/**
 * One admin's saved market-dashboard configuration — the widgets they've added,
 * their per-breakpoint grid layout, and selected market segments. Stored per
 * admin so a custom dashboard follows them across devices.
 */
@Entity('analytics_dashboards')
export class AnalyticsDashboard extends BaseEntity {
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  adminId: string;

  /** { segments: string[], widgets: [...], layouts: {...} }. */
  @Column({ type: 'jsonb' })
  config: Record<string, unknown>;
}
