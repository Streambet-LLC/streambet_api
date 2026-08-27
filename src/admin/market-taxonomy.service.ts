import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MarketTaxonomyNode, TaxonomyKind } from './entities/market-taxonomy.entity';

/** A resolved set of taxonomy keys for one card (any field may be null). */
export interface TaxonomyTags {
  marketKey: string | null;
  subCategoryKey: string | null;
  setKey: string | null;
  playerKey: string | null;
  cardKey: string | null;
}

interface SeedNode {
  kind: TaxonomyKind;
  rootMarket: string;
  parentKey: string | null;
  key: string;
  label: string;
  matchTerms: string[];
  query?: string;
  heatScope?: 'segment' | 'set' | 'card' | 'player';
  sortOrder?: number;
}

/**
 * The proposed default taxonomy — markets → sub-categories → sets, plus
 * cross-cutting player/character subject nodes and the existing marquee cards.
 * Keys reuse the live heat-topic keys where they overlap so the taxonomy stays
 * continuous with `market_heat_points` / `market_listings`. This is a starting
 * point: `seedDefaults()` upserts it, then admins curate (edits are preserved
 * on re-seed because curated rows are never overwritten).
 */
export const DEFAULT_TAXONOMY: SeedNode[] = [
  // ---------- Markets ----------
  { kind: 'market', rootMarket: 'pokemon', parentKey: null, key: 'pokemon', label: 'Pokémon', matchTerms: ['pokemon', 'pokémon', 'pkmn'], query: 'pokemon card', heatScope: 'segment', sortOrder: 1 },
  { kind: 'market', rootMarket: 'one_piece', parentKey: null, key: 'one_piece', label: 'One Piece', matchTerms: ['one piece'], query: 'one piece card', heatScope: 'segment', sortOrder: 2 },
  { kind: 'market', rootMarket: 'sports', parentKey: null, key: 'sports', label: 'Sports', matchTerms: ['sport', 'basketball', 'football', 'baseball', 'nba', 'nfl', 'mlb', 'panini', 'topps', 'soccer'], query: 'sports card', heatScope: 'segment', sortOrder: 3 },
  { kind: 'market', rootMarket: 'magic', parentKey: null, key: 'magic', label: 'Magic: The Gathering', matchTerms: ['magic', 'mtg', 'gathering'], query: 'magic the gathering card', heatScope: 'segment', sortOrder: 4 },
  { kind: 'market', rootMarket: 'lorcana', parentKey: null, key: 'lorcana', label: 'Disney Lorcana', matchTerms: ['lorcana'], query: 'disney lorcana card', heatScope: 'segment', sortOrder: 5 },
  { kind: 'market', rootMarket: 'all', parentKey: null, key: 'all', label: 'All TCG', matchTerms: [], query: 'trading card game', heatScope: 'segment', sortOrder: 6 },

  // ---------- Pokémon ----------
  { kind: 'subcategory', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.sub.japanese', label: 'Japanese', matchTerms: ['japanese', 'japan', ' jp '], sortOrder: 1 },
  { kind: 'subcategory', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.sub.vintage', label: 'Vintage (WOTC)', matchTerms: ['base set', 'wotc', '1999', 'fossil', 'jungle', 'neo ', 'gym '], sortOrder: 2 },
  { kind: 'subcategory', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.sub.sealed', label: 'Sealed', matchTerms: ['booster box', 'elite trainer', 'etb', 'booster bundle', 'sealed', 'booster pack'], sortOrder: 3 },
  { kind: 'subcategory', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.sub.graded', label: 'Graded Slabs', matchTerms: ['psa', 'bgs', 'cgc', 'sgc'], sortOrder: 4 },
  { kind: 'subcategory', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.sub.modern', label: 'English Modern', matchTerms: ['scarlet', 'violet', 'sword', 'shield', 'sun moon'], sortOrder: 5 },
  { kind: 'set', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'set_pkm_151', label: 'Pokémon 151', matchTerms: ['151'], query: 'pokemon 151 card', heatScope: 'set', sortOrder: 1 },
  { kind: 'set', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'set_pkm_surging', label: 'Surging Sparks', matchTerms: ['surging sparks'], query: 'pokemon surging sparks', heatScope: 'set', sortOrder: 2 },
  { kind: 'set', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'set_pkm_prismatic', label: 'Prismatic Evolutions', matchTerms: ['prismatic'], query: 'pokemon prismatic evolutions', heatScope: 'set', sortOrder: 3 },
  { kind: 'set', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'set_pkm_evolving', label: 'Evolving Skies', matchTerms: ['evolving skies'], query: 'pokemon evolving skies', heatScope: 'set', sortOrder: 4 },
  { kind: 'set', rootMarket: 'pokemon', parentKey: 'pkm.sub.vintage', key: 'set_pkm_base', label: 'Base Set', matchTerms: ['base set'], query: 'pokemon base set', heatScope: 'set', sortOrder: 5 },
  { kind: 'set', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'set_pkm_crown', label: 'Crown Zenith', matchTerms: ['crown zenith'], query: 'pokemon crown zenith', heatScope: 'set', sortOrder: 6 },
  { kind: 'player', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.char.charizard', label: 'Charizard', matchTerms: ['charizard'], query: 'charizard pokemon card', heatScope: 'player', sortOrder: 1 },
  { kind: 'player', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.char.pikachu', label: 'Pikachu', matchTerms: ['pikachu'], query: 'pikachu pokemon card', heatScope: 'player', sortOrder: 2 },
  { kind: 'player', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.char.umbreon', label: 'Umbreon', matchTerms: ['umbreon'], query: 'umbreon pokemon card', heatScope: 'player', sortOrder: 3 },
  { kind: 'player', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.char.mewtwo', label: 'Mewtwo', matchTerms: ['mewtwo'], query: 'mewtwo pokemon card', heatScope: 'player', sortOrder: 4 },
  { kind: 'player', rootMarket: 'pokemon', parentKey: 'pokemon', key: 'pkm.char.lugia', label: 'Lugia', matchTerms: ['lugia'], query: 'lugia pokemon card', heatScope: 'player', sortOrder: 5 },
  { kind: 'card', rootMarket: 'pokemon', parentKey: 'set_pkm_evolving', key: 'card_moonbreon', label: 'Umbreon VMAX Alt Art (Moonbreon)', matchTerms: ['moonbreon', 'umbreon vmax alt'], query: 'umbreon vmax alt art 215', heatScope: 'card', sortOrder: 1 },
  { kind: 'card', rootMarket: 'pokemon', parentKey: 'set_pkm_base', key: 'card_charizard_base', label: 'Base Set Charizard', matchTerms: ['base set charizard'], query: 'charizard base set holo', heatScope: 'card', sortOrder: 2 },

  // ---------- One Piece ----------
  { kind: 'subcategory', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.sub.japanese', label: 'Japanese', matchTerms: ['japanese', 'japan', ' jp '], sortOrder: 1 },
  { kind: 'subcategory', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.sub.sealed', label: 'Sealed', matchTerms: ['booster box', 'sealed', 'booster pack'], sortOrder: 2 },
  { kind: 'subcategory', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.sub.graded', label: 'Graded Slabs', matchTerms: ['psa', 'bgs', 'cgc'], sortOrder: 3 },
  { kind: 'subcategory', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.sub.alt_art', label: 'Alt-Art / Manga', matchTerms: ['alt art', 'manga', 'parallel', 'secret rare'], sortOrder: 4 },
  { kind: 'set', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'set_op_09', label: 'OP-09 Emperors', matchTerms: ['op-09', 'op09'], query: 'one piece OP-09', heatScope: 'set', sortOrder: 1 },
  { kind: 'set', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'set_op_07', label: 'OP-07 500 Years', matchTerms: ['op-07', 'op07'], query: 'one piece OP-07', heatScope: 'set', sortOrder: 2 },
  { kind: 'set', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'set_op_05', label: 'OP-05 Awakening', matchTerms: ['op-05', 'op05'], query: 'one piece OP-05', heatScope: 'set', sortOrder: 3 },
  { kind: 'set', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'set_op_01', label: 'Romance Dawn (OP-01)', matchTerms: ['op-01', 'op01', 'romance dawn'], query: 'one piece romance dawn', heatScope: 'set', sortOrder: 4 },
  { kind: 'player', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.char.luffy', label: 'Luffy', matchTerms: ['luffy'], query: 'one piece luffy card', heatScope: 'player', sortOrder: 1 },
  { kind: 'player', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.char.zoro', label: 'Zoro', matchTerms: ['zoro'], query: 'one piece zoro card', heatScope: 'player', sortOrder: 2 },
  { kind: 'player', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.char.shanks', label: 'Shanks', matchTerms: ['shanks'], query: 'one piece shanks card', heatScope: 'player', sortOrder: 3 },
  { kind: 'player', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.char.nami', label: 'Nami', matchTerms: ['nami'], query: 'one piece nami card', heatScope: 'player', sortOrder: 4 },
  { kind: 'player', rootMarket: 'one_piece', parentKey: 'one_piece', key: 'op.char.ace', label: 'Ace', matchTerms: ['portgas', 'ace '], query: 'one piece ace card', heatScope: 'player', sortOrder: 5 },

  // ---------- Sports ----------
  { kind: 'subcategory', rootMarket: 'sports', parentKey: 'sports', key: 'sports.sub.basketball', label: 'Basketball (NBA)', matchTerms: ['basketball', 'nba'], sortOrder: 1 },
  { kind: 'subcategory', rootMarket: 'sports', parentKey: 'sports', key: 'sports.sub.football', label: 'Football (NFL)', matchTerms: ['football', 'nfl'], sortOrder: 2 },
  { kind: 'subcategory', rootMarket: 'sports', parentKey: 'sports', key: 'sports.sub.baseball', label: 'Baseball (MLB)', matchTerms: ['baseball', 'mlb'], sortOrder: 3 },
  { kind: 'subcategory', rootMarket: 'sports', parentKey: 'sports', key: 'sports.sub.soccer', label: 'Soccer', matchTerms: ['soccer', 'fifa', 'uefa', 'premier league'], sortOrder: 4 },
  { kind: 'subcategory', rootMarket: 'sports', parentKey: 'sports', key: 'sports.sub.graded', label: 'Graded Slabs', matchTerms: ['psa', 'bgs', 'cgc', 'sgc'], sortOrder: 5 },
  { kind: 'set', rootMarket: 'sports', parentKey: 'sports', key: 'set_sports_prizm', label: 'Panini Prizm', matchTerms: ['prizm'], query: 'panini prizm card', heatScope: 'set', sortOrder: 1 },
  { kind: 'set', rootMarket: 'sports', parentKey: 'sports', key: 'set_sports_toppschrome', label: 'Topps Chrome', matchTerms: ['topps chrome'], query: 'topps chrome card', heatScope: 'set', sortOrder: 2 },
  { kind: 'set', rootMarket: 'sports', parentKey: 'sports', key: 'set_sports_select', label: 'Panini Select', matchTerms: ['select'], query: 'panini select card', heatScope: 'set', sortOrder: 3 },
  { kind: 'set', rootMarket: 'sports', parentKey: 'sports', key: 'set_sports_optic', label: 'Donruss Optic', matchTerms: ['optic'], query: 'donruss optic card', heatScope: 'set', sortOrder: 4 },
  { kind: 'set', rootMarket: 'sports', parentKey: 'sports', key: 'set_sports_bowman', label: 'Bowman Chrome', matchTerms: ['bowman'], query: 'bowman chrome card', heatScope: 'set', sortOrder: 5 },
  { kind: 'player', rootMarket: 'sports', parentKey: 'sports', key: 'sports.player.lebron', label: 'LeBron James', matchTerms: ['lebron'], query: 'lebron james card', heatScope: 'player', sortOrder: 1 },
  { kind: 'player', rootMarket: 'sports', parentKey: 'sports', key: 'sports.player.jordan', label: 'Michael Jordan', matchTerms: ['jordan'], query: 'michael jordan card', heatScope: 'player', sortOrder: 2 },
  { kind: 'player', rootMarket: 'sports', parentKey: 'sports', key: 'sports.player.wembanyama', label: 'Victor Wembanyama', matchTerms: ['wembanyama', 'wemby'], query: 'victor wembanyama card', heatScope: 'player', sortOrder: 3 },
  { kind: 'player', rootMarket: 'sports', parentKey: 'sports', key: 'sports.player.ohtani', label: 'Shohei Ohtani', matchTerms: ['ohtani'], query: 'shohei ohtani card', heatScope: 'player', sortOrder: 4 },
  { kind: 'player', rootMarket: 'sports', parentKey: 'sports', key: 'sports.player.caitlin_clark', label: 'Caitlin Clark', matchTerms: ['caitlin clark'], query: 'caitlin clark card', heatScope: 'player', sortOrder: 5 },
  { kind: 'player', rootMarket: 'sports', parentKey: 'sports', key: 'sports.player.brady', label: 'Tom Brady', matchTerms: ['brady'], query: 'tom brady card', heatScope: 'player', sortOrder: 6 },
  { kind: 'card', rootMarket: 'sports', parentKey: 'set_sports_prizm', key: 'card_lebron_prizm', label: 'LeBron Prizm', matchTerms: ['lebron prizm'], query: 'lebron james prizm', heatScope: 'card', sortOrder: 1 },
  { kind: 'card', rootMarket: 'sports', parentKey: 'sports', key: 'card_jordan_fleer', label: 'Jordan Fleer RC', matchTerms: ['jordan fleer', '1986 fleer'], query: 'michael jordan 1986 fleer rookie', heatScope: 'card', sortOrder: 2 },

  // ---------- Magic ----------
  { kind: 'subcategory', rootMarket: 'magic', parentKey: 'magic', key: 'mtg.sub.reserved', label: 'Reserved List / Vintage', matchTerms: ['reserved list', 'alpha', 'beta', 'unlimited', 'revised', 'dual land'], sortOrder: 1 },
  { kind: 'subcategory', rootMarket: 'magic', parentKey: 'magic', key: 'mtg.sub.commander', label: 'Commander (EDH)', matchTerms: ['commander', 'edh'], sortOrder: 2 },
  { kind: 'subcategory', rootMarket: 'magic', parentKey: 'magic', key: 'mtg.sub.sealed', label: 'Sealed', matchTerms: ['booster box', 'collector booster', 'sealed', 'bundle'], sortOrder: 3 },
  { kind: 'subcategory', rootMarket: 'magic', parentKey: 'magic', key: 'mtg.sub.graded', label: 'Graded Slabs', matchTerms: ['psa', 'bgs', 'cgc'], sortOrder: 4 },
  { kind: 'set', rootMarket: 'magic', parentKey: 'magic', key: 'set_mtg_mh3', label: 'Modern Horizons 3', matchTerms: ['modern horizons 3', 'mh3'], query: 'magic modern horizons 3', heatScope: 'set', sortOrder: 1 },
  { kind: 'set', rootMarket: 'magic', parentKey: 'magic', key: 'set_mtg_ltr', label: 'Lord of the Rings', matchTerms: ['lord of the rings', 'tales of middle-earth'], query: 'magic lord of the rings tales', heatScope: 'set', sortOrder: 2 },
  { kind: 'set', rootMarket: 'magic', parentKey: 'mtg.sub.reserved', key: 'set_mtg_power', label: 'Alpha / Beta Power', matchTerms: ['black lotus', 'power nine', 'mox '], query: 'magic the gathering black lotus', heatScope: 'set', sortOrder: 3 },
  { kind: 'player', rootMarket: 'magic', parentKey: 'magic', key: 'mtg.char.black_lotus', label: 'Black Lotus', matchTerms: ['black lotus'], query: 'magic black lotus', heatScope: 'player', sortOrder: 1 },
  { kind: 'player', rootMarket: 'magic', parentKey: 'magic', key: 'mtg.char.ragavan', label: 'Ragavan', matchTerms: ['ragavan'], query: 'magic ragavan', heatScope: 'player', sortOrder: 2 },

  // ---------- Lorcana ----------
  { kind: 'subcategory', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.sub.enchanted', label: 'Enchanted / Alt-Art', matchTerms: ['enchanted', 'alt art'], sortOrder: 1 },
  { kind: 'subcategory', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.sub.sealed', label: 'Sealed', matchTerms: ['booster box', 'sealed', 'illumineer'], sortOrder: 2 },
  { kind: 'subcategory', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.sub.graded', label: 'Graded Slabs', matchTerms: ['psa', 'bgs', 'cgc'], sortOrder: 3 },
  { kind: 'set', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'set_lorcana_ch1', label: 'The First Chapter', matchTerms: ['first chapter'], query: 'lorcana first chapter', heatScope: 'set', sortOrder: 1 },
  { kind: 'set', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'set_lorcana_floodborn', label: 'Rise of the Floodborn', matchTerms: ['floodborn'], query: 'lorcana rise of the floodborn', heatScope: 'set', sortOrder: 2 },
  { kind: 'set', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'set_lorcana_inklands', label: 'Into the Inklands', matchTerms: ['inklands'], query: 'lorcana into the inklands', heatScope: 'set', sortOrder: 3 },
  { kind: 'set', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'set_lorcana_ursula', label: "Ursula's Return", matchTerms: ['ursula'], query: 'lorcana ursula return', heatScope: 'set', sortOrder: 4 },
  { kind: 'player', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.char.elsa', label: 'Elsa', matchTerms: ['elsa'], query: 'lorcana elsa', heatScope: 'player', sortOrder: 1 },
  { kind: 'player', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.char.mickey', label: 'Mickey', matchTerms: ['mickey'], query: 'lorcana mickey', heatScope: 'player', sortOrder: 2 },
  { kind: 'player', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.char.stitch', label: 'Stitch', matchTerms: ['stitch'], query: 'lorcana stitch', heatScope: 'player', sortOrder: 3 },
  { kind: 'player', rootMarket: 'lorcana', parentKey: 'lorcana', key: 'lorcana.char.maleficent', label: 'Maleficent', matchTerms: ['maleficent'], query: 'lorcana maleficent', heatScope: 'player', sortOrder: 4 },
];

@Injectable()
export class MarketTaxonomyService {
  /** Small table; cache the active node set and invalidate on any write. */
  private cache: MarketTaxonomyNode[] | null = null;

  constructor(
    @InjectRepository(MarketTaxonomyNode)
    private readonly repo: Repository<MarketTaxonomyNode>,
    private readonly ds: DataSource,
  ) {}

  private invalidate() {
    this.cache = null;
  }

  private async nodes(): Promise<MarketTaxonomyNode[]> {
    if (!this.cache) {
      this.cache = await this.repo.find({ order: { rootMarket: 'ASC', kind: 'ASC', sortOrder: 'ASC' } });
    }
    return this.cache;
  }

  // ---------------------------------------------------------------- seed ----

  /**
   * Idempotently upsert the default tree. Curated rows are never overwritten,
   * so hand edits survive re-seeds; new default nodes are still inserted.
   */
  async seedDefaults(): Promise<{ seeded: number; total: number }> {
    for (const n of DEFAULT_TAXONOMY) {
      await this.ds.query(
        `INSERT INTO "market_taxonomy"
           ("kind","rootMarket","parentKey","key","label","matchTerms","query","heatScope","sortOrder")
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)
         ON CONFLICT ("key") DO UPDATE SET
           "kind"=EXCLUDED."kind",
           "rootMarket"=EXCLUDED."rootMarket",
           "parentKey"=EXCLUDED."parentKey",
           "label"=EXCLUDED."label",
           "matchTerms"=EXCLUDED."matchTerms",
           "query"=EXCLUDED."query",
           "heatScope"=EXCLUDED."heatScope",
           "sortOrder"=EXCLUDED."sortOrder",
           "updatedAt"=now()
         WHERE "market_taxonomy"."curated" = false`,
        [
          n.kind,
          n.rootMarket,
          n.parentKey,
          n.key,
          n.label,
          JSON.stringify(n.matchTerms ?? []),
          n.query ?? null,
          n.heatScope ?? null,
          n.sortOrder ?? 0,
        ],
      );
    }
    this.invalidate();
    const total = await this.repo.count();
    return { seeded: DEFAULT_TAXONOMY.length, total };
  }

  // ------------------------------------------------------------ classify ----

  private hayFor(name: string): string {
    return ` ${(name || '').toLowerCase()} `;
  }

  /** The longest matching term across `nodes` wins (most specific). */
  private bestMatch(nodes: MarketTaxonomyNode[], hay: string): string | null {
    let best: { key: string; len: number } | null = null;
    for (const n of nodes) {
      for (const t of n.matchTerms ?? []) {
        const term = (t || '').toLowerCase();
        if (term && hay.includes(term) && (!best || term.length > best.len)) {
          best = { key: n.key, len: term.length };
        }
      }
    }
    return best?.key ?? null;
  }

  private resolveMarket(
    brand: string | null | undefined,
    hay: string,
    markets: MarketTaxonomyNode[],
  ): string | null {
    const b = (brand || '').toLowerCase().trim();
    if (b) {
      const direct = markets.find(
        (m) => m.key !== 'all' && (m.key === b || m.rootMarket === b),
      );
      if (direct) return direct.key;
    }
    return this.bestMatch(
      markets.filter((m) => m.key !== 'all'),
      hay,
    );
  }

  /** Pure resolver over a preloaded node set (used by the bulk distribution). */
  classifyWith(
    nodes: MarketTaxonomyNode[],
    name: string,
    brand?: string | null,
  ): TaxonomyTags {
    const hay = this.hayFor(name);
    const markets = nodes.filter((n) => n.kind === 'market');
    let marketKey = this.resolveMarket(brand, hay, markets);

    const pool = (kind: TaxonomyKind) =>
      nodes.filter(
        (n) => n.kind === kind && n.active && (!marketKey || n.rootMarket === marketKey),
      );

    const setKey = this.bestMatch(pool('set'), hay);
    const playerKey = this.bestMatch(pool('player'), hay);
    const cardKey = this.bestMatch(pool('card'), hay);
    let subCategoryKey = this.bestMatch(pool('subcategory'), hay);

    // If the brand didn't resolve a market, backfill it from a concrete
    // set/player/card hit (their rootMarket is authoritative), then re-scope
    // the sub-category to that market so it can't cross markets.
    if (!marketKey) {
      const childKey = [setKey, playerKey, cardKey].find(Boolean) ?? null;
      const child = childKey ? nodes.find((n) => n.key === childKey) : undefined;
      if (child) {
        marketKey = child.rootMarket;
        subCategoryKey = this.bestMatch(
          nodes.filter(
            (n) => n.kind === 'subcategory' && n.active && n.rootMarket === marketKey,
          ),
          hay,
        );
      } else {
        // No market and no concrete anchor — a bare sub-category is meaningless.
        subCategoryKey = null;
      }
    }

    return { marketKey, subCategoryKey, setKey, playerKey, cardKey };
  }

  /** Classify a single card name (+ optional brand) against the live tree. */
  async classify(name: string, brand?: string | null): Promise<TaxonomyTags> {
    return this.classifyWith(await this.nodes(), name, brand);
  }

  // ---------------------------------------------------------------- read ----

  async list(opts?: { rootMarket?: string; kind?: TaxonomyKind }): Promise<MarketTaxonomyNode[]> {
    const all = await this.nodes();
    return all.filter(
      (n) =>
        (!opts?.rootMarket || n.rootMarket === opts.rootMarket) &&
        (!opts?.kind || n.kind === opts.kind),
    );
  }

  /** Nested tree by parentKey, ordered by (kind, sortOrder). Markets are roots. */
  async tree(rootMarket?: string): Promise<unknown[]> {
    const all = await this.nodes();
    const scoped = rootMarket ? all.filter((n) => n.rootMarket === rootMarket) : all;
    const byParent = new Map<string | null, MarketTaxonomyNode[]>();
    for (const n of scoped) {
      const p = n.parentKey ?? null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(n);
    }
    const kindOrder: Record<string, number> = { subcategory: 0, set: 1, player: 2, card: 3, market: 4 };
    const build = (parentKey: string | null): unknown[] =>
      (byParent.get(parentKey) ?? [])
        .sort((a, b) => (kindOrder[a.kind] - kindOrder[b.kind]) || (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label))
        .map((n) => ({
          key: n.key,
          kind: n.kind,
          rootMarket: n.rootMarket,
          label: n.label,
          matchTerms: n.matchTerms ?? [],
          query: n.query,
          heatScope: n.heatScope,
          curated: n.curated,
          active: n.active,
          children: build(n.key),
        }));
    // Roots = market nodes (or, when scoped, whatever has no in-scope parent).
    const roots = scoped
      .filter((n) => n.kind === 'market' || !scoped.some((m) => m.key === n.parentKey))
      .filter((n, i, arr) => arr.findIndex((x) => x.key === n.key) === i);
    return roots
      .filter((n) => n.kind === 'market')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((n) => ({
        key: n.key,
        kind: n.kind,
        rootMarket: n.rootMarket,
        label: n.label,
        matchTerms: n.matchTerms ?? [],
        query: n.query,
        heatScope: n.heatScope,
        curated: n.curated,
        active: n.active,
        children: build(n.key),
      }));
  }

  async stats(): Promise<Record<string, number>> {
    const all = await this.nodes();
    const out: Record<string, number> = { total: all.length };
    for (const n of all) out[n.kind] = (out[n.kind] ?? 0) + 1;
    return out;
  }

  // -------------------------------------------------------------- curate ----

  async createNode(input: Partial<MarketTaxonomyNode> & { key: string; kind: TaxonomyKind; rootMarket: string; label: string }): Promise<MarketTaxonomyNode> {
    if (!input.key || !input.label) throw new BadRequestException('key and label are required');
    const existing = await this.repo.findOne({ where: { key: input.key } });
    if (existing) throw new BadRequestException(`Node "${input.key}" already exists`);
    const node = this.repo.create({
      kind: input.kind,
      rootMarket: input.rootMarket,
      parentKey: input.parentKey ?? null,
      key: input.key,
      label: input.label,
      matchTerms: input.matchTerms ?? [],
      query: input.query ?? null,
      heatScope: input.heatScope ?? null,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      curated: true,
    });
    const saved = await this.repo.save(node);
    this.invalidate();
    return saved;
  }

  async updateNode(key: string, patch: Partial<MarketTaxonomyNode>): Promise<MarketTaxonomyNode> {
    const node = await this.repo.findOne({ where: { key } });
    if (!node) throw new NotFoundException(`Node "${key}" not found`);
    if (patch.label !== undefined) node.label = patch.label;
    if (patch.matchTerms !== undefined) node.matchTerms = patch.matchTerms;
    if (patch.query !== undefined) node.query = patch.query;
    if (patch.heatScope !== undefined) node.heatScope = patch.heatScope;
    if (patch.parentKey !== undefined) node.parentKey = patch.parentKey;
    if (patch.kind !== undefined) node.kind = patch.kind;
    if (patch.rootMarket !== undefined) node.rootMarket = patch.rootMarket;
    if (patch.sortOrder !== undefined) node.sortOrder = patch.sortOrder;
    if (patch.active !== undefined) node.active = patch.active;
    node.curated = true; // any manual edit pins it against re-seed overwrites
    const saved = await this.repo.save(node);
    this.invalidate();
    return saved;
  }

  async deleteNode(key: string): Promise<{ deleted: string }> {
    const node = await this.repo.findOne({ where: { key } });
    if (!node) throw new NotFoundException(`Node "${key}" not found`);
    const childCount = await this.repo.count({ where: { parentKey: key } });
    if (childCount > 0) {
      throw new BadRequestException(`Node "${key}" has ${childCount} child node(s); reparent or delete them first`);
    }
    await this.repo.delete({ key });
    this.invalidate();
    return { deleted: key };
  }

  // ---------------------------------------------------- coverage preview ----

  /**
   * Run the auto-tagger over an existing card table and report how the rows
   * distribute across the taxonomy — the fast way to judge auto-tag quality
   * and see which matchTerms need curating. Non-persisting.
   */
  async distribution(
    source: 'tracked_cards' | 'sold_cards' = 'tracked_cards',
    limit = 5000,
  ): Promise<unknown> {
    const table = source === 'sold_cards' ? 'sold_cards' : 'tracked_cards';
    const lim = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 5000, 20000));
    const rows: { name: string; brand: string | null }[] = await this.ds.query(
      `SELECT "name", "brand" FROM "${table}" ORDER BY "createdAt" DESC LIMIT $1`,
      [lim],
    );
    const nodes = await this.nodes();
    const labelOf = new Map(nodes.map((n) => [n.key, n.label]));

    const tally = new Map<string, number>();
    const bump = (k: string | null) => {
      if (!k) return;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    };
    let taggedMarket = 0;
    let taggedAny = 0;
    for (const r of rows) {
      const t = this.classifyWith(nodes, r.name, r.brand);
      if (t.marketKey) taggedMarket++;
      if (t.marketKey || t.subCategoryKey || t.setKey || t.playerKey || t.cardKey) taggedAny++;
      bump(t.marketKey);
      bump(t.subCategoryKey);
      bump(t.setKey);
      bump(t.playerKey);
      bump(t.cardKey);
    }

    const group = (kind: TaxonomyKind) =>
      nodes
        .filter((n) => n.kind === kind && (tally.get(n.key) ?? 0) > 0)
        .map((n) => ({ key: n.key, label: labelOf.get(n.key) ?? n.key, count: tally.get(n.key)! }))
        .sort((a, b) => b.count - a.count);

    return {
      source: table,
      totalRows: rows.length,
      taggedMarket,
      taggedAny,
      untagged: rows.length - taggedAny,
      byMarket: group('market'),
      bySubcategory: group('subcategory'),
      bySet: group('set'),
      byPlayer: group('player'),
      byCard: group('card'),
    };
  }
}
