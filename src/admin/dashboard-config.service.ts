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
