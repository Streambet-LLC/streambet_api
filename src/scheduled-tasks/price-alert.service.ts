import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, IsNull, Repository } from 'typeorm';
import { TrackedCard } from 'src/admin/entities/tracked-card.entity';
import { User } from 'src/users/entities/user.entity';
import { MarketService } from 'src/admin/market.service';
import { EmailsService } from 'src/emails/email.service';
import { EmailPayloadDto } from 'src/emails/dto/email.dto';
import { EmailType } from 'src/enums/email-type.enum';

/**
 * Ceiling on how many holdings a single run will re-value. Each valuation is a
 * live web-research call, so this is a real spend limit, not a perf guard — a
 * runaway watchlist should cost a capped amount per night, not an unbounded
 * one. Anything beyond the cap is skipped and logged, never silently dropped.
 */
const MAX_VALUATIONS_PER_RUN = 100;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Nightly price-alert mailer.
 *
 * Re-values every holding that has a target set, then emails the owner when a
 * target is newly crossed. "Newly" is the important word: the crossing is
 * recorded on the card, so sitting above a target does not re-send every night.
 *
 * Only user-set targets are emailed. The dashboard's automatic ">=8% move"
 * alerts are deliberately excluded — nobody asked for those, and a volatile
 * card would mail every run.
 */
@Injectable()
export class PriceAlertService {
  private readonly logger = new Logger(PriceAlertService.name);

  constructor(
    @InjectRepository(TrackedCard)
    private readonly cards: Repository<TrackedCard>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly market: MarketService,
    private readonly emails: EmailsService,
  ) {}

  /**
   * Overnight so the expensive re-valuation never competes with interactive
   * chat traffic, and the mail lands before the morning.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async run(): Promise<void> {
    if (process.env.PRICE_ALERTS_ENABLED === 'false') return;
    try {
      await this.checkAlerts();
    } catch (e) {
      // A scheduled task must never take the process down.
      this.logger.error(`price alert run failed: ${(e as Error).message}`);
    }
  }

  /** Exposed so it can be triggered manually (and tested) without waiting. */
  async checkAlerts(): Promise<{ valued: number; emailed: number }> {
    // Only cards with a target are worth the valuation spend.
    const armed = await this.cards.find({
      where: [
        { owned: true, alertAboveUsd: Not(IsNull()) },
        { owned: true, alertBelowUsd: Not(IsNull()) },
      ],
      take: MAX_VALUATIONS_PER_RUN,
    });
    if (armed.length === 0) return { valued: 0, emailed: 0 };

    const total = await this.cards.count({
      where: [
        { owned: true, alertAboveUsd: Not(IsNull()) },
        { owned: true, alertBelowUsd: Not(IsNull()) },
      ],
    });
    if (total > armed.length) {
      this.logger.warn(
        `${total} holdings have alerts but only ${armed.length} were valued this run (MAX_VALUATIONS_PER_RUN)`,
      );
    }

    // Bounded concurrency, matching valuePortfolio — these are AI calls.
    let valued = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < armed.length; i += CONCURRENCY) {
      await Promise.all(
        armed.slice(i, i + CONCURRENCY).map(async (c) => {
          try {
            await this.market.valueCard(c.id);
            valued++;
          } catch (e) {
            this.logger.warn(
              `valuation failed for "${c.name}": ${(e as Error).message}`,
            );
          }
        }),
      );
    }

    // Re-read: valueCard wrote the fresh values back to these rows.
    const fresh = await this.cards.find({
      where: { id: In(armed.map((c) => c.id)) },
    });
    let emailed = 0;
    for (const card of fresh) {
      if (await this.processCard(card)) emailed++;
    }

    this.logger.log(
      `price alerts: valued ${valued}/${armed.length}, emailed ${emailed}`,
    );
    return { valued, emailed };
  }

  /**
   * Decide whether this card owes an email, send it, and record the outcome.
   * Returns true only when mail actually went out.
   */
  private async processCard(card: TrackedCard): Promise<boolean> {
    const value = card.lastValueUsd;
    if (value == null) return false;

    const above = card.alertAboveUsd;
    const below = card.alertBelowUsd;
    const crossed: { direction: 'above' | 'below'; target: number } | null =
      above != null && value >= above
        ? { direction: 'above', target: above }
        : below != null && value <= below
          ? { direction: 'below', target: below }
          : null;

    if (!crossed) {
      // Back inside the band — re-arm so the next crossing mails again.
      if (card.alertNotifiedTargetUsd != null) {
        await this.cards.update(card.id, {
          alertNotifiedTargetUsd: null,
          alertNotifiedAt: null,
        });
      }
      return false;
    }

    // Already mailed for THIS target. Comparing the target (not a bare flag)
    // means editing the target re-arms the alert, which is what someone who
    // just changed their mind about a price expects.
    if (card.alertNotifiedTargetUsd === crossed.target) return false;

    const to = await this.recipientFor(card);
    if (!to) {
      this.logger.warn(`no recipient for alert on "${card.name}" — skipped`);
      return false;
    }

    // The full valuation snapshot carries the one-line "why" behind the
    // confidence — worth including so the mail is defensible, not just a number.
    const basis =
      typeof card.lastValuation?.confidenceBasis === 'string'
        ? card.lastValuation.confidenceBasis
        : undefined;

    const payload: EmailPayloadDto = {
      toAddress: [to],
      subject:
        crossed.direction === 'below'
          ? `${card.name} fell below ${money(crossed.target)}`
          : `${card.name} hit ${money(crossed.target)}`,
      params: {
        cardName: card.name,
        grade: card.grade ?? undefined,
        direction: crossed.direction,
        targetUsd: money(crossed.target),
        valueUsd: money(value),
        confidencePct:
          card.lastConfidencePct != null
            ? String(card.lastConfidencePct)
            : undefined,
        basis,
        siteLink: `${process.env.APP_HOST_URL ?? ''}/analytics`,
      },
    } as EmailPayloadDto;

    try {
      await this.emails.sendEmailSMTP(payload, EmailType.PriceAlert);
    } catch (e) {
      // Leave the card un-stamped so the next run retries rather than the
      // alert being lost to a transient SMTP failure.
      this.logger.warn(
        `alert email failed for "${card.name}": ${(e as Error).message}`,
      );
      return false;
    }

    await this.cards.update(card.id, {
      alertNotifiedTargetUsd: crossed.target,
      alertNotifiedAt: new Date(),
    });
    return true;
  }

  /**
   * Who to mail: the card's owner, else the admin who added it, else the
   * configured ADMIN_EMAIL. Everything is admin-owned today, so the fallback
   * is the path that actually runs — it stops being needed once sign-ups open
   * and ownerUserId is populated.
   */
  private async recipientFor(card: TrackedCard): Promise<string | null> {
    const userId = card.ownerUserId ?? card.addedByAdminId;
    if (userId) {
      const user = await this.users
        .findOne({ where: { id: userId } })
        .catch(() => null);
      if (user?.email) return user.email;
    }
    return process.env.ADMIN_EMAIL || null;
  }
}
