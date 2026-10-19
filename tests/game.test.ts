import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LocalFrame, pointInRings, type Vec2 } from '../src/course/geo';
import type { CourseFile, CourseHole, Rings } from '../src/course/types';
import { CLUBS, PUTTER, suggestClub } from '../src/game/clubs';
import { HoleGame, scoreName } from '../src/game/game';
import { mulberry32, simulateShot, type ShotResult, type World } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const rect = (x0: number, y0: number, x1: number, y1: number): Rings => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
const club = (id: string) => CLUBS.find((c) => c.id === id)!;

// Synthetic hole running north from (0,-300) to a pin at (0,0).
function testHole(over: Partial<CourseHole> = {}): CourseHole {
  return {
    ref: '1', par: 4, tee: [0, -300], pin: [0, 0], routing: [[0, -300], [0, 0]], length_m: 300,
    features: [
      { class: 'fairway', osm_id: 'f', rings: rect(-20, -280, 20, -20) },
      { class: 'green', osm_id: 'g', rings: rect(-15, -15, 15, 15) },
      { class: 'water', osm_id: 'w', rings: rect(-20, -160, 20, -140) },
      { class: 'bunker', osm_id: 'b', rings: rect(20, -60, 40, -40) },
    ],
    trees: [],
    boundary: [rect(-100, -320, 100, 40)],
    bounds: [[-120, -340], [120, 60]],
    ...over,
  };
}

function world(hole: CourseHole): World {
  return { grid: SurfaceGrid.fromHole(hole), terrain: new FlatTerrain(), pin: hole.pin };
}

const NORTH = Math.PI / 2;
// rng() = 0.25 makes the Box-Muller gaussian exactly 0: no dispersion.
const straight = () => 0.25;

describe('geo', () => {
  it('round-trips the local frame and keeps distances in meters', () => {
    const f = new LocalFrame({ lat: 42.3134, lon: -71.1506 });
    const [x, y] = f.toLocal(42.3144, -71.1496);
    const back = f.toLatLon(x, y);
    expect(back.lat).toBeCloseTo(42.3144, 9);
    expect(back.lon).toBeCloseTo(-71.1496, 9);
    // 0.001° lat ≈ 110.5 m; 0.001° lon at 42.3°N ≈ 82.3 m (Mercator would say ~111 m)
    expect(y).toBeCloseTo(110.5, 0);
    expect(x).toBeCloseTo(82.3, 0);
  });
});

describe('SurfaceGrid', () => {
  const g = SurfaceGrid.fromHole(testHole());
  it('classifies by priority with rough as default and oob outside', () => {
    expect(g.classAt(0, -200)).toBe('fairway');
    expect(g.classAt(0, -150)).toBe('water'); // water drawn over fairway
    expect(g.classAt(0, 0)).toBe('green');
    expect(g.classAt(30, -50)).toBe('bunker');
    expect(g.classAt(60, -200)).toBe('rough');
    expect(g.classAt(110, -200)).toBe('oob');
    expect(g.classAt(1000, 1000)).toBe('oob');
  });
});

