// The hand-built themed courses (public/courses/*.json): playable tees and baskets, and the set
// pieces behave as designed (road OB, the gap, rings and castle gate you can throw through).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeTrees, type DiscCourseFile } from '../src/course/disc-types';
import type { Vec2 } from '../src/course/geo';
import { DISCS } from '../src/disc/discs';
import { simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import type { Collider } from '../src/disc/props';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const load = (id: string): DiscCourseFile => JSON.parse(readFileSync(`public/courses/${id}.json`, 'utf8'));
const gridOf = (c: DiscCourseFile) => SurfaceGrid.fromHole({ bounds: c.bounds, boundary: c.boundary, features: c.features, ob: c.ob, sea: c.sea, trees: [] }, 0.5);
const worldOf = (c: DiscCourseFile, basket: Vec2): DiscWorld => ({
  grid: gridOf(c), terrain: new FlatTerrain(), trees: new TreeIndex(decodeTrees(c.trees)), basket,
  props: (c.props ?? []).flatMap((p) => p.colliders), clock0: 0, branchDensity: c.branch_density,
});
/** Is the point inside a collider's footprint (any height)? */
function inside(p: Vec2, c: Collider): boolean {
  if (c.kind === 'cyl') return Math.hypot(p[0] - c.c[0], p[1] - c.c[1]) < c.r;
  if (c.kind === 'box') {
    const dx = p[0] - c.c[0], dy = p[1] - c.c[1], cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
    return Math.abs(dx * cs + dy * sn) < c.hx && Math.abs(-dx * sn + dy * cs) < c.hy;
  }
  return false;
}
const MR = DISCS.find((d) => d.id === 'MR')!;
const PT = DISCS.find((d) => d.id === 'PT')!;
const throwAt = (_c: DiscCourseFile, w: DiscWorld, o: Partial<ThrowInput> & { start: Vec2; aim: number }) =>
  simulateThrow({ power: 1, disc: MR, hyzer: 0, perfect: true, ...o }, w, mulberry32(3));

describe.each(['silly', 'fantasy', 'rainbow', 'pirate', 'graveyard'])('%s course', (id) => {
  const c = load(id);
  const grid = gridOf(c);
  const colliders = (c.props ?? []).flatMap((p) => p.colliders);

  it('has 9 named holes with tees and baskets in bounds and clear of props', () => {
    expect(c.holes).toHaveLength(9);
    for (const h of c.holes) {
      expect(h.name).toBeTruthy();
      for (const p of [h.tee, h.pin]) {
        expect(['oob', 'water']).not.toContain(grid.classAt(p[0], p[1]));
        expect(colliders.filter((k) => inside(p, k)).map((k) => k.tag)).toEqual([]);
      }
    }
  });

  it('every hole can be reached with a soft putt from 6 m out (no prop sitting on the basket)', () => {
    for (const h of c.holes) {
      const w = worldOf(c, h.pin);
      // Approach from the side away from the hole line's last leg, so set pieces in front don't count.
      const [a, b] = [h.routing[h.routing.length - 2], h.pin];
      const back = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const ok = [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((da) => {
        const dir = back + da;
        const start: Vec2 = [h.pin[0] - Math.cos(dir) * 6, h.pin[1] - Math.sin(dir) * 6];
        if (colliders.some((k) => inside(start, k))) return false;
        for (let p = 0.2; p <= 0.6; p += 0.02) if (throwAt(c, w, { start, aim: dir, disc: PT, power: p }).holed) return true;
        return false;
      });
      expect(ok, `hole ${h.ref} ${h.name}`).toBe(true);
    }
  });
});

describe('Rainbow Runs', () => {
  const c = load('rainbow');
  const grid = gridOf(c);
  const H = c.holes;

  it('off the road is OB, with a themed message', () => {
    const h = H[0];
    expect(grid.classAt(h.tee[0], h.tee[1] + 30)).not.toBe('oob');
    expect(grid.classAt(h.tee[0] + 12, h.tee[1] + 30)).toBe('oob');
    expect(c.toasts?.oob).toMatch(/\+1/);
    // A throw aimed 50° off the road lands in the void: OB, +1, dropped back on the road.
    const r = throwAt(c, worldOf(c, h.pin), { start: h.tee, aim: Math.PI / 2 - 0.9 });
    expect(r.events).toContain('oob');
    expect(r.penalty).toBe(1);
    expect(grid.classAt(r.rest[0], r.rest[1])).not.toBe('oob');
  });

  it('Gap Jump: the middle of the hole is void', () => {
    const h = H[6];
    const mid: Vec2 = [(h.tee[0] + h.pin[0]) / 2, (h.tee[1] + h.pin[1]) / 2];
    expect(grid.classAt(mid[0], mid[1])).toBe('oob');
  });

  it('Ring Road: there is a line through all three rings, and aiming at a post clips it', () => {
    const h = H[2];
    const w = worldOf(c, h.pin);
    const rings = (c.props ?? []).filter((p) => p.hit === 'Clipped the ring!' && Math.abs(p.at[0] - h.tee[0]) < 1); // hole 3 runs due south
    expect(rings).toHaveLength(3);
    const dir = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]);
    /** Lateral offset of the path where it passes ring k's plane, or null if it never gets there. */
    const crossing = (r: ReturnType<typeof throwAt>, k: number) => {
      const [cx, cy] = rings[k].at, u = [Math.cos(dir), Math.sin(dir)];
      const s = r.samples.find((q) => (q[0] - cx) * u[0] + (q[1] - cy) * u[1] > 0);
      return s ? -(s[0] - cx) * u[1] + (s[1] - cy) * u[0] : null;
    };
    let found = false;
    for (const disc of DISCS) for (const power of [0.8, 0.9, 1]) for (const hyzer of [-0.5, -0.25, 0, 0.25, 0.5]) for (const da of [-0.04, -0.02, 0, 0.02, 0.04]) {
      if (found) break;
      const r = throwAt(c, w, { start: h.tee, aim: dir + da, disc, power, hyzer, launch: 0.05 });
      if ((r.propHits ?? []).length === 0 && [0, 1, 2].every((k) => { const x = crossing(r, k); return x !== null && Math.abs(x) < 4; })) found = true;
    }
    expect(found).toBe(true);
    // The side of the frame, 5.6 m either side of center: just outside the hexagonal opening at the
    // ~4 m a disc is up there. At least one side gets clipped.
    const [rx, ry] = rings[0].at, yaw = rings[0].yaw;
    const side = [-5.6, 5.6].map((l): Vec2 => [rx + Math.cos(yaw) * l, ry + Math.sin(yaw) * l]);
    const clipped = side.some((q) => (throwAt(c, w, { start: h.tee, aim: Math.atan2(q[1] - h.tee[1], q[0] - h.tee[0]), power: 0.85 }).propHits ?? []).includes('ring'));
    expect(clipped).toBe(true);
  });
});

