import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Mixpanel from 'mixpanel';

/**
 * Thin, fail-safe wrapper around the Mixpanel server SDK.
 *
 * Design rules:
 * - **Never throws.** Analytics must never break a business flow, so every
 *   public method swallows errors (logged, not rethrown).
 * - **No-op without a token.** In envs where `MIXPANEL_TOKEN` is unset the
 *   service simply does nothing, so local/dev/test boots and runs normally.
 * - **distinctId = CardCade user UUID.** The web client calls
 *   `mixpanel.identify(userId)` with the same UUID, so server and client
 *   events land on one profile.
 */
@Injectable()
export class MixpanelService implements OnModuleInit {
  private readonly logger = new Logger(MixpanelService.name);
  private mp: Mixpanel.Mixpanel | null = null;
  private environment = 'development';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const token = this.configService.get<string>('mixpanel.token');
    this.environment =
      this.configService.get<string>('mixpanel.environment') || 'development';

    if (!token) {
      this.logger.warn(
        'MIXPANEL_TOKEN not set — Mixpanel analytics disabled (no-op).',
      );
      return;
    }

    try {
      this.mp = Mixpanel.init(token, { keepAlive: false });
      this.logger.log(
        `Mixpanel initialized (environment="${this.environment}").`,
      );
    } catch (err) {
      this.logger.error(
        `Mixpanel init failed: ${err instanceof Error ? err.message : err}`,
      );
      this.mp = null;
    }
  }

  get enabled(): boolean {
    return this.mp !== null;
  }

  /**
   * Fire-and-forget event. `distinctId` should be the CardCade user UUID;
   * pass null/undefined for genuinely anonymous server events.
   */
  track(
    event: string,
    distinctId: string | null | undefined,
    properties: Record<string, unknown> = {},
  ): void {
    if (!this.mp) return;
    try {
      this.mp.track(event, {
        ...(distinctId ? { distinct_id: distinctId } : {}),
        app_environment: this.environment,
        source: 'server',
        ...this.clean(properties),
      });
    } catch (err) {
      this.logger.error(
        `Mixpanel track("${event}") failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Set/merge profile properties on a user. Use Mixpanel reserved keys
   * ($email, $name) for the people-table display columns.
   */
  setPeople(distinctId: string, properties: Record<string, unknown>): void {
    if (!this.mp || !distinctId) return;
    try {
      this.mp.people.set(distinctId, this.clean(properties));
    } catch (err) {
      this.logger.error(
        `Mixpanel people.set failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Record revenue against a user so Mixpanel revenue/LTV reports populate.
   * Amount is USD. Ignored for non-positive/non-finite amounts.
   */
  trackCharge(
    distinctId: string,
    amountUsd: number,
    properties: Record<string, unknown> = {},
  ): void {
    if (!this.mp || !distinctId) return;
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return;
    try {
      this.mp.people.track_charge(
        distinctId,
        amountUsd,
        this.clean(properties),
      );
    } catch (err) {
      this.logger.error(
        `Mixpanel track_charge failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Drop undefined/null props so Mixpanel doesn't store empty columns. */
  private clean(
    properties: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (v !== undefined && v !== null) out[k] = v;
    }
    return out;
  }
}