describe('simulateShot', () => {
  it('a full 7-iron from the fairway carries ~150 yd and rolls a little', () => {
    const w = world(testHole());
    const r = simulateShot({ start: [0, -270], aim: NORTH, club: club('7i'), power: 1 }, w, straight);
    const travelled = r.rest[1] + 270;
    expect(travelled).toBeGreaterThan(130);
    expect(travelled).toBeLessThan(160);
    expect(r.penalty).toBe(0);
    // Ball flies: apex well above ground mid-flight.
    expect(Math.max(...r.samples.map((s) => s[2]))).toBeGreaterThan(20);
  });

  it('water: +1 and drop on the near side of the hazard', () => {
    const w = world(testHole());
    // 120 m carry from the fairway at -275 lands in the water at -155.
    const r = simulateShot({ start: [0, -275], aim: NORTH, club: club('6i'), power: 120 / club('6i').carry }, w, straight);
    expect(r.events).toContain('water');
    expect(r.penalty).toBe(1);
    expect(r.rest[1]).toBeLessThan(-160);
    expect(w.grid.classAt(r.rest[0], r.rest[1])).not.toBe('water');
  });

  it('out of bounds: casual drop just inside the boundary, +1', () => {
    const w = world(testHole());
    const r = simulateShot({ start: [0, -250], aim: 0 /* east */, club: club('5i'), power: 1 }, w, straight);
    expect(r.events).toContain('oob');
    expect(r.penalty).toBe(1);
    expect(r.rest[0]).toBeGreaterThan(95);
    expect(r.rest[0]).toBeLessThan(100);
  });

  it('a straight putt at the right pace drops', () => {
    const w = world(testHole());
    // 6 m putt; aim power so it would stop ~0.5 m past the hole.
    const r = simulateShot({ start: [0, -6], aim: NORTH, club: PUTTER, power: 6.5 / 30 }, w, straight);
    expect(r.holed).toBe(true);
    expect(r.events).toContain('holed');
  });

  it('a putt hit far too hard lips out and runs past', () => {
    const w = world(testHole());
    const r = simulateShot({ start: [0, -6], aim: NORTH, club: PUTTER, power: 1 }, w, straight);
    expect(r.holed).toBe(false);
    expect(r.events).toContain('lipout');
  });

  it('trees block a low ball (option B)', () => {
    const hole = testHole({ trees: [{ osm_id: 't', rings: rect(-30, -265, 30, -255), height_m: 15 }] });
    const w = world(hole);
    // Ball is still low 10 m after the start.
    const r = simulateShot({ start: [0, -275], aim: NORTH, club: club('7i'), power: 1 }, w, straight);
    expect(r.events).toContain('tree');
    expect(r.rest[1]).toBeLessThan(-250);
  });

  it('is deterministic for a given seed', () => {
    const w = world(testHole());
    const s = { start: [0, -300] as Vec2, aim: NORTH, club: club('D'), power: 1 };
    expect(simulateShot(s, w, mulberry32(7)).rest).toEqual(simulateShot(s, w, mulberry32(7)).rest);
  });
});

const shot = (r: ShotResult) => r;

describe('HoleGame', () => {
  it('uses the away rule and counts penalties', () => {
    const g = new HoleGame(testHole(), ['A', 'B']);
    expect(g.player.name).toBe('A');
    g.applyShot(shot({ samples: [], rest: [0, -100], restSurface: 'fairway', holed: false, penalty: 0, events: [] }));
    expect(g.player.name).toBe('B'); // B still on the tee, farther away
    g.applyShot(shot({ samples: [], rest: [0, -150], restSurface: 'fairway', holed: false, penalty: 1, events: ['water'] }));
    expect(g.players[1].strokes).toBe(2);
    expect(g.player.name).toBe('B'); // B (150 m) is still away from A (100 m)
  });

  it('names scores', () => {
    expect(scoreName(3, 4)).toBe('Birdie');
    expect(scoreName(1, 3)).toBe('Hole in one!');
    expect(scoreName(9, 4)).toBe('+5');
  });

  it('suggests a club that reaches', () => {
    expect(suggestClub(130, false).id).toBe('8i');
    expect(suggestClub(400, true).id).toBe('D');
  });
});

describe('built course file', () => {
  const course: CourseFile = JSON.parse(readFileSync('public/courses/tcc-main-17.json', 'utf8'));
  const hole = course.holes[0];
  it('is TCC Main 17, par 4, with the pin on a green and the tee on a tee box', () => {
    expect(course.name).toBe('The Country Club');
    expect(hole.ref).toBe('17');
    expect(hole.par).toBe(4);
    const g = SurfaceGrid.fromHole(hole);
    expect(g.classAt(hole.pin[0], hole.pin[1])).toBe('green');
    expect(hole.features.some((f) => f.class === 'green' && pointInRings(hole.pin, f.rings))).toBe(true);
    expect(['tee', 'fairway', 'rough']).toContain(g.classAt(hole.tee[0], hole.tee[1]));
  });

  it('keeps full lat/lon precision on the origin (imagery is placed from it)', () => {
    // A 0.01° rounding error once put the photo ~800 m off the course.
    expect(course.origin.lat.toString().split('.')[1].length).toBeGreaterThan(5);
    expect(course.origin.lon.toString().split('.')[1].length).toBeGreaterThan(5);
  });
});
