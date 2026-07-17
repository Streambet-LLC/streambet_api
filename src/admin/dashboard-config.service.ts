import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnalyticsDashboard } from './entities/analytics-dashboard.entity';

/**
 * Per-admin market-dashboard configuration (widgets + grid layout + selected
 * segments). Reads degrade to null if the table isn't migrated yet.
 */
@Injectable()
export class DashboardConfigService {
  private readonly logger = new Logger(DashboardConfigService.name);

  constructor(
    @InjectRepository(AnalyticsDashboard)
    private readonly repo: Repository<AnalyticsDashboard>,
  ) {}

  async get(adminId: string): Promise<Record<string, unknown> | null> {
    try {
      const row = await this.repo.findOne({ where: { adminId } });
      return row ? row.config : null;
    } catch (e) {
      this.logger.warn(`dashboard get failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Union of market segments referenced across all saved dashboards (top-level
   * selection + every widget). Lets the daily cron refresh only markets someone
   * actually charts instead of all of them. Empty if nothing is saved.
   */
  async usedSegments(): Promise<string[]> {
    try {
      const rows = await this.repo.find();
      const set = new Set<string>();
      for (const r of rows) {
        const cfg = (r.config ?? {}) as {
          segments?: unknown;
          widgets?: { segments?: unknown }[];
        };
        const add = (arr: unknown) => {
          if (Array.isArray(arr)) {
            for (const s of arr) if (typeof s === 'string') set.add(s);
          }
        };
        add(cfg.segments);
        if (Array.isArray(cfg.widgets)) {
          for (const w of cfg.widgets) add(w?.segments);
        }
      }
      return [...set];
    } catch (e) {
      this.logger.warn(`usedSegments failed: ${(e as Error).message}`);
      return [];
    }
  }

  async save(
    adminId: string,
    config: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const existing = await this.repo.findOne({ where: { adminId } });
    if (existing) {
      existing.config = config;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({ adminId, config }));
    }
    return config;
  }
}
