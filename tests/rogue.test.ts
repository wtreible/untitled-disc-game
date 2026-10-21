import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import type { Tree } from '../src/course/disc-types';
import type { Rings } from '../src/course/types';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { backTeeFor, effectiveMods, neutralMods, rogueStartMods, type Mods } from '../src/disc/mods';
import { emptyChanges, pinFor, place, placementQueue, pondsFor, teeFor, treesFor } from '../src/rogue/course';
import type { DiscHole } from '../src/course/disc-types';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { BUMP_CHANCE, CATEGORIES, POWERUPS, STARTER_WEIGHTS, byId, drawOffer, rollTier, TIERS } from '../src/rogue/powerups';

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
  it('has 28 common, 22 epic, 15 legendary with unique ids, each in a category', () => {
    const count = (t: string) => POWERUPS.filter((p) => p.tier === t).length;
    expect([count('common'), count('epic'), count('legendary')]).toEqual([28, 22, 15]);
    for (const p of POWERUPS) expect(CATEGORIES.map((c) => c.id)).toContain(p.category);
    expect(new Set(POWERUPS.map((p) => p.id)).size).toBe(POWERUPS.length);
  });

  it('every powerup actually changes something (from the roguelike starting point)', () => {
    const base = JSON.stringify(rogueStartMods());
    for (const p of POWERUPS) { const m = rogueStartMods(); p.apply(m); expect(JSON.stringify(m), p.id).not.toBe(base); }
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

  it('Phase Disc flies through a wall of trees; Ghost Disc passes exactly two', () => {
    const wall: Tree[] = Array.from({ length: 41 }, (_, i) => ({ x: -10 + i * 0.5, y: 20, h: 15, r: 0.01, b: 14.9, t: 0.3 }));
    expect(throwIt(neutralMods(), world(wall), 1).rest[1]).toBeLessThan(25);
    expect(throwIt(withPower('phase-disc'), world(wall), 1).rest[1]).toBeGreaterThan(50);
    // Perfect Form (zero error) so the disc is guaranteed to run into three wide trunks dead ahead.
    const three: Tree[] = [20, 27, 34].map((y) => ({ x: 0, y, h: 15, r: 0.01, b: 14.9, t: 0.6 }));
    const g = throwIt(withPower('ghost-disc'), world(three), 1, { perfect: true });
    expect(g.events.filter((e) => e === 'phased').length).toBe(2);
    expect(g.events).toContain('trunk');
    expect(g.rest[1]).toBeLessThan(40);
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

  it('Magnet Basket (legendary) pulls from 6 m, up to 3 m', () => {
    const short = throwIt(neutralMods(), world(), 2, { power: 0.5 }).rest;
    const B: Vec2 = [short[0], short[1] + 5.5];
    const mag = throwIt(withPower('magnet-basket'), world([], B), 2, { power: 0.5 });
    expect(mag.events).toContain('magnet');
    expect(Math.hypot(mag.rest[0] - B[0], mag.rest[1] - B[1])).toBeLessThan(3);
  });

  it('wind augments: Wind Cheater drifts less, Weather Control not at all; Crosswind hits opponents only', () => {
    const drift = (m: Mods) => {
      const calm = throwIt(m, world(), 1, { power: 1 }).rest[0];
      const r = throwIt(m, { ...world(), wind: [5, 0] }, 1, { power: 1 }).rest[0];
      return r - calm;
    };
    const base = drift(neutralMods());
    expect(base).toBeGreaterThan(3);
    expect(drift(withPower('wind-cheater'))).toBeLessThan(base * 0.8);
    expect(Math.abs(drift(withPower('weather-control')))).toBeLessThan(0.01);
    const all = [withPower('crosswind'), neutralMods()];
    expect(effectiveMods(all, 0).windScale).toBe(1);
    expect(effectiveMods(all, 1).windScale).toBeCloseTo(1.4);
    expect(effectiveMods([withPower('weather-control'), neutralMods()], 1).windScale).toBeCloseTo(2);
  });

  it('Pinball Wizard: a branch kick keeps far more speed', () => {
    const bush: Tree[] = [{ x: 0, y: 25, h: 12, r: 4, b: 0.2, t: 0.01 }];
    const far = (m: Mods) => { let s = 0; for (let k = 1; k <= 20; k++) { const r = throwIt(m, world(bush), k, { power: 0.8 }); if (r.events.includes('branch')) s += Math.hypot(r.rest[0], r.rest[1]); } return s; };
    expect(far(withPower('pinball-wizard'))).toBeGreaterThan(far(neutralMods()) * 1.3);
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

describe('starter draft and hexes in drafts', () => {
  it('the starter rolls epic/legendary far more often', () => {
    const rng = mulberry32(5);
    let good = 0;
    for (let i = 0; i < 10000; i++) if (rollTier(rng, STARTER_WEIGHTS) !== 'common') good++;
    expect(good / 10000).toBeCloseTo(0.6, 1);
  });

  it('single player never sees hexes; two players can', () => {
    const rng = mulberry32(9);
    let hexSeen = false;
    for (let i = 0; i < 400; i++) {
      for (const c of drawOffer(rng, [], 3, 'epic', 1).cards) expect(c.kind).not.toBe('hex');
      if (drawOffer(rng, [], 3, 'epic', 2).cards.some((c) => c.kind === 'hex')) hexSeen = true;
    }
    expect(hexSeen).toBe(true);
  });
});

describe('per-player course changes', () => {
  const hole: DiscHole = { ref: '1', par: 3, par_source: 'length', tee: [0, 0], pin: [0, 100], routing: [[0, 0], [0, 100]], length_m: 100, warnings: [] };
  const t1: Tree = { x: 5, y: 50, h: 10, r: 2, b: 1, t: 0.2 };
  const t2: Tree = { x: -5, y: 60, h: 10, r: 2, b: 1, t: 0.2 };

  it('hex trees and ponds affect everyone except their owner; clear-cut only its owner', () => {
    const ch = emptyChanges(3);
    const planted: Tree = { x: 0, y: 90, h: 6, r: 2, b: 0.4, t: 0.15 };
    ch.trees.push({ tree: planted, owner: 0 });
    ch.ponds.push({ c: [0, 70], r: 3.5, owner: 1 });
    ch.cleared[2].add(t1);
    const base = [t1, t2];
    expect(treesFor(base, new Set(), ch, 0)).toEqual([t1, t2]); // owner doesn't get their own sapling
    expect(treesFor(base, new Set(), ch, 1)).toContain(planted);
    expect(treesFor(base, new Set(), ch, 2)).toEqual([t2, planted]); // cleared t1 for player 2 only
    expect(treesFor(base, new Set([t2]), ch, 1)).not.toContain(t2); // Lumberjack removals apply to all
    expect(pondsFor(ch, 1)).toEqual([]);
    expect(pondsFor(ch, 0).length).toBe(1);
  });

  it('Forward Tee / Back Tees / Short Pin move tees and baskets per player', () => {
    const all = [withPower('forward-tee'), withPower('back-tees'), neutralMods()];
    expect(teeFor(hole, [withPower('forward-tee'), neutralMods()], 0)).toEqual([0, 15]); // forward tee alone
    expect(backTeeFor(all, 0)).toBe(15);
    // Player 0: +15 forward, −15 back from player 1 → back at 0. Player 2 only gets pushed back.
    const p0 = teeFor(hole, all, 0), p2 = teeFor(hole, all, 2);
    expect(p0[1]).toBeCloseTo(0, 5);
    expect(p2[1]).toBeCloseTo(-15, 5);
    expect(teeFor(hole, all, 1)[1]).toBeCloseTo(0, 5); // owner of Back Tees unaffected
    expect(pinFor(hole, withPower('short-pin'))).toEqual([0, 75]);
    expect(pinFor(hole, neutralMods())).toEqual([0, 100]);
  });

  it('Heckler and Shrink Ray hit opponents, never the owner', () => {
    const all = [withPower('heckler', 'shrink-ray'), neutralMods()];
    expect(effectiveMods(all, 0).meterSpeed).toBe(1);
    expect(effectiveMods(all, 0).basketScale).toBe(1);
    expect(effectiveMods(all, 1).meterSpeed).toBeCloseTo(1.28);
    expect(effectiveMods(all, 1).basketScale).toBeCloseTo(0.55);
  });

  it('placement rules', () => {
    const c = { hole, blocked: () => false, trees: [t1, t2], rng: mulberry32(1) };
    expect(place('sapling', [0, 92], c).ok).toBe(true);
    expect(place('sapling', [0, 99], c).ok).toBe(false); // on the basket
    expect(place('sapling', [0, 50], c).ok).toBe(false); // not near the basket
    expect(place('thicket', [0, 3], c).ok).toBe(false); // on the tee
    expect(place('thicket', [60, 50], c).ok).toBe(false); // off the hole
    expect(place('pond', [0, 50], c).ok).toBe(true);
    const cut = place('clear-cut', [5.5, 50.5], c);
    expect(cut.ok && cut.kind === 'clear-cut' && cut.target).toBe(t1);
    expect(place('sapling', [0, 92], { ...c, blocked: () => true }).ok).toBe(false);
  });

  it('placement queue: clear-cut works solo; hexes only with opponents', () => {
    expect(placementQueue([withPower('clear-cut', 'sapling')]).map((q) => q.kind)).toEqual(['clear-cut']);
    expect(placementQueue([withPower('thicket'), neutralMods()]).map((q) => q.kind)).toEqual(['thicket', 'thicket', 'thicket', 'thicket']);
  });

  it('a hex pond is water for the thrower who has it', () => {
    const land = throwItWorld(world(), 1).rest;
    const w = { ...world(), hazards: [{ c: land, r: 3.5 }] };
    const r = throwItWorld(w, 1);
    expect(r.events).toContain('water');
    expect(r.penalty).toBe(1);
  });
});

function throwItWorld(w: DiscWorld, seed: number) {
  return simulateThrow({ start: [0, 0], aim: NORTH, power: 0.6, disc: MR, hyzer: 0 }, w, mulberry32(seed));
}
