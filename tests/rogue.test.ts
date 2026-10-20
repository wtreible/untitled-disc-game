import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import type { Tree } from '../src/course/disc-types';
import type { Rings } from '../src/course/types';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { neutralMods, type Mods } from '../src/disc/mods';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { BUMP_CHANCE, POWERUPS, byId, drawOffer, rollTier, TIERS } from '../src/rogue/powerups';

const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
const rect = (x0: number, y0: number, x1: number, y1: number): Rings => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
const NORTH = Math.PI / 2;
const MR = DISCS.find((d) => d.id === 'MR')!;

function world(trees: Tree[] = [], basket: Vec2 = [0, 500], water: Rings[] = []): DiscWorld {
  const grid = SurfaceGrid.fromHole({
    bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], trees: [],
    features: water.map((rings, i) => ({ class: 'water' as const, osm_id: `w${i}`, rings })),
  }, 0.5);
  return { grid, terrain: new FlatTerrain(), trees: new TreeIndex(trees), basket, branchDensity: 0.9 };
}
const withPower = (...ids: string[]): Mods => { const m = neutralMods(); for (const id of ids) byId(id).apply(m); return m; };
const rate = (n: number, f: (seed: number) => boolean) => { let k = 0; for (let s = 1; s <= n; s++) if (f(s)) k++; return k / n; };

describe('catalog', () => {
  it('has 20 common, 15 epic, 9 legendary with unique ids', () => {
    const count = (t: string) => POWERUPS.filter((p) => p.tier === t).length;
    expect([count('common'), count('epic'), count('legendary')]).toEqual([20, 15, 9]);
    expect(new Set(POWERUPS.map((p) => p.id)).size).toBe(POWERUPS.length);
  });

  it('every powerup actually changes something', () => {
    const base = JSON.stringify(neutralMods());
    for (const p of POWERUPS) expect(JSON.stringify(withPower(p.id)), p.id).not.toBe(base);
  });
});

describe('draft', () => {
  it('rolls tiers about 70 / 25 / 5', () => {
    const rng = mulberry32(42);
    const n = 20000;
    const c: Record<string, number> = { common: 0, epic: 0, legendary: 0 };
    for (let i = 0; i < n; i++) c[rollTier(rng)]++;
    expect(c.common / n).toBeCloseTo(0.7, 1);
    expect(c.epic / n).toBeCloseTo(0.25, 1);
    expect(c.legendary / n).toBeCloseTo(0.05, 1);
  });

  it('offers 3 distinct cards of one tier; only the center can be bumped, one tier up, ~5% of the time', () => {
    const rng = mulberry32(7);
    let bumps = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const o = drawOffer(rng, [], 3, 'common');
      expect(o.cards.length).toBe(3);
      expect(new Set(o.cards).size).toBe(3);
      o.cards.forEach((c, k) => expect(c.tier).toBe(k === o.bumped ? 'epic' : 'common'));
      if (o.bumped !== null) { bumps++; expect(o.bumped).toBe(1); }
    }
    expect(bumps / n).toBeCloseTo(BUMP_CHANCE, 2);
  });

  it('legendary drafts are never bumped; owned uniques are not offered again', () => {
    const rng = mulberry32(3);
    const ownedUniques = POWERUPS.filter((p) => p.tier === 'legendary' && p.unique).map((p) => p.id);
    for (let i = 0; i < 500; i++) {
      const o = drawOffer(rng, ownedUniques, 3, 'legendary');
      expect(o.bumped).toBeNull();
      for (const c of o.cards) expect(ownedUniques).not.toContain(c.id);
    }
    expect(TIERS).toEqual(['common', 'epic', 'legendary']);
  });

  it('Double Draft adds a card', () => {
    expect(drawOffer(mulberry32(1), [], 3 + withPower('double-draft').extraCard, 'epic').cards.length).toBe(4);
  });
});