describe('Rainbow Runs rings', () => {
  const c = load('rainbow');
  it('colliders leave the hexagonal opening clear and fill the frame', () => {
    for (const r of (c.props ?? []).filter((p) => p.hit === 'Clipped the ring!')) {
      // A sweeping ring's boxes sit in a slide collider, at rest where the model stands.
      const boxes = (r.colliders[0]?.kind === 'slide' ? r.colliders[0].parts : r.colliders) as Extract<Collider, { kind: 'box' }>[];
      const s = r.scale, lift = r.lift ?? 0;
      const yaw = r.yaw;
      const hitAt = (x: number, zUnits: number) => {
        const p: Vec2 = [r.at[0] + Math.cos(yaw) * x * s, r.at[1] + Math.sin(yaw) * x * s];
        const z = zUnits * s + lift;
        return boxes.some((b) => z >= b.z0 && z <= b.z1 && inside(p, b));
      };
      // Inside the opening (model units, measured from the mesh): clear.
      for (const [x, z] of [[0, 0.32], [0, 0.58], [0, 0.84], [0.28, 0.58], [-0.28, 0.58], [0.15, 0.4], [-0.15, 0.76]]) expect(hitAt(x, z), `open ${x},${z}`).toBe(false);
      // The frame: solid.
      for (const [x, z] of [[0, 0.2], [0, 0.95], [0.42, 0.58], [-0.42, 0.58], [0.3, 0.32], [-0.3, 0.84]]) expect(hitAt(x, z), `frame ${x},${z}`).toBe(true);
    }
  });
});

