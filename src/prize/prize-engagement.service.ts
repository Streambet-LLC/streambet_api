import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PrizeConfiguration } from './entities/prize-configuration.entity';
import { PrizeItemView } from './entities/prize-item-view.entity';
import { PrizeItemWatcher } from './entities/prize-item-watcher.entity';
import { User } from '../users/entities/user.entity';
import { InboxService } from '../inbox/inbox.service';
import { EmailsService } from '../emails/email.service';

const MAX_VIEW_BATCH = 50;

@Injectable()
export class PrizeEngagementService {
  private readonly logger = new Logger(PrizeEngagementService.name);

  constructor(
    @InjectRepository(PrizeConfiguration)
    private readonly prizeConfigRepository: Repository<PrizeConfiguration>,
    @InjectRepository(PrizeItemView)
    private readonly viewRepository: Repository<PrizeItemView>,
    @InjectRepository(PrizeItemWatcher)
    private readonly watcherRepository: Repository<PrizeItemWatcher>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly inboxService: InboxService,
    private readonly emailsService: EmailsService,
    @Optional() private readonly configService?: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  /**
   * Record a batch of item views for the given viewer (logged-in user OR
   * anon id). Dedupes per (item, viewer, day) via partial unique indexes.
   * Cached `view_count` on the prize is incremented atomically only for the
   * rows that were actually inserted.
   */
  async trackViews(
    itemIds: string[],
    viewer: { userId?: string | null; anonId?: string | null },
  ): Promise<{ tracked: number }> {
    if (!itemIds?.length) return { tracked: 0 };
    if (!viewer.userId && !viewer.anonId) return { tracked: 0 };

    // Dedupe + cap the list defensively
    const uniqueIds = Array.from(new Set(itemIds)).slice(0, MAX_VIEW_BATCH);

    // Today in UTC, formatted as YYYY-MM-DD for the `date` column
    const viewedOn = new Date().toISOString().slice(0, 10);

    // Make sure all the ids exist (prevents FK churn from bogus client ids)
    const existing = await this.prizeConfigRepository.find({
      where: { id: In(uniqueIds) },
      select: ['id'],
    });
    const validIds = existing.map((p) => p.id);
    if (!validIds.length) return { tracked: 0 };

    let tracked = 0;
    for (const itemId of validIds) {
      try {
        await this.dataSource.transaction(async (mgr) => {
          // ON CONFLICT DO NOTHING means the partial unique index dedupes
          // the same viewer hitting the same item again on the same day.
          const result = await mgr.query(
            `INSERT INTO prize_item_views (item_id, user_id, anon_id, viewed_on)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              itemId,
              viewer.userId ?? null,
              viewer.userId ? null : (viewer.anonId ?? null),
              viewedOn,
            ],
          );
          if (Array.isArray(result) && result.length > 0) {
            await mgr.query(
              `UPDATE prize_configurations SET view_count = view_count + 1 WHERE id = $1`,
              [itemId],
            );
            tracked += 1;
          }
        });
      } catch (err) {
        // Don't ever fail the request because of view tracking
        this.logger.warn(
          `[VIEWS] Failed to record view for ${itemId}: ${(err as Error).message}`,
        );
      }
    }

    return { tracked };
  }

  // ---------------------------------------------------------------------------
  // Watchers
  // ---------------------------------------------------------------------------

  async watchItem(
    userId: string,
    itemId: string,
  ): Promise<{ watching: true; watcherCount: number }> {
    const item = await this.prizeConfigRepository.findOne({
      where: { id: itemId },
      select: ['id'],
    });
    if (!item) throw new NotFoundException('Item not found');

    let watcherCount = 0;
    await this.dataSource.transaction(async (mgr) => {
      const inserted = await mgr.query(
        `INSERT INTO prize_item_watchers (item_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT "UQ_prize_item_watchers_item_user" DO NOTHING
         RETURNING id`,
        [itemId, userId],
      );
      if (Array.isArray(inserted) && inserted.length > 0) {
        await mgr.query(
          `UPDATE prize_configurations SET watcher_count = watcher_count + 1 WHERE id = $1`,
          [itemId],
        );
      }
      const row = await mgr.query(
        `SELECT watcher_count FROM prize_configurations WHERE id = $1`,
        [itemId],
      );
      watcherCount = Number(row?.[0]?.watcher_count ?? 0);
    });

    return { watching: true, watcherCount };
  }

  async unwatchItem(
    userId: string,
    itemId: string,
  ): Promise<{ watching: false; watcherCount: number }> {
    let watcherCount = 0;
    await this.dataSource.transaction(async (mgr) => {
      const removed = await mgr.query(
        `DELETE FROM prize_item_watchers WHERE item_id = $1 AND user_id = $2 RETURNING id`,
        [itemId, userId],
      );
      if (Array.isArray(removed) && removed.length > 0) {
        // GREATEST guards against the cached counter ever drifting below 0
        await mgr.query(
          `UPDATE prize_configurations
              SET watcher_count = GREATEST(watcher_count - 1, 0)
            WHERE id = $1`,
          [itemId],
        );
      }
      const row = await mgr.query(
        `SELECT watcher_count FROM prize_configurations WHERE id = $1`,
        [itemId],
      );
      watcherCount = Number(row?.[0]?.watcher_count ?? 0);
    });

    return { watching: false, watcherCount };
  }

  /**
   * Returns the IDs (subset of `itemIds`) the user is currently watching.
   * Used by the public shop endpoints to mark items in the response.
   */
  async getWatchedItemIds(
    userId: string,
    itemIds: string[],
  ): Promise<Set<string>> {
    if (!userId || !itemIds?.length) return new Set();
    const rows = await this.watcherRepository.find({
      where: { userId, itemId: In(itemIds) },
      select: ['itemId'],
    });
    return new Set(rows.map((r) => r.itemId));
  }

  /**
   * The user's full watchlist (most-recently watched first).
   * Returns the underlying PrizeConfiguration entities so the caller
   * (PrizeService) can run them through its existing `mapToDto` for a
   * consistent shape with other prize endpoints.
   */
  async getWatchlistEntities(userId: string): Promise<{
    items: PrizeConfiguration[];
    watchedAtById: Map<string, Date>;
  }> {
    const rows = await this.watcherRepository.find({
      where: { userId },
      relations: ['item', 'item.itemImages', 'item.creator'],
      order: { createdAt: 'DESC' },
    });

    const watchedAtById = new Map<string, Date>();
    const items: PrizeConfiguration[] = [];
    for (const row of rows) {
      if (row.item) {
        watchedAtById.set(row.item.id, row.createdAt);
        items.push(row.item);
      }
    }
    return { items, watchedAtById };
  }

  // ---------------------------------------------------------------------------
  // Notifications (price change + sold out)
  // ---------------------------------------------------------------------------

  /**
   * Notify all current watchers that an item's price has changed.
   * Caller passes the prior amount so we can show before/after in the message.
   */
  async notifyWatchersOfPriceChange(
    item: PrizeConfiguration,
    previousAmount: number,
    newAmount: number,
  ): Promise<void> {
    if (Number(previousAmount) === Number(newAmount)) return;

    const watchers = await this.loadWatcherUsers(item.id);
    if (!watchers.length) return;

    const direction = newAmount < previousAmount ? 'dropped' : 'increased';
    const itemUrl = this.buildItemUrl(item);
    const before = this.formatAmount(previousAmount);
    const after = this.formatAmount(newAmount);

    await Promise.allSettled(
      watchers.map(async (user) => {
        const inbox = this.inboxService
          .sendSystemMessageToUser(
            user.id,
            `The price of **${item.name}** has ${direction} from ${before} to ${after}. [View item](${itemUrl})`,
            { suppressEmail: true },
          )
          .catch((err) =>
            this.logger.warn(
              `[WATCHERS] inbox price-change failed for user ${user.id}: ${(err as Error).message}`,
            ),
          );

        const email = user.email
          ? this.emailsService
              .sendEmailSMTP(
                {
                  toAddress: [user.email],
                  subject: `Price ${direction}: ${item.name}`,
                  params: {
                    userName: user.name || user.username,
                    itemName: item.name,
                    previousAmount: before,
                    newAmount: after,
                    direction,
                    itemUrl,
                  },
                },
                'watcher_price_change',
              )
              .catch((err) =>
                this.logger.warn(
                  `[WATCHERS] price-change email failed for ${user.email}: ${(err as Error).message}`,
                ),
              )
          : Promise.resolve();

        await Promise.allSettled([inbox, email]);
      }),
    );
  }

  /**
   * Notify all current watchers when an item sells out.
   */
  async notifyWatchersOfSoldOut(item: PrizeConfiguration): Promise<void> {
    const watchers = await this.loadWatcherUsers(item.id);
    if (!watchers.length) return;

    const itemUrl = this.buildItemUrl(item);

    await Promise.allSettled(
      watchers.map(async (user) => {
        const inbox = this.inboxService
          .sendSystemMessageToUser(
            user.id,
            `**${item.name}** just sold out. [View item](${itemUrl})`,
            { suppressEmail: true },
          )
          .catch((err) =>
            this.logger.warn(
              `[WATCHERS] inbox sold-out failed for user ${user.id}: ${(err as Error).message}`,
            ),
          );

        const email = user.email
          ? this.emailsService
              .sendEmailSMTP(
                {
                  toAddress: [user.email],
                  subject: `Sold out: ${item.name}`,
                  params: {
                    userName: user.name || user.username,
                    itemName: item.name,
                    itemUrl,
                  },
                },
                'watcher_sold_out',
              )
              .catch((err) =>
                this.logger.warn(
                  `[WATCHERS] sold-out email failed for ${user.email}: ${(err as Error).message}`,
                ),
              )
          : Promise.resolve();

        await Promise.allSettled([inbox, email]);
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadWatcherUsers(itemId: string): Promise<User[]> {
    const watchers = await this.watcherRepository.find({
      where: { itemId },
      relations: ['user'],
    });
    return watchers
      .map((w) => w.user)
      .filter((u): u is User => !!u && u.isActive !== false);
  }

  private formatAmount(amount: number | string): string {
    const n = Number(amount);
    if (!Number.isFinite(n)) return String(amount);
    return n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    });
  }

  private buildItemUrl(item: PrizeConfiguration): string {
    const base =
      this.configService?.get<string>('CLIENT_URL') ||
      process.env.CLIENT_URL ||
      'http://localhost:3000';
    const username = item.creator?.username || 'cardcade';
    return `${base.replace(/\/$/, '')}/shop/${username}?item=${item.id}`;
  }
}
