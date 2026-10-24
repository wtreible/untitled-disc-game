// The 2026-10-24 augments (src/rogue/powerups.ts): what each does in the flight model and the round,
// and hexes sparing teammates.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTrees, type DiscCourseFile, type Tree } from '../src/course/disc-types';
import type { Vec2 } from '../src/course/geo';
import type { Rings } from '../src/course/types';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { basketAt, simulateThrow, surfaceAt, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { effectiveMods, neutralMods, type Mods } from '../src/disc/mods';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { DiscRound, type RoundEvent, type WireResult } from '../src/modes/discRound';
import { emptyChanges, pondsFor, treesFor } from '../src/rogue/course';
import { byId } from '../src/rogue/powerups';

const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
const rect = (x0: number, y0: number, x1: number, y1: number): Rings => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
const NORTH = Math.PI / 2;
const MR = DISCS.find((d) => d.id === 'MR')!;
const tree = (x: number, y: number): Tree => ({ x, y, h: 12, r: 3, b: 2, t: 0.35 });

function world(trees: Tree[] = [], basket: Vec2 = [0, 500], water: Rings[] = []): DiscWorld {
  const grid = SurfaceGrid.fromHole({
    bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], trees: [],
    features: water.map((rings, i) => ({ class: 'water' as const, osm_id: `w${i}`, rings })),
  }, 0.5);
  return { grid, terrain: new FlatTerrain(), trees: new TreeIndex(trees), basket, branchDensity: 0.9 };
}
const withPower = (...ids: string[]): Mods => { const m = neutralMods(); for (const id of ids) byId(id).apply(m); return m; };
const throwIt = (m: Mods, w: DiscWorld, seed: number, o: Partial<ThrowInput> = {}) =>
  simulateThrow({ start: [0, 0], aim: NORTH, power: 0.8, disc: MR, hyzer: 0, mods: m, ...o }, w, mulberry32(seed));
const rate = (n: number, f: (seed: number) => boolean) => { let k = 0; for (let s = 1; s <= n; s++) if (f(s)) k++; return k / n; };
const off = (p: Vec2, q: Vec2) => Math.hypot(p[0] - q[0], p[1] - q[1]);

