import { Injectable, Logger } from '@nestjs/common';

/** A real, structured market price pulled from a data API (not web_search). */
export interface StructuredPrice {
  priceUsd: number;
  /** When the price was last updated (YYYY-MM-DD), if known. */
  date: string | null;
  url: string | null;
  /** Short label for display, e.g. "TCGplayer market (raw)". */
  label: string;
  /** True when this is a RAW-card price (not the graded-slab value). */
  isRawOnly: boolean;
}

interface PtcgCard {
  number?: string;
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, { market?: number | null; mid?: number | null }>;
  };
  cardmarket?: {
    url?: string;
    updatedAt?: string;
    prices?: { averageSellPrice?: number | null; trendPrice?: number | null };
  };
}

/**
 * Structured Pokémon pricing via the free Pokémon TCG API (pokemontcg.io) — no
 * key, exact card data, real TCGplayer/Cardmarket market prices. NOTE these are
 * RAW-card prices, so for a graded slab (PSA/BGS 10) they are a reference/floor,
 * not the graded value. Used as a deterministic corroborating signal (and the
 * point value for raw cards) alongside sale comps.
 */
@Injectable()
export class PokemonPriceSource {
  private readonly logger = new Logger(PokemonPriceSource.name);

  /** Does the subject look like a Pokémon card? */
  isPokemon(subject: string): boolean {
    return /pok[eé]mon|pokemon/i.test(subject);
  }

  /** Best-effort card number from a subject (#199, 199/165, GG69, SVP-183). */
  private extractNumber(subject: string): string {
    const s = subject || '';
    const hash = s.match(/#\s*([A-Za-z]*\d+[A-Za-z]*)/);
    if (hash) return hash[1];
    const gg = s.match(/\b([A-Z]{1,3}\d{1,3})\b/);
    if (gg) return gg[1];
    const frac = s.match(/\b(\d{1,3})\s*\/\s*\d{2,3}\b/);
    if (frac) return frac[1];
    return '';
  }

  /**
   * Reduce a subject to the core card name the pokemontcg.io `name:` field
   * expects — strip year, "Pokémon", the grade, the number, set-size fractions,
   * and the common rarity/finish qualifiers, leaving "Charizard ex" etc.
   */
  private extractCore(subject: string): string {
    return (subject || '')
      .replace(/["\\]/g, ' ')
      .replace(/\b(19|20)\d{2}\b/g, ' ') // year
      .replace(/pok[eé]mon/gi, ' ')
      .replace(/\b(psa|bgs|cgc|sgc)\s*\d+(\.\d)?\b/gi, ' ') // grade
      .replace(/#\s*[A-Za-z]*\d+[A-Za-z]*/g, ' ') // #199 / #GG69
      .replace(/\b\d{1,3}\s*\/\s*\d{2,3}\b/g, ' ') // 199/165
      .replace(
        /\b(special illustration rare|illustration rare|full art|alt art|alternate art|secret rare|rainbow rare|gold|hyper rare|ultra rare|reverse holo(foil)?|holo(foil)?|1st edition|first edition|unlimited|shadowless|promo|gem mint|SIR|SVP)\b/gi,
        ' ',
      )
      .replace(/[—(].*$/, ' ') // drop trailing set/paren blob
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  /**
   * Best raw market price for a Pokémon card by name (+ number when present).
   * Returns null on any miss so the caller degrades gracefully.
   */
  async fetch(
    name: string,
    number?: string | null,
  ): Promise<StructuredPrice | null> {
    const num = (number ? String(number) : this.extractNumber(name))
      .replace(/[^0-9A-Za-z]/g, '')
      .trim();
    const core = this.extractCore(name);
    if (!core && !num) return null;
    const subjectLc = (name || '').toLowerCase();
    // Gentle on the keyless rate limit: number-first + a couple of name tokens.
    const tokens = core
      .split(/\s+/)
      .filter(t => t.length >= 3)
      .slice(0, 3);
    const key = process.env.POKEMONTCG_API_KEY;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (key) headers['X-Api-Key'] = key;

    const runList = async (q: string): Promise<PtcgCard[]> => {
      const url =
        'https://api.pokemontcg.io/v2/cards?pageSize=25&orderBy=-set.releaseDate' +
        `&q=${encodeURIComponent(q)}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      try {
        const r = await fetch(url, { headers, signal: ctrl.signal });
        if (!r.ok) return [];
        const j = (await r.json()) as {
          data?: (PtcgCard & { name?: string; set?: { name?: string } })[];
        };
        return j.data ?? [];
      } catch {
        return [];
      } finally {
        clearTimeout(t);
      }
    };

    // Pick the card whose NAME appears in the subject (strict — a wrong card
    // would mean a wrong price). Prefer a set match; if the name is ambiguous
    // across sets with no set confirmation, skip rather than risk a mismatch.
    const pick = (cards: (PtcgCard & { name?: string; set?: { name?: string } })[]) => {
      const named = cards.filter(
        c => c.name && subjectLc.includes(c.name.toLowerCase()),
      );
      if (named.length === 0) return null;
      const withSet = named.find(
        c => c.set?.name && subjectLc.includes(c.set.name.toLowerCase()),
      );
      if (withSet) return withSet;
      return named.length === 1 ? named[0] : null;
    };

    try {
      // Number-first (most robust: the card number narrows to a handful across
      // sets, then we match by name/set in the subject). Then name-token fallbacks.
      let cards: (PtcgCard & { name?: string; set?: { name?: string } })[] = [];
      if (num) cards = await runList(`number:"${num}"`);
      let card = pick(cards);
      if (!card) {
        for (const tok of tokens) {
          const list = await runList(
            num ? `name:${tok} number:"${num}"` : `name:${tok}`,
          );
          card = pick(list);
          if (card) break;
        }
      }
      if (!card) return null;

      // Highest TCGplayer market across print variants (holo/normal/etc.).
      const tp = card.tcgplayer?.prices ?? {};
      let market: number | null = null;
      for (const v of Object.values(tp)) {
        const m = v?.market ?? v?.mid ?? null;
        if (typeof m === 'number' && (market == null || m > market)) market = m;
      }
      let url = card.tcgplayer?.url ?? null;
      let date = card.tcgplayer?.updatedAt ?? null;
      let label = 'TCGplayer market (raw)';
      // Fall back to Cardmarket if TCGplayer had no usable price.
      if (market == null) {
        const cm = card.cardmarket?.prices;
        market = cm?.trendPrice ?? cm?.averageSellPrice ?? null;
        url = card.cardmarket?.url ?? url;
        date = card.cardmarket?.updatedAt ?? date;
        label = 'Cardmarket trend (raw)';
      }
      if (market == null || market <= 0) return null;

      return {
        priceUsd: Math.round(market * 100) / 100,
        date: date ? date.slice(0, 10) : null,
        url,
        label,
        isRawOnly: true,
      };
    } catch (e) {
      this.logger.warn(`pokemon price lookup failed: ${(e as Error).message}`);
      return null;
    }
  }
}
