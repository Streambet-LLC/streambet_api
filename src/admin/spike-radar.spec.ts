import {
  parseVariant,
  scoreSpike,
  variantMove,
  type SpikeInputs,
} from './spike-radar';

const blank: SpikeInputs = {
  floorChangePct: null,
  sweptPct: null,
  totalActiveChangePct: null,
  clearedRatePct: null,
  askChangePct: null,
  socialMentions: null,
  firstPartyAdds: null,
};

describe('parseVariant', () => {
  it('pins down a graded sports parallel with a serial', () => {
    const v = parseVariant(
      '2012-13 Panini Prizm LeBron James #1 Silver /99 PSA 10 GEM MINT',
      { sports: true },
    );
    expect(v).toEqual({
      signature: '2012|#1|silver|/99|psa 10',
      label: '2012 #1 Silver /99 · PSA 10',
      queryTerms: '2012 #1 silver /99 psa 10',
    });
  });

  it('reads "x/y" as a TCG set number outside sports', () => {
    const v = parseVariant(
      'Pokemon Umbreon VMAX 215/203 Evolving Skies Alt Art',
      { sports: false },
    );
    expect(v?.signature).toBe('215/203|raw');
    expect(v?.label).toBe('215/203 · Raw');
  });

  it('groups one numbered TCG card however sellers describe it', () => {
    const a = parseVariant('1999 Pokemon Base Set Charizard 4/102 Holo Rare', {
      sports: false,
    });
    const b = parseVariant('Charizard 4/102 Base Set Holo', { sports: false });
    expect(a?.signature).toBe('4/102|raw');
    expect(b?.signature).toBe(a?.signature);
  });

  it('keeps reverse holo and 1st edition as different cards', () => {
    expect(
      parseVariant('Charizard 4/102 Base Set Reverse Holo', { sports: false })
        ?.signature,
    ).toBe('4/102|reverse holo|raw');
    expect(
      parseVariant('Charizard 4/102 1st Edition Holo PSA 9', { sports: false })
        ?.signature,
    ).toBe('4/102|1st edition|psa 9');
  });

  it('reads One Piece set codes', () => {
    expect(
      parseVariant('One Piece OP09-119 Luffy Manga Alt Art', { sports: false })
        ?.signature,
    ).toBe('op09-119|alt art|manga|raw');
  });

  it('skips lots, breaks and titles with no card number', () => {
    expect(
      parseVariant('Pokemon card lot of 50 holo 4/102', { sports: false }),
    ).toBeNull();
    expect(
      parseVariant('LeBron James Prizm case break spot', { sports: true }),
    ).toBeNull();
    expect(
      parseVariant('LeBron James Prizm Silver PSA 10', { sports: true }),
    ).toBeNull();
  });

  it('does not mistake a grade for a card number', () => {
    expect(parseVariant('Umbreon PSA 10', { sports: false })).toBeNull();
  });
});

describe('scoreSpike', () => {
  const calm = (i: number): SpikeInputs => ({
    ...blank,
    floorChangePct: (i % 3) - 1,
    sweptPct: 15 + (i % 4),
    totalActiveChangePct: (i % 2) - 0.5,
    clearedRatePct: 12 + (i % 3),
    askChangePct: (i % 3) - 1,
    socialMentions: 10 + (i % 3),
  });
  const history = Array.from({ length: 14 }, (_, i) => calm(i));

  it('stays quiet on an ordinary day', () => {
    const r = scoreSpike(calm(20), history);
    expect(r.flagged).toBe(false);
    expect(r.firing).toBe(0);
    expect(r.coldStart).toBe(false);
  });

  it('flags a floor sweep: cheap copies gone, floor up, listings draining', () => {
    const r = scoreSpike(
      {
        ...calm(20),
        floorChangePct: 25,
        sweptPct: 80,
        totalActiveChangePct: -6,
        clearedRatePct: 30,
      },
      history,
    );
    expect(r.flagged).toBe(true);
    expect(r.firing).toBeGreaterThanOrEqual(3);
    expect(r.signals.find((s) => s.key === 'floor')?.typical).not.toBeNull();
  });

  it('ignores a "sweep" when everything is churning equally', () => {
    const r = scoreSpike(
      { ...calm(20), sweptPct: 60, clearedRatePct: 55 },
      history,
    );
    expect(r.signals.find((s) => s.key === 'sweep')?.firing).toBe(false);
  });

  it('falls back to fixed thresholds without history', () => {
    const r = scoreSpike(
      { ...blank, floorChangePct: 20, sweptPct: 70, clearedRatePct: 20 },
      [],
    );
    expect(r.coldStart).toBe(true);
    expect(r.flagged).toBe(true);
    // Buzz is a level, so it can't be judged without history.
    expect(
      scoreSpike({ ...blank, socialMentions: 500 }, []).signals,
    ).toHaveLength(0);
  });
});

describe('variantMove', () => {
  it('is hot when the floor jumps as copies sell', () => {
    expect(
      variantMove(
        { listedCount: 4, floorUsd: 130, clearedCount: 2 },
        { listedCount: 5, floorUsd: 100 },
      ).hot,
    ).toBe(true);
  });

  it('is hot when half its copies clear out', () => {
    expect(
      variantMove(
        { listedCount: 3, floorUsd: 100, clearedCount: 3 },
        { listedCount: 6, floorUsd: 100 },
      ).hot,
    ).toBe(true);
  });

  it('needs a few copies a day ago to judge', () => {
    expect(
      variantMove(
        { listedCount: 1, floorUsd: 300, clearedCount: 1 },
        { listedCount: 2, floorUsd: 100 },
      ).hot,
    ).toBe(false);
    expect(
      variantMove({ listedCount: 5, floorUsd: 100, clearedCount: 0 }, null).hot,
    ).toBe(false);
  });
});