describe('new augments in flight', () => {
  it('Boomerang: a disc at rest past the basket comes back toward it, up to 5 m', () => {
    const rest = throwIt(neutralMods(), world(), 3).rest;
    const B: Vec2 = [rest[0], rest[1] - 6]; // it stops 6 m past this basket
    const r = throwIt(withPower('boomerang'), world([], B), 3);
    expect(r.events).toContain('boomerang');
    expect(off(r.rest, B)).toBeCloseTo(1, 0);
    expect(r.marks?.some(([, k]) => k === 'boomerang')).toBe(true);
    // Short of the basket: no boomerang.
    expect(throwIt(withPower('boomerang'), world([], [rest[0], rest[1] + 6]), 3).events).not.toContain('boomerang');
  });

  it('Skipping Stone: a fast landing on water skips on once, onto the far bank with no penalty', () => {
    const land = throwIt(neutralMods(), world(), 4).samples.find((p, i, s) => i > 5 && p[2] < 0.05 && s[i - 1][2] >= 0.05)!;
    const pond = rect(-60, land[1] - 3, 60, land[1] + 3); // a narrow pond where it first lands
    const plain = throwIt(neutralMods(), world([], [0, 500], [pond]), 4);
    expect(plain.penalty).toBe(1);
    const skip = throwIt(withPower('skipping-stone'), world([], [0, 500], [pond]), 4);
    expect(skip.events).toContain('skip');
    expect(skip.penalty).toBe(0);
    expect(skip.rest[1]).toBeGreaterThan(land[1] + 3);
  });

  it('Fireball: the first tree hit burns away and the disc flies on; Lumberjack-style it is reported', () => {
    const wall = [-6, -3, 0, 3, 6].map((x) => tree(x, 40));
    const plain = throwIt(neutralMods(), world(wall), 5);
    const fire = throwIt(withPower('fireball'), world(wall), 5);
    expect(plain.events.some((e) => e === 'branch' || e === 'trunk')).toBe(true); // stopped by the wall
    expect(fire.burned?.length).toBe(1);
    expect(fire.events).toEqual(['burned']); // through, and nothing else in its way
    expect(fire.rest[1]).toBeGreaterThan(plain.rest[1] + 10);
    expect(fire.marks).toEqual([[expect.any(Number), 'burn']]);
  });

  it('Split Disc: the top of the flight is noted, and the other half flies on from there', () => {
    const r = throwIt(withPower('split-disc'), world(), 6);
    expect(r.apex).toBeTruthy();
    expect(r.marks?.some(([, k]) => k === 'split')).toBe(true);
    const half = simulateThrow({ start: [0, 0], aim: NORTH, power: 0.8, disc: MR, hyzer: 0, mods: withPower('split-disc'), resume: { p: r.apex!.p, v: r.apex!.v, bank: r.apex!.bank } }, world(), mulberry32(7));
    expect(off(half.samples[0] as unknown as Vec2, r.apex!.p as unknown as Vec2)).toBeLessThan(0.01);
    expect(half.apex).toBeUndefined(); // the other half doesn't split again
  });

  it('Kite: a wind toward the basket carries it farther; a headwind is no help', () => {
    const tail = { ...world(), wind: [0, 4] as Vec2 }, head = { ...world(), wind: [0, -4] as Vec2 };
    expect(throwIt(withPower('kite'), tail, 8).rest[1]).toBeGreaterThan(throwIt(neutralMods(), tail, 8).rest[1] + 1);
    expect(throwIt(withPower('kite'), head, 8).rest[1]).toBeCloseTo(throwIt(neutralMods(), head, 8).rest[1], 1);
  });

  it('Spotlight: putts from within 15 m fly the same line every time; from farther, they wobble', () => {
    // Aimed past the basket (power for 25 m), so the putts fly on and the line shows.
    const putt = (from: Vec2, seed: number) => simulateThrow({ start: from, aim: NORTH + 0.2, power: 0.6, disc: PUTTER_DISC, hyzer: 0, style: 'putt', mods: withPower('spotlight') }, world([], [0, 60]), mulberry32(seed)).rest[0];
    expect(new Set([1, 2, 3, 4].map((s) => putt([0, 50], s).toFixed(3))).size).toBe(1); // 10 m out
    expect(new Set([1, 2, 3, 4].map((s) => putt([0, 30], s).toFixed(3))).size).toBeGreaterThan(1); // 30 m out
  });

  it('Basket Buddy: a near miss within 3 m is nudged in, when the round says one is left', () => {
    const rest = throwIt(neutralMods(), world(), 9, { power: 0.5 }).rest;
    const B: Vec2 = [rest[0] + 2, rest[1]];
    expect(throwIt(withPower('basket-buddy'), world([], B), 9, { power: 0.5 }).holed).toBe(false);
    const r = throwIt(withPower('basket-buddy'), world([], B), 9, { power: 0.5, buddy: true });
    expect(r.holed).toBe(true);
    expect(r.events).toContain('buddy');
  });

  it('Moving Basket: the basket drifts with the clock, and the flight plays it where it is', () => {
    const w: DiscWorld = { ...world([], [0, 30]), basketDrift: { amp: [3, 0], period: 8 } };
    expect(basketAt(w, 0)).toEqual([0, 30]);
    expect(basketAt(w, 2)[0]).toBeCloseTo(3);
    expect(basketAt(w, 6)[0]).toBeCloseTo(-3);
  });

  it('Bridge Builder: water under the bridge plays as dry ground', () => {
    const w = world([], [0, 500], [rect(-20, 40, 20, 60)]);
    expect(surfaceAt(w, 0, 50)).toBe('water');
    const bridged: DiscWorld = { ...w, bridges: [{ a: [0, 30], b: [0, 70], half: 3 }] };
    expect(surfaceAt(bridged, 0, 50)).toBe('path');
    expect(surfaceAt(bridged, 10, 50)).toBe('water'); // off the bridge
  });

  it('Gardener: far fewer branch hits near the hole line', () => {
    const grove = Array.from({ length: 30 }, (_, i) => tree(((i % 5) - 2) * 3, 30 + Math.floor(i / 5) * 6));
    const w: DiscWorld = { ...world(grove), line: [[0, 0], [0, 200]] };
    const hits = (m: Mods) => rate(40, (s) => throwIt(m, w, s).events.includes('branch'));
    expect(hits(withPower('gardener'))).toBeLessThan(hits(neutralMods()));
  });

  it('an earthquake throw wobbles 2.5× as much', () => {
    const spread = (quake: boolean) => { const xs = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => throwIt(neutralMods(), world(), s, { quake }).rest[0]); return Math.max(...xs) - Math.min(...xs); };
    expect(spread(true)).toBeGreaterThan(spread(false) * 1.8);
  });
});

