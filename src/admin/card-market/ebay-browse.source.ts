import { Injectable, Logger } from '@nestjs/common';

/** Live eBay listing context for a card (ACTIVE listings = asks, not sales). */
export interface EbayListingContext {
  /** Number of active listings matched. */
  activeCount: number;
  /** Lowest current ask (USD) — a soft ceiling / liquidity signal, NOT a comp. */
  lowestAskUsd: number | null;
  currency: string;
  /** A link to browse the live listings. */
  url: string;
}

/**
 * eBay Browse API — live ACTIVE listings for a card. These are ASKS, not sold
 * comps (sold data needs the Marketplace Insights API + special approval, which
 * this keyset lacks), so they are used only as CONTEXT: a lowest-ask ceiling, a
 * liquidity signal, and a real "shop it" link — never as the valuation price.
 *
 * Dormant unless EBAY_CLIENT_ID + EBAY_CLIENT_SECRET are set.
 */
@Injectable()
export class EbayBrowseSource {
  private readonly logger = new Logger(EbayBrowseSource.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  isConfigured(): boolean {
    return !!process.env.EBAY_CLIENT_ID && !!process.env.EBAY_CLIENT_SECRET;
  }

  /** OAuth client-credentials token (cached ~2h). */
  private async getToken(): Promise<string | null> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60000) return this.token;
    if (!this.isConfigured()) return null;
    const basic = Buffer.from(
      `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`,
    ).toString('base64');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    try {
      const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body:
          'grant_type=client_credentials&scope=' +
          encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const j = (await r.json()) as { access_token?: string; expires_in?: number };
      if (!j.access_token) return null;
      this.token = j.access_token;
      this.tokenExpiresAt = Date.now() + (j.expires_in ?? 7200) * 1000;
      return this.token;
    } catch (e) {
      this.logger.warn(`eBay token failed: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  /** Active-listing context for a card subject (best-effort; null on any miss). */
  async listingContext(subject: string): Promise<EbayListingContext | null> {
    const q = (subject ?? '').trim().slice(0, 200);
    if (!q || !this.isConfigured()) return null;
    const token = await this.getToken();
    if (!token) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const url =
        'https://api.ebay.com/buy/browse/v1/item_summary/search?limit=50&q=' +
        encodeURIComponent(q);
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
        signal: ctrl.signal,
      });
      if (!r.ok) return null;
      const j = (await r.json()) as {
        total?: number;
        itemSummaries?: { price?: { value?: string; currency?: string } }[];
      };
      const items = j.itemSummaries ?? [];
      let lowest: number | null = null;
      let currency = 'USD';
      for (const it of items) {
        const v = parseFloat(it.price?.value ?? '');
        if (Number.isFinite(v) && v > 0 && (lowest == null || v < lowest)) {
          lowest = v;
          currency = it.price?.currency ?? 'USD';
        }
      }
      return {
        activeCount: j.total ?? items.length,
        lowestAskUsd: lowest,
        currency,
        url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
      };
    } catch (e) {
      this.logger.warn(`eBay browse failed: ${(e as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