describe('Fantasy Fairways', () => {
  const c = load('fantasy');
  it('Castle Keep: a flat throw through the gate lands in the courtyard (drawbridge down); walls block a low line', () => {
    const h = c.holes[4];
    const aim = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]);
    const w = { ...worldOf(c, h.pin), clock0: 14 * 0.55 }; // the drawbridge is down from 0.5 to 0.88 of its 14 s cycle
    // Through the gate: tee shot then an approach from 20 m in front of the gate.
    const start: Vec2 = [h.pin[0] - Math.cos(aim) * 30, h.pin[1] - Math.sin(aim) * 30];
    const through = [0.3, 0.35, 0.4, 0.45].map((p) => throwAt(c, w, { start, aim, disc: PT, power: p, launch: 0.05 }));
    expect(through.some((r) => (r.propHits ?? []).length === 0 && Math.hypot(r.rest[0] - h.pin[0], r.rest[1] - h.pin[1]) < 12)).toBe(true);
    // 8 m to the side of the gate the same throw hits the wall.
    const side: Vec2 = [start[0] - Math.sin(aim) * 8, start[1] + Math.cos(aim) * 8];
    const r = throwAt(c, w, { start: side, aim, disc: PT, power: 0.4, launch: 0.05 });
    expect(r.propHits).toContain('castle');
    // With the drawbridge up, the throws that reach the gate hit it (0.3 stops short of it).
    const up = [0.35, 0.4, 0.45].map((p) => throwAt(c, { ...w, clock0: 0 }, { start, aim, disc: PT, power: p, launch: 0.05 }));
    expect(up.every((r) => (r.propHits ?? []).includes('drawbridge'))).toBe(true);
  });

  it('has the knight, the castle and the dragon on the right holes', () => {
    const near = (tag: string, hole: number) => (c.props ?? []).some((p) => p.colliders.some((k) => k.tag === tag && 'c' in k && Math.hypot(k.c[0] - c.holes[hole].pin[0], k.c[1] - c.holes[hole].pin[1]) < 25));
    expect(near('knight', 2)).toBe(true);
    expect(near('castle', 4)).toBe(true);
    expect(near('dragon', 8)).toBe(true);
  });
});

describe('Pirate’s Cove', () => {
  const c = load('pirate');
  const grid = gridOf(c);
  const H = c.holes;

  it('off the islands is the sea: water, out past the map edge too', () => {
    expect(c.sea).toBe(true);
    expect(grid.classAt(c.bounds[0][0] + 1, c.bounds[0][1] + 1)).toBe('water');
    expect(grid.classAt(c.bounds[0][0] - 500, 0)).toBe('water');
    expect(c.toasts?.water).toMatch(/\+1/);
  });

  it('Cannon Cove: a throw that falls short of the far shore goes overboard, +1, and plays from the near shore', () => {
    const h = H[1];
    const mid: Vec2 = [(h.tee[0] + h.pin[0]) / 2, (h.tee[1] + h.pin[1]) / 2];
    expect(grid.classAt(mid[0], mid[1])).toBe('water');
    const aim = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]);
    const short = throwAt(c, worldOf(c, h.pin), { start: h.tee, aim, disc: PT, power: 0.55 });
    expect(short.events).toContain('water');
    expect(short.penalty).toBe(1);
    expect(grid.classAt(short.rest[0], short.rest[1])).not.toBe('water');
    expect(Math.hypot(short.rest[0] - h.tee[0], short.rest[1] - h.tee[1])).toBeLessThan(Math.hypot(mid[0] - h.tee[0], mid[1] - h.tee[1]));
  });

  it('Ghost Ship: its colliders sail across the fairway with it', () => {
    const ship = (c.props ?? []).find((p) => p.model.includes('ship-ghost'))!;
    const k = ship.colliders[0];
    expect(k.kind).toBe('slide');
    if (k.kind !== 'slide') return;
    expect(Math.hypot(...k.slide.amp)).toBeGreaterThan(15);
    expect(ship.motion?.kind).toBe('slide');
  });
});

describe('Graveyard Shift', () => {
  const c = load('graveyard');
  const H = c.holes;
  const tags = (id: string) => (c.props ?? []).flatMap((p) => p.colliders).filter((k) => k.tag === id);

  it('always night', () => {
    expect(c.weather).toBe('night');
  });

  it('Cemetery Gates: a flat throw down the middle goes through the open gate; one wide of it hits the fence', () => {
    const h = H[0];
    const aim = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]);
    const w = worldOf(c, h.pin);
    const through = throwAt(c, w, { start: h.tee, aim, disc: PT, power: 0.9, launch: 0.05 });
    expect(through.propHits ?? []).not.toContain('fence');
    const wide = throwAt(c, w, { start: h.tee, aim: aim + 0.25, disc: PT, power: 0.9, launch: 0.05 }); // ~8 m wide at the fence
    expect(wide.propHits ?? []).toContain('fence');
  });

  it('the ghost and the zombies walk across their fairways (their colliders move with them)', () => {
    for (const [tag, n] of [['ghost', 1], ['zombie', 3]] as const) {
      const ks = tags(tag);
      expect(ks).toHaveLength(n);
      for (const k of ks) {
        expect(k.kind).toBe('slide');
        if (k.kind === 'slide') expect(Math.hypot(...k.slide.amp)).toBeGreaterThan(7);
      }
    }
  });

  it("the Vampire's Lair: a fence all round the basket but for a gate toward the tee", () => {
    const h = H[8];
    const toTee = Math.atan2(h.tee[1] - h.pin[1], h.tee[0] - h.pin[0]);
    const panelAt = (a: number) => tags('fence').some((k) => k.kind === 'box' && Math.abs(Math.hypot(k.c[0] - h.pin[0], k.c[1] - h.pin[1]) - 9) < 1.5
      && Math.abs(Math.atan2(Math.sin(Math.atan2(k.c[1] - h.pin[1], k.c[0] - h.pin[0]) - a), Math.cos(Math.atan2(k.c[1] - h.pin[1], k.c[0] - h.pin[0]) - a))) < 0.2);
    expect(panelAt(toTee)).toBe(false);
    expect(panelAt(toTee + Math.PI)).toBe(true);
    expect(panelAt(toTee + Math.PI / 2)).toBe(true);
  });
});

