// A hole's own rules (src/disc/flight.ts): mandos, drop zones and island greens.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiscCourseFile, Mando } from '../src/course/disc-types';
import { distToPolyline, type Vec2 } from '../src/course/geo';
import type { Rings } from '../src/course/types';
import { DISCS } from '../src/disc/discs';
import { missedMando, simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { neutralMods } from '../src/disc/mods';
import { TreeIndex } from '../src/disc/trees';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain, type Vec3 } from '../src/game/terrain';

const NORTH = Math.PI / 2;
const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
const world = (rules: DiscWorld['rules'], ob: Rings[] = []): DiscWorld => ({
  grid: SurfaceGrid.fromHole({ bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], features: [], trees: [], ob }, 0.5),
  terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [0, 300], rules,
});
// A mando 40 m up the line from the tee at the origin: the hole's line passes it on the left, so the
// wrong side is to its right (away = +x).
const mando: Mando = { at: [3, 40], away: [1, 0], dir: [0, 1] };
const shot: ThrowInput = { start: [0, 0], aim: NORTH, power: 0.7, disc: DISCS[2], hyzer: 0, perfect: true };

describe('mandos', () => {
  const line = (x0: number, x1: number): Vec3[] => Array.from({ length: 21 }, (_, k) => [x0 + ((x1 - x0) * k) / 20, k * 5, 1]);
  it('going past on the wrong side is a miss; the right side, or never reaching it, is fine', () => {
    expect(missedMando(line(0, 10), [0, 0], [mando])).toBeGreaterThan(0); // crosses x = 3 … 83 at y = 40
    expect(missedMando(line(0, -5), [0, 0], [mando])).toBe(-1);
    expect(missedMando(line(10, 10).slice(0, 6), [10, 0], [mando])).toBe(-1); // stops short (y ≤ 25)
  });
  it("a mando already behind the lie doesn't count", () => {
    expect(missedMando(line(10, 10).map(([x, y, z]): Vec3 => [x, y + 60, z]), [10, 60], [mando])).toBe(-1);
  });

  it('a missed mando in flight: +1, from the drop zone (or the lie when there is none)', () => {
    const wrong = { ...shot, aim: NORTH - 0.12 }; // a few degrees right: passes the mando on its right
    const drop: Vec2 = [-5, 30];
    const r = simulateThrow(wrong, world({ mandos: [mando], drop }));
    expect(r.events).toContain('mando');
    expect(r.penalty).toBe(1);
    expect(r.rest).toEqual(drop);
    expect(r.marks?.some(([, m]) => m === 'mando')).toBe(true);
    expect(simulateThrow(wrong, world({ mandos: [mando] })).rest).toEqual([0, 0]);
    const right = simulateThrow({ ...shot, aim: NORTH + 0.1 }, world({ mandos: [mando], drop }));
    expect(right.events).not.toContain('mando');
    expect(right.penalty).toBe(0);
  });
});

describe('drop zones and islands', () => {
  it('OB plays from the drop zone when the hole has one', () => {
    const ob: Rings[] = [[[[-150, 40], [150, 40], [150, 150], [-150, 150]]]];
    const drop: Vec2 = [0, 20];
    const r = simulateThrow(shot, world({ drop }, ob));
    expect(r.events).toContain('oob');
    expect(r.rest).toEqual(drop);
    expect(simulateThrow(shot, world(undefined, ob)).rest[1]).toBeGreaterThan(35); // no zone: where it went out
  });

  it('finishing off the island green is +1 from the drop zone; OB insurance covers it', () => {
    const island: Vec2[] = [[-10, 200], [10, 200], [10, 230], [-10, 230]];
    const drop: Vec2 = [0, 150];
    const r = simulateThrow(shot, world({ island, drop }));
    expect(r.events).toContain('island');
    expect(r.penalty).toBe(1);
    expect(r.rest).toEqual(drop);
    const m = neutralMods();
    m.obInsurance = true;
    expect(simulateThrow({ ...shot, mods: m }, world({ island, drop })).penalty).toBe(0);
  });

  it('the Prater has its mandos, drop zones and island green', () => {
    const c: DiscCourseFile = JSON.parse(readFileSync('public/courses/prater.json', 'utf8'));
    const by = (ref: string) => c.holes.find((h) => h.ref === ref)!;
    expect(c.holes.reduce((n, h) => n + (h.mandos?.length ?? 0), 0)).toBe(4);
    expect(by('18').island?.length).toBeGreaterThan(3);
    // Every drop zone is by its own hole (a ref that numbers the zones, not the holes, doesn't move it).
    for (const h of c.holes) if (h.drop) expect(distToPolyline(h.drop, h.routing)).toBeLessThan(50);
  });
});
