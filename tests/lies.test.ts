// The lie decides the shot (standstill under the trees) and circle 2 jump putts (src/disc/flight.ts).
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { ThrowControl } from '../src/modes/throwStyles';

const sq: Vec2[][] = [[[-150, -150], [150, -150], [150, 150], [-150, 150]]];
const grid = SurfaceGrid.fromHole({ bounds: [[-200, -200], [200, 200]], boundary: [sq], features: [], trees: [] }, 0.5);
const world = (wind?: Vec2): DiscWorld => ({ grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [0, 140], ...(wind ? { wind } : {}) });
const NORTH = Math.PI / 2;

describe('standstill throws', () => {
  it('go about 15% shorter and wobble more', () => {
    const shot: ThrowInput = { start: [0, -100], aim: NORTH, power: 0.7, disc: DISCS[2], hyzer: 0 };
    const far = (i: ThrowInput) => simulateThrow({ ...i, perfect: true }, world()).rest[1] + 100;
    const ratio = far({ ...shot, stance: 'standstill' }) / far(shot);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.92);
    const spread = (i: ThrowInput) => {
      const xs = Array.from({ length: 40 }, (_, s) => simulateThrow(i, world(), mulberry32(s + 1)).rest[0]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(spread({ ...shot, stance: 'standstill', power: 0.8 })).toBeGreaterThan(spread({ ...shot, power: 0.7 }));
  });

  it("don't apply to putts, and X-step from a standstill is thrown the 1-stage way", () => {
    const putt: ThrowInput = { start: [0, 130], aim: NORTH, power: 0.4, disc: PUTTER_DISC, hyzer: 0, style: 'putt', perfect: true };
    expect(simulateThrow({ ...putt, stance: 'standstill' }, world()).rest).toEqual(simulateThrow(putt, world()).rest);
    const c = new ThrowControl({ style: 'xstep', meterSpeed: 1, putt: false, discSpeed: 7, special: false, noOverpower: false, standstill: true });
    c.press(0);
    const r = c.release(500);
    expect(r).toMatchObject({ power: 0.5 });
    expect((r as { execution?: unknown }).execution).toBeUndefined();
  });
});

describe('jump putts', () => {
  // 15 m out, in a 5 m/s crosswind from the west, thrown dead straight.
  const putt: ThrowInput = { start: [0, 125], aim: NORTH, power: 0.5, disc: PUTTER_DISC, hyzer: 0, style: 'putt', perfect: true };
  /** Where it crosses the basket's line (y = 140), and how fast it's going there. */
  const atBasket = (i: ThrowInput, wind?: Vec2) => {
    const s = simulateThrow(i, { ...world(wind), basket: [500, 500] }).samples;
    const k = s.findIndex((p) => p[1] >= 140);
    return { x: s[k][0], speed: Math.hypot(s[k][0] - s[k - 1][0], s[k][1] - s[k - 1][1], s[k][2] - s[k - 1][2]) * 60 };
  };

  it('fly faster and drift less in the wind', () => {
    // The powers that reach the basket's line at chain height: the jump needs less of the meter.
    const P = { ...putt, power: 0.75 }, J = { ...putt, power: 0.62, jump: true };
    const push = atBasket(P), jump = atBasket(J);
    expect(jump.speed).toBeGreaterThan(push.speed);
    // Drift: how far the wind moves each from its own calm line.
    expect(Math.abs(atBasket(J, [5, 0]).x - jump.x)).toBeLessThan(Math.abs(atBasket(P, [5, 0]).x - push.x));
  });

  it('are less accurate', () => {
    const spread = (i: ThrowInput) => {
      const xs = Array.from({ length: 40 }, (_, s) => simulateThrow({ ...i, perfect: false }, { ...world(), basket: [500, 500] }, mulberry32(s + 1)).samples.find((p) => p[1] >= 140)![0]);
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
    };
    expect(spread({ ...putt, power: 0.62, jump: true })).toBeGreaterThan(spread({ ...putt, power: 0.75 }) * 1.3);
  });
});

describe('nose angle', () => {
  it('nose up flies higher and shorter; nose down flies lower; putts ignore it', () => {
    const mid = DISCS.find((d) => d.name === 'Midrange')!;
    const fly = (nose: number) => {
      const r = simulateThrow({ start: [0, -100], aim: NORTH, power: 0.8, disc: mid, hyzer: 0, perfect: true, nose }, world());
      return { far: r.rest[1] + 100, peak: Math.max(...r.samples.map((s) => s[2])) };
    };
    const up = fly(1), level = fly(0), down = fly(-1);
    expect(up.peak).toBeGreaterThan(level.peak);
    expect(down.peak).toBeLessThan(level.peak);
    expect(up.far).toBeLessThan(level.far);
    const putt: ThrowInput = { start: [0, 130], aim: NORTH, power: 0.4, disc: PUTTER_DISC, hyzer: 0, style: 'putt', perfect: true };
    expect(simulateThrow({ ...putt, nose: 1 }, world()).rest).toEqual(simulateThrow(putt, world()).rest);
  });
});