describe('Oak Grove (OpenStreetMap, Stockton CA)', () => {
  const c = load('oak-grove');
  const grid = gridOf(c);
  it('has 18 holes with tees and baskets in play, and its mapped trees', () => {
    expect(c.holes).toHaveLength(18);
    expect(c.holes.map((h) => h.ref)).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1)));
    for (const h of c.holes) for (const p of [h.tee, h.pin]) expect(['oob', 'water']).not.toContain(grid.classAt(p[0], p[1]));
    expect(decodeTrees(c.trees).length).toBeGreaterThan(500);
    expect(c.source.attribution.join(' ')).toMatch(/OpenStreetMap/);
  });
});

describe('Běchovice (OpenStreetMap, Prague)', () => {
  const c = load('bechovice');
  const grid = gridOf(c);
  it('has the 18 gold-tee holes with their OSM pars, tees and baskets in play, and trees from its woods', () => {
    expect(c.holes).toHaveLength(18);
    expect(c.holes.map((h) => h.ref)).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1)));
    expect(c.holes.every((h) => h.par_source === 'osm')).toBe(true);
    for (const h of c.holes) for (const p of [h.tee, h.pin]) expect(['oob', 'water']).not.toContain(grid.classAt(p[0], p[1]));
    expect(decodeTrees(c.trees).length).toBeGreaterThan(5000);
    expect(c.tree_models).toEqual({ broadleaf: ['Oak', 'CommonTree', 'Birch'], conifer: ['Pine'] });
  });
});

describe('more real courses from OpenStreetMap', () => {
  const cases: { file: string; refs: string[]; trees: number; broadleaf: string[] }[] = [
    { file: 'skatas', refs: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '14b', '15', '15b', '16', '17', '18'], trees: 2000, broadleaf: ['Birch', 'Oak'] },
    // The main 18 only: a second set of short lines shares its numbers; hole 4 is mapped without one.
    { file: 'kincaid', refs: Array.from({ length: 18 }, (_, i) => String(i + 1)), trees: 5000, broadleaf: ['Birch'] },
    // The PRO layout only, not the AM course beside it.
    { file: 'julkujarvi', refs: Array.from({ length: 18 }, (_, i) => String(i + 1)), trees: 5000, broadleaf: ['Birch'] },
    // OSM has no hole 8.
    { file: 'prater', refs: Array.from({ length: 18 }, (_, i) => String(i + 1)), trees: 5000, broadleaf: ['Oak', 'CommonTree'] },
    { file: 'blue-lake', refs: ['1', '2', '3', '4', '5', '6', '7', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18'], trees: 1000, broadleaf: ['Oak', 'CommonTree'] },
  ];
  for (const k of cases) {
    it(`${k.file}: its holes in order, tees and baskets in play, trees and tree models`, () => {
      const c = load(k.file);
      const grid = gridOf(c);
      expect(c.holes.map((h) => h.ref)).toEqual(k.refs);
      for (const h of c.holes) for (const p of [h.tee, h.pin]) expect(['oob', 'water'], `${k.file} #${h.ref}`).not.toContain(grid.classAt(p[0], p[1]));
      expect(decodeTrees(c.trees).length).toBeGreaterThan(k.trees);
      expect(c.tree_models?.broadleaf).toEqual(k.broadleaf);
    });
  }
});

describe('menu course summary', () => {
  it('public/courses/summary.json matches the course files (rerun npm run course-summary after rebuilding one)', async () => {
    const { COURSE_FILES, summarize } = await import('../scripts/course-summary');
    const summary = JSON.parse(readFileSync('public/courses/summary.json', 'utf8'));
    for (const [id, f] of Object.entries(COURSE_FILES)) expect(summary[id], id).toEqual(summarize(load(f)));
  });
});
