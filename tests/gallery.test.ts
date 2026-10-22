// Spectators: where they stand and how they get out of a throw's way (src/game/gallery.ts).
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/course/geo';
import { CLEAR, SAFE, dodge, gallerySpots, lineOfPlay } from '../src/game/gallery';
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
});
