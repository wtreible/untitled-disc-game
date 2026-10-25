// Player stats (src/game/playerStats.ts), the round records they're built from
// (src/modes/roundStats.ts holeRecords), and shot analysis (src/game/shotStats.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import { playerRating, recordRound, roundRating, roundsOf, summarize, type HoleRec, type ThrowRec } from '../src/game/playerStats';
import { shapeText, shotShape } from '../src/game/shotStats';
import type { Vec3 } from '../src/game/terrain';
import type { RoundEvent } from '../src/modes/discRound';
import { holeRecords } from '../src/modes/roundStats';

const t = (d: number, rest: number, o: Partial<ThrowRec> = {}): ThrowRec => ({ d, rest, holed: rest === 0, penalty: 0, tee: false, lie: 'fairway', ...o });

describe('player stats', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) };
  });

  it('rating: 1000 is par, 10 points a stroke over 18 holes (20 over 9)', () => {
    const holes = (n: number, over: number): HoleRec[] => Array.from({ length: n }, (_, i) => ({ par: 3, strokes: 3 + (i < over ? 1 : 0), throws: [] }));
    expect(roundRating(holes(18, 0))).toBe(1000);
    expect(roundRating(holes(18, 3))).toBe(970);
    expect(roundRating(holes(9, 3))).toBe(940);
    expect(playerRating([])).toBeNull();
  });

  it('putting, driving and regulation numbers', () => {
    const hole1: HoleRec = { par: 3, strokes: 3, throws: [t(90, 8, { tee: true }), t(8, 1), t(1, 0)] }; // C1X miss, C1 in reg
    const hole2: HoleRec = { par: 3, strokes: 2, throws: [t(80, 2, { tee: true }), t(2, 0)] }; // parked, tap-in
    const hole3: HoleRec = { par: 3, strokes: 3, throws: [t(100, 40, { tee: true, lie: 'trees' }), t(40, 15), t(15, 0)] }; // C2 make, scramble
    const hole4: HoleRec = { par: 4, strokes: 6, throws: [t(150, 150, { tee: true, penalty: 1, lie: 'water' }), t(150, 30), t(30, 6), t(6, 0)] };
    const s = summarize([{ at: '', course: 'x', holes: [hole1, hole2, hole3, hole4], rating: 0 }]);
    expect(s.c1x).toEqual([1, 2]); // 8 m missed, 6 m made
    expect(s.c2).toEqual([1, 1]);
    expect(s.fairway).toEqual([2, 4]); // the trees and the water miss
    expect(s.parked).toEqual([1, 4]);
    expect(s.c1r).toEqual([2, 4]);
    expect(s.scramble).toEqual([1, 2]); // hole 3 saved par, hole 4 didn't
    expect(s.ob).toEqual([1, 12]);
    expect(s.birdies).toBe(1);
    expect(s.toPar18).toBeCloseTo((1 * 18) / 4, 6);
  });

  it('records a round once, and the rating moves', () => {
    const par: HoleRec[] = Array.from({ length: 9 }, () => ({ par: 3, strokes: 3, throws: [] }));
    const a = recordRound('Ann', 'Tali', par);
    expect(a.before).toBeNull();
    expect(a.after).toBe(1000);
    const bogeys = par.map((h, i) => ({ ...h, strokes: i < 2 ? 4 : 3 }));
    const b = recordRound('Ann', 'Tali', bogeys);
    expect(b.after).toBe(980); // (1000 + 960) / 2
    expect(recordRound('Ann', 'Tali', bogeys).after).toBe(980); // shown again: not counted twice
    expect(roundsOf('Ann')).toHaveLength(2);
  });
});

describe('round records from the log', () => {
  const throwAt = (player: number, from: Vec2, rest: Vec2, holed = false, penalty = 0): RoundEvent => ({
    t: 'throw', player, perfect: false,
    result: { samples: [[from[0], from[1], 1], [rest[0], rest[1], 0]], banks: [0, 0], rest, restSurface: 'fairway', holed, penalty, events: [], treesHit: [] },
  });
  it('throws per hole with their distances; a mulligan takes one back', () => {
    const holes = [{ pin: [0, 100] as Vec2, par: 3 }, { pin: [0, 50] as Vec2, par: 3 }];
    const log: RoundEvent[] = [
      { t: 'hole-start', wind: [0, 0] },
      throwAt(0, [0, 0], [0, 90]), { t: 'mulligan', player: 0 }, throwAt(0, [0, 0], [0, 95]), throwAt(0, [0, 95], [0, 100], true),
      { t: 'hole-start', wind: [0, 0] },
      throwAt(0, [0, 0], [0, 50], true),
    ];
    const [recs] = holeRecords(log, holes, 1, 0, [[2, 1]]);
    expect(recs).toHaveLength(2);
    expect(recs[0].strokes).toBe(2);
    expect(recs[0].throws.map((x) => [Math.round(x.d), Math.round(x.rest), x.tee, x.holed])).toEqual([[100, 5, true, false], [5, 0, false, true]]);
    expect(recs[1].throws[0]).toMatchObject({ d: 50, holed: true, tee: true });
  });
});

describe('shot analysis', () => {
  it('carry, peak, speed and which way it went', () => {
    // North at 20 m/s, up to 8 m, out 3 m right then back 5 m left, down at 60 m, skids to 66 m.
    const samples: Vec3[] = [];
    for (let k = 0; k <= 180; k++) {
      const y = (k / 60) * 20, f = k / 180;
      // Leaves the hand straight (as a real release does), turns 3 m right, fades back 5 m left.
      samples.push([f < 0.5 ? 3 * Math.sin(f * Math.PI) ** 2 : 3 - 32 * (f - 0.5) ** 2, y, 1 + 7 * Math.sin(f * Math.PI)]);
    }
    samples.push([-5, 60, 0]);
    const s = shotShape(samples, [-5, 66], () => 0);
    expect(s.speed).toBeGreaterThan(19);
    expect(s.peak).toBeCloseTo(8, 0);
    expect(s.carry).toBeGreaterThan(58);
    expect(s.total).toBeCloseTo(Math.hypot(5, 66), 3);
    expect(s.firstRight).toBe(true);
    expect(s.right).toBeGreaterThan(2);
    expect(s.left).toBeGreaterThan(4);
    expect(shapeText(s, (m) => `${m.toFixed(0)} m`)).toMatch(/^\d m right, then \d m left$/);
  });
});
