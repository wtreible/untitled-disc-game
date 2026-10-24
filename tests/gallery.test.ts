// Spectators: where they stand and how they get out of a throw's way (src/game/gallery.ts).
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import { BODY, CLEAR, SAFE, approachAt, dodge, dodgeDue, gallerySpots, lineOfPlay, separate } from '../src/game/gallery';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const open = () => true;
const PIN: Vec2 = [0, 100];
const NORTH: Vec2 = [0, 1];
const lowDist = (p: Vec2, path: [number, number, number][]) => Math.min(...path.filter((s) => s[2] <= 2.6).map((s) => Math.hypot(s[0] - p[0], s[1] - p[1])));

describe('gallery', () => {
  it('stands around the basket, never in front of it, apart from each other', () => {
    const spots = gallerySpots(PIN, NORTH, 6, open, mulberry32(4));
    expect(spots).toHaveLength(6);
    for (const s of spots) {
      const dx = s.at[0] - PIN[0], dy = s.at[1] - PIN[1];
      const r = Math.hypot(dx, dy);
      expect(r).toBeGreaterThanOrEqual(7);
      expect(r).toBeLessThanOrEqual(12);
      // In front = toward the tee (south): the angle from straight back (north) stays under 130°.
      expect(Math.acos(dy / r)).toBeLessThanOrEqual((130 * Math.PI) / 180 + 1e-9);
      for (const o of spots) if (o !== s) expect(Math.hypot(o.at[0] - s.at[0], o.at[1] - s.at[1])).toBeGreaterThanOrEqual(1.6);
    }
  });

  it('skips ground that is not free', () => {
    const spots = gallerySpots(PIN, NORTH, 6, (p) => p[0] > 0, mulberry32(4));
    for (const s of spots) expect(s.at[0]).toBeGreaterThan(0);
  });

  it('steps out of a flight path to a safe distance, and stays put when clear', () => {
    const path = lineOfPlay([0, 0], [0, 120]);
    const to = dodge([0.5, 60], path, open)!;
    expect(to).not.toBeNull();
    expect(lowDist(to, path)).toBeGreaterThanOrEqual(SAFE - 0.5);
    expect(to[0]).toBeGreaterThan(0); // the near side
    expect(dodge([CLEAR + 0.5, 60], path, open)).toBeNull();
  });

  it('ignores the part of a flight too high to hit anyone', () => {
    const path: [number, number, number][] = Array.from({ length: 50 }, (_, k) => [0, k, 10]);
    expect(dodge([0, 25], path, open)).toBeNull();
  });

  it('clears a real drive that runs past the basket into the gallery', () => {
    const grid = SurfaceGrid.fromHole({ bounds: [[-200, -200], [200, 200]], boundary: [[[[-150, -150], [150, -150], [150, 150], [-150, 150]]]], trees: [], features: [] }, 0.5);
    const w: DiscWorld = { grid, terrain: new FlatTerrain(), trees: new TreeIndex([]), basket: [999, 999] };
    const DD = DISCS.find((d) => d.id === 'DD')!;
    const r = simulateThrow({ start: [0, -100], aim: Math.PI / 2, power: 1, disc: DD, hyzer: 0 }, w, () => 0.25, { ghost: true });
    // The basket 9 m short of where it stops: it skids on through the people behind the basket.
    const spots = gallerySpots([r.rest[0], r.rest[1] - 9], NORTH, 6, open, mulberry32(9));
    let moved = 0;
    for (const s of spots) {
      const to = dodge(s.at, r.samples, open);
      if (to) moved++;
      expect(lowDist(to ?? s.at, r.samples)).toBeGreaterThanOrEqual(to ? SAFE - 0.5 : CLEAR);
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('spectators wait for the disc: they run only once it is near enough that they must', () => {
    // A straight, low throw along +x at 20 m/s (60 Hz samples), someone standing on the line at 100 m.
    const path = Array.from({ length: 600 }, (_, k): [number, number, number] => [k / 3, 0, 1]);
    const at = approachAt([100, 0.5], path);
    expect(at).toBe(300); // 5 s in
    const run = 4, sprint = 5.5; // 4 m to their safe spot, at a sprint: ~0.73 s, plus the spare time
    const due = (t: number, speed = 1) => dodgeDue(at - t, 60 * speed, run, sprint);
    expect(due(0)).toBe(false); // just thrown: 100 m off, stay put
    expect(due(180)).toBe(false); // 40 m off
    const first = path.findIndex((_, t) => due(t));
    const away = 100 - path[first][0];
    expect(away).toBeGreaterThan(20); // still in time: they run while the disc is ~26 m off…
    expect(away).toBeLessThan(35); // …not before
    // Fast-forward (3× faster flight): they run earlier in the flight, the same time before it arrives.
    const ff = path.findIndex((_, t) => due(t, 3));
    expect(ff).toBeLessThan(first);
    expect((at - ff) / 180).toBeCloseTo((at - first) / 60, 1);
    // A path that is all overhead: no nearest pass to dodge.
    expect(approachAt([60, 0], path.map(([x, y]) => [x, y, 10] as [number, number, number]))).toBe(-1);
  });

  it('nobody stands inside anybody: overlapping people are pushed apart, others left alone', () => {
    const gap = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    // Two overlapping, one on the very same spot as another, one well clear.
    const out = separate([[0, 0], [0.3, 0], [5, 5], [5, 5], [20, 0]]);
    expect(gap(out[0], out[1])).toBeGreaterThanOrEqual(BODY - 1e-6);
    expect(gap(out[2], out[3])).toBeGreaterThanOrEqual(BODY - 1e-6);
    expect(out[4]).toEqual([20, 0]);
    // A push onto ground they can't stand on isn't made: the other one takes it all (over a pass or two).
    const wall = (p: number[]) => p[0] >= 0; // x < 0 is a pond
    const near = separate([[0, 0], [0.2, 0]], BODY, wall);
    expect(near[0][0]).toBeGreaterThanOrEqual(0);
    expect(gap(near[0], near[1])).toBeGreaterThan(0.5);
  });
});
