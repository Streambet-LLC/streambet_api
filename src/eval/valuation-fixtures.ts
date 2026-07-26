import { ValMethod } from '../admin/card-market/valuation.util';

/**
 * A golden card + what a TRUSTWORTHY valuation of it should look like. We lean on
 * STRUCTURAL expectations (correct method, grounded comps, calibrated confidence)
 * rather than a precise price — the market moves, but the engine's BEHAVIOR
 * should stay correct. Widen/tighten these as you learn each card's real market.
 */
export interface ValuationFixture {
  subject: string;
  /** Acceptable valuation route(s) for this card's situation. */
  expectMethod?: ValMethod[];
  /** Wide sanity bounds on the point value (USD) — not a precise target. */
  minUsd?: number;
  maxUsd?: number;
  /** Expected confidence band (evidence-tied). */
  minConfidence?: number;
  maxConfidence?: number;
  /** Must return at least one grounded sale comp (url + date). */
  requireComps?: boolean;
  /** Why this card is in the set / what it stresses. */
  notes: string;
}

export const VALUATION_FIXTURES: ValuationFixture[] = [
  {
    subject: '2019 Panini Prizm Color Blast Patrick Mahomes PSA 10',
    expectMethod: ['anchor-and-adjust'],
    minUsd: 8000,
    maxUsd: 30000,
    minConfidence: 40,
    maxConfidence: 80,
    requireComps: true,
    notes:
      'Low-pop, high-value, thin comps, NOT on eBay. Must anchor on the most-recent PSA sales-history sale + adjust by a player/segment index. No phantom comps.',
  },
  {
    subject: '2025 Panini Absolute Kaboom Luther Burden III PSA 10',
    expectMethod: ['recent-median', 'anchor-and-adjust'],
    minUsd: 100,
    maxUsd: 6000,
    requireComps: true,
    notes:
      'Liquid-ish rookie insert with real eBay sold comps. Must USE its own eBay sold comps (recent-median), not triangulate off other players.',
  },
  {
    subject: '2023 Pokemon 151 Charizard ex Special Illustration Rare #199 PSA 10',
    expectMethod: ['recent-median'],
    minUsd: 150,
    maxUsd: 3000,
    minConfidence: 70,
    requireComps: true,
    notes:
      'Liquid, many recent exact comps. Should be recent-median with HIGH confidence and a tight range.',
  },
  {
    subject: '2016 Pokemon XY Evolutions Charizard Holo #11 PSA 10',
    expectMethod: ['recent-median'],
    minUsd: 80,
    maxUsd: 1500,
    minConfidence: 70,
    requireComps: true,
    notes:
      'Ultra-traded, lower value. Recent-median, high confidence, tight range.',
  },
  {
    subject: '2024 Bowman Chrome Draft Superfractor 1/1 Auto (obscure prospect) BGS 9.5',
    expectMethod: ['triangulation'],
    maxConfidence: 55,
    requireComps: false,
    notes:
      'Untraded 1-of-1 with no direct comps. Must TRIANGULATE a clearly-labeled low-confidence estimate — never refuse, never invent a comp.',
  },
];