describe('effects in the flight model', () => {
  const throwIt = (mods: Mods, w: DiscWorld, seed: number, over: Partial<ThrowInput> = {}) =>
    simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: MR, hyzer: 0, mods, ...over }, w, mulberry32(seed));

  it('Big Arm / Golden Arm throw farther', () => {
    const base = throwIt(neutralMods(), world(), 1).rest[1];
    expect(throwIt(withPower('big-arm'), world(), 1).rest[1]).toBeGreaterThan(base * 1.08);
    expect(throwIt(withPower('golden-arm'), world(), 1).rest[1]).toBeGreaterThan(base * 1.18);
  });

  it('Phase Disc flies through a wall of trees; Ghost Disc passes exactly one', () => {
    const wall: Tree[] = Array.from({ length: 41 }, (_, i) => ({ x: -10 + i * 0.5, y: 20, h: 15, r: 0.01, b: 14.9, t: 0.3 }));
    expect(throwIt(neutralMods(), world(wall), 1).rest[1]).toBeLessThan(25);
    expect(throwIt(withPower('phase-disc'), world(wall), 1).rest[1]).toBeGreaterThan(50);
    // Perfect Form (zero error) so the disc is guaranteed to run into two wide trunks dead ahead.
    const two: Tree[] = [{ x: 0, y: 20, h: 15, r: 0.01, b: 14.9, t: 0.6 }, { x: 0, y: 30, h: 15, r: 0.01, b: 14.9, t: 0.6 }];
    const g = throwIt(withPower('ghost-disc'), world(two), 1, { perfect: true });
    expect(g.events.filter((e) => e === 'phased').length).toBe(1);
    expect(g.events).toContain('trunk');
    expect(g.rest[1]).toBeLessThan(35);
  });

  it('OB Insurance: water costs nothing; Sticky Plastic saves a near miss', () => {
    const w = world([], [0, 500], [rect(-50, 30, 50, 200)]);
    expect(throwIt(neutralMods(), w, 1).penalty).toBe(1);
    expect(throwIt(withPower('ob-insurance'), w, 1).penalty).toBe(0);
    // A pond starting just short of where a sticky disc lands.
    const land = throwIt(withPower('sticky-plastic'), world(), 1).rest[1];
    const sticky = throwIt(withPower('sticky-plastic'), world([], [0, 500], [rect(-50, land - 1, 50, 200)]), 1);
    expect(sticky.events).toContain('saved');
    expect(sticky.penalty).toBe(0);
  });

  it('Black Hole and Wide Basket make edge putts go in far more often', () => {
    const B: Vec2 = [0, 6];
    const putt = (m: Mods, seed: number) => simulateThrow({ start: [0.45, 0], aim: NORTH, power: 0.4, disc: PUTTER_DISC, hyzer: 0, style: 'putt', mods: m }, world([], B), mulberry32(seed)).holed;
    const base = rate(60, (s) => putt(neutralMods(), s));
    expect(rate(60, (s) => putt(withPower('wide-basket'), s))).toBeGreaterThan(base + 0.1);
    expect(rate(60, (s) => putt(withPower('black-hole'), s))).toBeGreaterThan(0.8);
  });

  it('Gimme Circle holes anything that stops within 5 m; Magnet Basket pulls it closer', () => {
    // Throw a midrange that stops ~3 m short of a basket.
    const short = throwIt(neutralMods(), world(), 2, { power: 0.5 }).rest;
    const B: Vec2 = [short[0], short[1] + 3];
    expect(throwIt(neutralMods(), world([], B), 2, { power: 0.5 }).holed).toBe(false);
    expect(throwIt(withPower('gimme-circle'), world([], B), 2, { power: 0.5 }).holed).toBe(true);
    const mag = throwIt(withPower('magnet-basket'), world([], B), 2, { power: 0.5 });
    expect(mag.events).toContain('magnet');
    expect(Math.hypot(mag.rest[0] - B[0], mag.rest[1] - B[1])).toBeLessThan(2);
  });

  it('Homing Chains bends a wide throw toward the basket', () => {
    const B: Vec2 = [12, 60];
    const miss = (m: Mods) => { const r = throwIt(m, world([], B), 1, { power: 0.85 }); return Math.hypot(r.rest[0] - B[0], r.rest[1] - B[1]); };
    expect(miss(withPower('homing-chains'))).toBeLessThan(miss(neutralMods()) * 0.6);
  });

  it('Laser Line tightens the spread', () => {
    const spread = (m: Mods) => {
      const xs = [...Array(40).keys()].map((s) => throwIt(m, world(), s + 1).rest[0]);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    };
    expect(spread(withPower('laser-line'))).toBeLessThan(spread(neutralMods()) * 0.7);
  });

  it('Lumberjack: hit trees are reported for removal', () => {
    const t: Tree = { x: 0, y: 20, h: 15, r: 0.01, b: 14.9, t: 0.6 };
    expect(throwIt(withPower('lumberjack'), world([t]), 1, { perfect: true }).treesHit).toContain(t);
  });
});