describe('hexes and teams', () => {
  it('opponents get the new hexes (drift, fog, quake, night, rain); owners and their teammates never do', () => {
    const owner = withPower('moving-basket', 'fog-of-war', 'earthquake', 'night-shift', 'rainmaker');
    const all = [owner, neutralMods(), neutralMods()];
    const teamOf = (p: number) => (p === 2 ? 1 : 0); // 0 and 1 a team, 2 the other
    const opp = effectiveMods(all, 2, teamOf), mate = effectiveMods(all, 1, teamOf), self = effectiveMods(all, 0, teamOf);
    expect([opp.drift, opp.fog, opp.quake, opp.night, opp.rain]).toEqual([3, 40, true, true, true]);
    expect(opp.skid).toBeCloseTo(1.6);
    expect(opp.ghost).toBe(0);
    for (const m of [mate, self]) expect([m.drift, m.fog, m.quake, m.night, m.rain]).toEqual([0, 0, false, false, false]);
    // Alone (no teams), player 1 is an opponent again.
    expect(effectiveMods(all, 1).night).toBe(true);
  });

  it('hex trees and ponds spare the owner’s teammates', () => {
    const ch = emptyChanges(3);
    const t = tree(0, 20);
    ch.trees.push({ tree: t, owner: 0 });
    ch.ponds.push({ c: [0, 40], r: 3, owner: 0 });
    const teamOf = (p: number) => (p === 2 ? 1 : 0);
    expect(treesFor([], new Set(), ch, 1, teamOf)).not.toContain(t);
    expect(pondsFor(ch, 1, teamOf)).toHaveLength(0);
    expect(treesFor([], new Set(), ch, 2, teamOf)).toContain(t);
    expect(pondsFor(ch, 2, teamOf)).toHaveLength(1);
  });
});

describe('new augments in the round', () => {
  const course: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali-simple.json', 'utf8'));
  const trees = decodeTrees(course.trees);
  const blocked = () => false;
  const wr = (rest: Vec2, extra: Partial<WireResult> = {}): WireResult => ({ samples: [], banks: [], rest, restSurface: 'fairway', holed: false, penalty: 0, events: [], treesHit: [], ...extra });

  it('Trick Shot: holed off a tree counts as an ace; Basket Buddy is used once a hole', () => {
    const r = new DiscRound(course.holes, trees, { names: ['A', 'B'], first: 0, count: 1, rogue: true }, blocked);
    r.apply({ t: 'rules', rules: { ...r.rules, starter: false } });
    r.apply({ t: 'grant', player: 0, id: 'trick-shot' });
    r.apply({ t: 'grant', player: 0, id: 'basket-buddy' });
    r.apply({ t: 'hole-start', wind: [0, 0] });
    expect(r.buddyLeft[0]).toBe(1);
    const pin = r.game.pins[0];
    r.apply({ t: 'throw', player: 0, perfect: false, result: wr([pin[0] - 20, pin[1]]) });
    r.apply({ t: 'throw', player: 1, perfect: false, result: wr([pin[0] - 20, pin[1]]) });
    r.apply({ t: 'throw', player: 0, perfect: false, result: wr(pin, { holed: true, treesHit: [0], events: ['branch', 'holed'] }) });
    expect(r.game.players[0].strokes).toBe(1); // two throws, but off a tree: an ace
    r.apply({ t: 'throw', player: 1, perfect: false, result: wr(pin, { holed: true, events: ['buddy', 'holed'] }) });
    expect(r.game.players[1].strokes).toBe(2);
  });

  it('Fireball burns a tree away for the thrower this hole; a mulligan puts it back', () => {
    const r = new DiscRound(course.holes, trees, { names: ['A', 'B'], first: 0, count: 1, rogue: true }, blocked);
    r.apply({ t: 'rules', rules: { ...r.rules, starter: false } });
    r.apply({ t: 'grant', player: 0, id: 'mulligan' });
    r.apply({ t: 'hole-start', wind: [0, 0] });
    const e: RoundEvent = { t: 'throw', player: 0, perfect: false, result: wr([0, 0], { burned: [5] }) };
    r.apply(e);
    expect(r.changes.cleared[0].has(trees[5])).toBe(true);
    expect(r.changes.cleared[1].has(trees[5])).toBe(false);
    r.apply({ t: 'mulligan', player: 0 });
    expect(r.changes.cleared[0].has(trees[5])).toBe(false);
  });

  it('teams in Crazy mode: a mulligan takes a throw back out of the volley', () => {
    const r = new DiscRound(course.holes, trees, { names: ['A', 'B', 'C', 'D'], first: 0, count: 1, rogue: true, teams: [0, 0, 1, 1] }, blocked);
    r.apply({ t: 'rules', rules: { ...r.rules, starter: false } });
    r.apply({ t: 'grant', player: 1, id: 'mulligan' });
    r.apply({ t: 'hole-start', wind: [0, 0] });
    expect(r.teams).toEqual([[0, 1], [2, 3]]);
    const tee = r.game.players[0].ball;
    r.apply({ t: 'throw', player: 0, perfect: false, result: wr([tee[0] + 1, tee[1] + 30]) });
    r.apply({ t: 'throw', player: 1, perfect: false, result: wr([tee[0] + 1, tee[1] + 50]) }); // resolves the volley
    expect(r.game.players[0].strokes).toBe(1);
    r.apply({ t: 'mulligan', player: 1 });
    // Back to A's throw waiting in the volley, both still on the tee, B to throw again.
    expect([r.game.players[0].strokes, r.game.players[1].strokes]).toEqual([0, 0]);
    expect(r.volley.get(0)?.map((x) => x.player)).toEqual([0]);
    expect(r.game.current).toBe(1);
  });
});
