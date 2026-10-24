// Throws on the wire (src/net/wire.ts): packed smaller, unpacked to exactly the same flight.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTrees, type DiscCourseFile } from '../src/course/disc-types';
import type { Vec2 } from '../src/course/geo';
import { DISCS, PUTTER_DISC } from '../src/disc/discs';
import { simulateThrow, type DiscWorld } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';
import { DiscRound, type RoundEvent } from '../src/modes/discRound';
import { packEvent, packTrack, unpackEvent, unpackTrack } from '../src/net/wire';

const course: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali.json', 'utf8'));
const trees = decodeTrees(course.trees);
const grid = SurfaceGrid.fromHole({ bounds: course.bounds, boundary: course.boundary, features: course.features, ob: course.ob, trees: [] }, 1);
const blocked = (q: Vec2) => { const c = grid.classAt(q[0], q[1]); return c === 'oob' || c === 'water'; };

/** Throws from every tee on the course, drives and putts, as the game sends them. */
function throws(): RoundEvent[] {
  const r = new DiscRound(course.holes, trees, { names: ['A'], first: 0, count: course.holes.length, rogue: false }, blocked);
  const out: RoundEvent[] = [];
  course.holes.forEach((h, k) => {
    const w: DiscWorld = { grid, terrain: new FlatTerrain(), basket: h.pin, branchDensity: course.branch_density, trees: new TreeIndex(trees), wind: [1.5, -0.5] };
    const aim = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]);
    for (const [disc, power, style] of [[DISCS[0], 1, 'drive'], [DISCS[2], 0.7, 'drive'], [PUTTER_DISC, 0.3, 'putt']] as const) {
      const res = simulateThrow({ start: h.tee, aim: aim + (k % 3 - 1) * 0.1, power, disc, hyzer: 0.25, style }, w, mulberry32(k + 1));
      out.push({ t: 'throw', player: 0, perfect: false, result: r.wire(res), twin: k % 4 === 0 ? r.wire(res).samples.filter((_, i) => i % 2 === 0) : undefined });
    }
  });
  return out;
}

describe('throw events on the wire', () => {
  it('a track comes back exactly', () => {
    const pts = [[1.234, -5.678, 0.5], [1.3, -5.6, 0.62], [1.37, -5.52, 0.73], [1.37, -5.52, 0.73], [-100.001, 2, 0]];
    expect(unpackTrack(packTrack(pts, 3), 3)).toEqual(pts);
    expect(unpackTrack(packTrack([], 3), 3)).toEqual([]);
    expect(unpackTrack(packTrack([[7.5, 1, 2]], 3), 3)).toEqual([[7.5, 1, 2]]);
  });

  it('every throw unpacks (through JSON) to the event that was packed, and is several times smaller', () => {
    const all = throws();
    let before = 0, after = 0;
    for (const e of all) {
      const wire = JSON.stringify(packEvent(e));
      expect(unpackEvent(JSON.parse(wire))).toEqual(JSON.parse(JSON.stringify(e)));
      before += JSON.stringify(e).length;
      after += wire.length;
    }
    console.log(`${all.length} throws: ${before} → ${after} bytes (${(before / after).toFixed(1)}× smaller)`);
    expect(after * 2.5).toBeLessThan(before);
  });

  it('other events, and throws from an older build (no q), pass through', () => {
    const e: RoundEvent = { t: 'hole-start', wind: [1, 2] };
    expect(packEvent(e)).toBe(e);
    expect(unpackEvent(e)).toBe(e);
    const old = throws()[0];
    expect(unpackEvent(old)).toBe(old);
  });
});
