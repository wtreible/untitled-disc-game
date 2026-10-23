import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dist, distToPolyline, type Vec2 } from '../src/course/geo';
import { decodeTrees, type DiscCourseFile, type Tree } from '../src/course/disc-types';
import { compareRefs, parFromLength, RECREATION, selectHoles, simplify } from '../src/course/disc-build';
import type { Rings } from '../src/course/types';
import { DISCS, PUTTER_DISC, suggestDisc } from '../src/disc/discs';
import { BASKET, simulateThrow, type DiscWorld, type ThrowInput } from '../src/disc/flight';
import { TreeIndex } from '../src/disc/trees';
import { mulberry32 } from '../src/game/physics';
import { Round } from '../src/game/round';
import { SurfaceGrid } from '../src/game/surfaces';
import { FlatTerrain } from '../src/game/terrain';

const sq = (n: number): Rings => [[[-n, -n], [n, -n], [n, n], [-n, n]]];
const rect = (x0: number, y0: number, x1: number, y1: number): Rings => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
const NORTH = Math.PI / 2;
const disc = (id: string) => DISCS.find((d) => d.id === id)!;

function world(trees: Tree[] = [], basket: Vec2 = [0, 500], extra: { water?: Rings[]; ob?: Rings[] } = {}): DiscWorld {
  const grid = SurfaceGrid.fromHole({
    bounds: [[-200, -200], [200, 200]], boundary: [sq(150)], trees: [],
    features: (extra.water ?? []).map((rings, i) => ({ class: 'water' as const, osm_id: `w${i}`, rings })), ob: extra.ob,
  }, 0.5);
  return { grid, terrain: new FlatTerrain(), trees: new TreeIndex(trees), basket };
}

const throwN = (input: ThrowInput) => simulateThrow(input, world(), () => 0.25, { ghost: true });

describe('disc flight calibration', () => {
  it('full-power flat throws land in the tuned ranges, longest disc farthest', () => {
    const d = Object.fromEntries(DISCS.map((k) => [k.id, throwN({ start: [0, -140], aim: NORTH, power: 1, disc: k, hyzer: 0 }).rest[1] + 140]));
    expect(d.DD).toBeGreaterThan(95); expect(d.DD).toBeLessThan(115);
    expect(d.FD).toBeGreaterThan(75); expect(d.FD).toBeLessThan(95);
    expect(d.MR).toBeGreaterThan(60); expect(d.MR).toBeLessThan(80);
    expect(d.PT).toBeGreaterThan(48); expect(d.PT).toBeLessThan(65);
    expect(d.DD).toBeGreaterThan(d.FD);
    expect(d.FD).toBeGreaterThan(d.MR);
    expect(d.MR).toBeGreaterThan(d.PT);
  });

  it('specialty discs: the overstable driver fades hard left, the turnover fairway curves right, the approach is short', () => {
    const fly = (id: string) => throwN({ start: [0, -140], aim: NORTH, power: 1, disc: disc(id), hyzer: 0 }).rest;
    const [od, tf, ap, dd, fd] = ['OD', 'TF', 'AP', 'DD', 'FD'].map(fly);
    const range = (r: Vec2) => Math.hypot(r[0], r[1] + 140);
    expect(range(od)).toBeGreaterThan(82); expect(range(od)).toBeLessThan(98);
    expect(range(tf)).toBeGreaterThan(76); expect(range(tf)).toBeLessThan(92);
    expect(range(ap)).toBeGreaterThan(45); expect(range(ap)).toBeLessThan(58);
    expect(od[0]).toBeLessThan(dd[0] - 15); // much more fade than the distance driver
    expect(tf[0]).toBeGreaterThan(fd[0] + 6); // more turn than the fairway driver
  });

  it('every disc\'s meter curve rises (more power, more distance), and suggestions stick to the everyday four', () => {
    for (const d of DISCS) for (let i = 1; i < d.curve.length; i++) expect(d.curve[i]).toBeGreaterThan(d.curve[i - 1]);
    const ranges = Object.fromEntries(DISCS.map((k) => [k.id, throwN({ start: [0, -140], aim: NORTH, power: 1, disc: k, hyzer: 0 }).rest[1] + 140]));
    const picked = new Set([25, 40, 55, 70, 85, 100, 130].map((d) => suggestDisc(d, ranges).id));
    for (const id of picked) expect(['DD', 'FD', 'MR', 'PT']).toContain(id);
    expect(DISCS).toHaveLength(7);
  });

  it('power meter is roughly linear in distance', () => {
    const full = throwN({ start: [0, -140], aim: NORTH, power: 1, disc: disc('MR'), hyzer: 0 }).rest[1] + 140;
    const half = throwN({ start: [0, -140], aim: NORTH, power: 0.5, disc: disc('MR'), hyzer: 0 }).rest[1] + 140;
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.62);
  });

  it('RHBH: a flat understable driver turns right then fades back; hyzer goes left, anhyzer right', () => {
    const flat = throwN({ start: [0, -140], aim: NORTH, power: 1, disc: disc('DD'), hyzer: 0 });
    const maxRight = Math.max(...flat.samples.map((s) => s[0]));
    expect(maxRight).toBeGreaterThan(3);
    expect(flat.rest[0]).toBeLessThan(maxRight - 3); // fade back left at the end
    const hy = throwN({ start: [0, -140], aim: NORTH, power: 1, disc: disc('MR'), hyzer: 1 });
    const an = throwN({ start: [0, -140], aim: NORTH, power: 1, disc: disc('MR'), hyzer: -1 });
    expect(hy.rest[0]).toBeLessThan(-5);
    expect(an.rest[0]).toBeGreaterThan(5);
    const lh = throwN({ start: [0, -140], aim: NORTH, power: 1, disc: disc('MR'), hyzer: 1, mirror: true });
    expect(lh.rest[0]).toBeCloseTo(-hy.rest[0], 0);
  });

  it('a full putt reaches ~30–40 m and stays low', () => {
    const r = throwN({ start: [0, -140], aim: NORTH, power: 1, disc: PUTTER_DISC, hyzer: 0, style: 'putt' });
    expect(r.rest[1] + 140).toBeGreaterThan(28);
    expect(r.rest[1] + 140).toBeLessThan(42);
    expect(Math.max(...r.samples.map((s) => s[2]))).toBeLessThan(2);
  });
});

describe('tree collisions', () => {
  const tree = (x: number, y: number, o: Partial<Tree> = {}): Tree => ({ x, y, h: 15, r: 2.5, b: 2, t: 0.3, ...o });

  it('a trunk dead ahead stops the disc short of it', () => {
    // A row of bare trunks (no crown: crown base above the top) across the fairway at y = 20.
    const trees = Array.from({ length: 41 }, (_, i) => tree(-10 + i * 0.5, 20, { r: 0.01, b: 14.9, h: 15 }));
    const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: disc('MR'), hyzer: 0 }, world(trees), mulberry32(3));
    expect(r.events).toContain('trunk');
    expect(r.rest[1]).toBeLessThan(25);
  });

  it('dense canopy usually knocks the disc down; open air never does', () => {
    // A 30 m-deep wood of crowns spanning the flight height.
    const wood: Tree[] = [];
    for (let x = -20; x <= 20; x += 4) for (let y = 15; y <= 45; y += 4) wood.push(tree(x, y, { t: 0.01, b: 0.2, h: 12, r: 2.3 }));
    let stopped = 0;
    for (let s = 1; s <= 30; s++) {
      const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: disc('FD'), hyzer: 0 }, world(wood), mulberry32(s));
      if (r.events.includes('branch') && r.rest[1] < 50) stopped++;
    }
    expect(stopped).toBeGreaterThan(24);
    const clear = simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: disc('FD'), hyzer: 0 }, world([]), mulberry32(1));
    expect(clear.events).toEqual([]);
  });

  it('a disc thrown over a short tree clears it', () => {
    const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: disc('DD'), hyzer: 0, launch: 0.2 }, world([tree(0, 40, { h: 3, b: 0.3, r: 1.5 })]), mulberry32(2));
    expect(r.events).not.toContain('branch');
    expect(r.events).not.toContain('trunk');
  });
});

describe('basket', () => {
  // Basket 6 m north. A "firm" putt is one that would come to rest ~5 m past the basket if it missed.
  const B: Vec2 = [0, 6];
  const ghostRest = (power: number, launch: number) =>
    simulateThrow({ start: [0, 0], aim: NORTH, power, disc: PUTTER_DISC, hyzer: 0, style: 'putt', launch }, world([], [0, 999]), () => 0.25, { ghost: true }).rest[1];
  const firmPower = (launch = 0.12) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (ghostRest(m, launch) < 11) lo = m; else hi = m; }
    return lo;
  };
  const P = firmPower();
  const putt = (offsetX: number, seed: number, launch = 0.12, power = P) =>
    simulateThrow({ start: [offsetX, 0], aim: NORTH, power, disc: PUTTER_DISC, hyzer: 0, style: 'putt', launch }, world([], B), mulberry32(seed));

  it('the firm putt passes the basket at chain height', () => {
    const r = simulateThrow({ start: [0, 0], aim: NORTH, power: P, disc: PUTTER_DISC, hyzer: 0, style: 'putt', launch: 0.12 }, world([], [0, 999]), () => 0.25, { ghost: true });
    const at = r.samples.find((s) => s[1] >= 6)!;
    expect(at[2]).toBeGreaterThan(BASKET.trayTop);
    expect(at[2]).toBeLessThan(BASKET.chainTop);
  });

  it('a firm, centered 6 m putt goes in most of the time', () => {
    let made = 0;
    for (let s = 1; s <= 40; s++) if (putt(0, s).holed) made++;
    expect(made).toBeGreaterThan(28);
  });

  it('a putt lined up just past the edge of the chains mostly misses (cut, spit, band or tray)', () => {
    let made = 0, edge = 0;
    for (let s = 1; s <= 40; s++) {
      const r = putt(0.5, s);
      if (r.holed) made++;
      if (r.events.some((e) => e === 'cut' || e === 'spit' || e === 'band' || e === 'tray')) edge++;
    }
    expect(made).toBeLessThan(12);
    expect(edge).toBeGreaterThan(0); // some clip the basket; the rest miss clean
  });

  it('is forgiving: a putt 30 cm off center still goes in more often than not', () => {
    let made = 0;
    for (let s = 1; s <= 40; s++) if (putt(0.3, s).holed) made++;
    expect(made).toBeGreaterThan(22);
  });

  it('a low putt into the cage bounces off once and ends away from the basket (no sticking)', () => {
    // Launch ~0: arrives at tray height. Regression: it used to register hundreds of tray hits,
    // freeze against the cage and slide down it.
    for (let s = 1; s <= 8; s++) {
      const r = putt(0, s, 0.0, 0.5);
      if (!r.events.includes('tray')) continue;
      expect(r.events.filter((e) => e === 'tray').length).toBe(1);
      expect(r.holed).toBe(false);
      expect(Math.hypot(r.rest[0] - B[0], r.rest[1] - B[1])).toBeGreaterThan(BASKET.trayR + 0.1);
    }
    expect([...Array(8).keys()].some((k) => putt(0, k + 1, 0.0, 0.5).events.includes('tray'))).toBe(true);
  });

  it('a disc dropping straight down inside the tray footprint lands in the basket', () => {
    // Released right above the tray, slow: e.g. a spit-out falling back in.
    const r = simulateThrow({ start: [0, 5.85], aim: NORTH, power: 0.0005, disc: PUTTER_DISC, hyzer: 0, style: 'drive', releaseZ: 1.0 }, world([], B), mulberry32(1));
    expect(r.holed).toBe(true);
  });

  it('spit-outs are rare: soft chain hits mostly rattle in', () => {
    let spit = 0, n = 0;
    for (const off of [0, 0.15, 0.3]) for (let sd = 1; sd <= 40; sd++) {
      n++;
      if (putt(off, sd).events.includes('spit')) spit++;
    }
    expect(spit / n).toBeLessThan(0.06);
  });

  it('a putt a meter wide never goes in', () => {
    for (let s = 1; s <= 20; s++) expect(putt(1.0, s).holed).toBe(false);
  });

  it('a lofted putt can only score through the chains, never through the lid', () => {
    for (let s = 1; s <= 10; s++) {
      const r = putt(0, s, 0.35);
      if (r.holed) expect(r.events).toContain('chains');
    }
  });

  it('a putt from inside a meter is a tap-in', () => {
    const r = simulateThrow({ start: [0.3, 5.5], aim: NORTH, power: 0.05, disc: PUTTER_DISC, hyzer: 0, style: 'putt' }, world([], B), mulberry32(1));
    expect(r.holed).toBe(true);
  });

  it('holed discs end in the tray at the basket', () => {
    const r = [...Array(40).keys()].map((s) => putt(0, s + 1)).find((x) => x.holed)!;
    expect(r.rest).toEqual(B);
    const last = r.samples[r.samples.length - 1];
    expect(Math.hypot(last[0] - B[0], last[1] - B[1])).toBeLessThan(BASKET.trayR);
    expect(last[2]).toBeLessThan(BASKET.trayTop);
  });
});

describe('OB and water', () => {
  it('landing in water: +1, play from where it crossed in', () => {
    const w = world([], [0, 500], { water: [rect(-50, 30, 50, 200)] });
    const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: disc('MR'), hyzer: 0 }, w, mulberry32(1));
    expect(r.events).toContain('water');
    expect(r.penalty).toBe(1);
    expect(r.rest[1]).toBeLessThan(30);
    expect(r.rest[1]).toBeGreaterThan(25);
  });

  it('a road (forced OB inside the boundary) is OB', () => {
    const w = world([], [0, 500], { ob: [rect(-50, 50, 50, 200)] });
    const r = simulateThrow({ start: [0, 0], aim: NORTH, power: 1, disc: disc('MR'), hyzer: 0 }, w, mulberry32(1));
    expect(r.events).toContain('oob');
    expect(r.penalty).toBe(1);
  });
});

describe('Round', () => {
  it('records scores and gives honors to the lowest score on the last hole', () => {
    const holes = [{ tee: [0, 0] as Vec2, pin: [0, 50] as Vec2, par: 3 }, { tee: [0, 0] as Vec2, pin: [0, 60] as Vec2, par: 3 }];
    const r = new Round(holes, ['A', 'B']);
    const hole = (strokes: number) => ({ samples: [], rest: [0, 50] as Vec2, restSurface: 'green' as const, holed: strokes === 1, penalty: strokes - 1, events: [] });
    // A: 4 strokes (1 throw with 3 penalties), B: 2 (1 throw + 1 penalty)... simulate with applyShot.
    r.game.applyShot({ ...hole(1), holed: false, penalty: 3 }); // A → 4
    r.game.applyShot({ ...hole(1), holed: true, penalty: 1 }); // B holed in 2
    r.game.applyShot(hole(1)); // A holes → 5
    expect(r.game.finished).toBe(true);
    expect(r.nextHole()).toBe(true);
    expect(r.scores[0][0]).toBe(5);
    expect(r.scores[1][0]).toBe(2);
    expect(r.game.player.name).toBe('B'); // honors
    expect(r.toPar(1)).toBe(-1);
  });
});

describe('Tali course file', () => {
  const c: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali.json', 'utf8'));
  const trees = decodeTrees(c.trees);
  const grid = SurfaceGrid.fromHole({ bounds: c.bounds, boundary: c.boundary, trees: c.canopy.map((k, i) => ({ osm_id: `c${i}`, rings: k.rings, height_m: k.height_m })), features: c.features, ob: c.ob }, 0.5);

  it('has 18 holes in order with sane lengths and pars', () => {
    expect(c.holes.map((h) => h.ref)).toEqual(Array.from({ length: 18 }, (_, i) => String(i + 1)));
    for (const h of c.holes) {
      expect(h.length_m).toBeGreaterThan(30);
      expect(h.length_m).toBeLessThan(300);
      expect(h.par).toBe(h.par_source === 'osm' ? h.par : parFromLength(h.length_m));
    }
  });

  it('every tee and basket is in bounds, and no trunk stands on a tee or basket', () => {
    for (const h of c.holes) {
      for (const p of [h.tee, h.pin]) {
        expect(['oob', 'water']).not.toContain(grid.classAt(p[0], p[1]));
        for (const t of trees) expect(Math.hypot(t.x - p[0], t.y - p[1])).toBeGreaterThan(t.t + 0.5);
      }
    }
  });

  it('keeps a trunk-free lane along every hole line; crowns over it are limbed up', () => {
    for (const h of c.holes) {
      for (const t of trees) {
        const d = distToPolyline([t.x, t.y], h.routing);
        expect(d).toBeGreaterThan(2.9);
        if (d < t.r - 0.01) expect(t.b).toBeGreaterThanOrEqual(Math.min(3.5, t.h - 1) - 0.01);
      }
    }
  });

  it('has a forest worth of trees with heights from the canopy classes', () => {
    expect(trees.length).toBeGreaterThan(2000);
    for (const t of trees.slice(0, 500)) {
      expect(t.h).toBeGreaterThanOrEqual(2);
      expect(t.h).toBeLessThanOrEqual(27);
      expect(t.b).toBeLessThan(t.h);
    }
  });

  it('keeps full precision on the origin', () => {
    expect(String(c.origin.lat).split('.')[1].length).toBeGreaterThan(5);
  });
});

describe('hole selection', () => {
  type F = Parameters<typeof selectHoles>[0][number];
  const line = (id: number, ref: string | undefined, pts: [number, number][]): F => ({ type: 'Feature', id: `way/${id}`, properties: { disc_golf: 'hole', ref }, geometry: { type: 'LineString', coordinates: pts } });
  const point = (kind: string, p: [number, number]): F => ({ type: 'Feature', id: `node/${kind}${p}`, properties: { disc_golf: kind }, geometry: { type: 'Point', coordinates: p } });
  // A course area 0.01° square near the equator (about 1.1 km).
  const area: F = { type: 'Feature', id: 'way/1', properties: { leisure: 'disc_golf_course' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]] } };

  it('orders hole numbers naturally, an alternate after its hole', () => {
    expect(['15', '14b', '2', '14', '15b', '10', '1'].sort(compareRefs)).toEqual(['1', '2', '10', '14', '14b', '15', '15b']);
  });

  it("a course way keeps the holes inside it, not a neighboring layout's", () => {
    const feats = [area, line(2, '1', [[0.001, 0.001], [0.002, 0.002]]), line(3, '1', [[0.02, 0.02], [0.021, 0.021]]), line(4, '2', [[0.003, 0.003], [0.004, 0.004]])];
    expect(selectHoles(feats, area, {}).map((f) => f.id)).toEqual(['way/2', 'way/4']);
  });

  it('two lines with one number: the one with its tee and basket mapped wins, then the longer', () => {
    const long = line(2, '3', [[0.001, 0.001], [0.001, 0.003]]), short = line(3, '3', [[0.005, 0.005], [0.005, 0.0055]]);
    expect(selectHoles([area, long, short], area, {}).map((f) => f.id)).toEqual(['way/2']);
    const feats = [area, long, short, point('tee', [0.005, 0.005]), point('basket', [0.005, 0.0055])];
    expect(selectHoles(feats, area, {}).map((f) => f.id)).toEqual(['way/3']);
  });

  it("a relation's members only, and a hole number given for a line mapped without one", () => {
    const feats = [line(2, '1', [[0.001, 0.001], [0.002, 0.002]]), line(3, undefined, [[0.003, 0.003], [0.004, 0.004]]), line(4, '1', [[0.005, 0.005], [0.006, 0.006]])];
    const got = selectHoles(feats, undefined, { holeIds: ['way/2', 'way/3'], holeRefs: { 'way/3': '2' } });
    expect(got.map((f) => [f.id, f.properties.ref])).toEqual([['way/2', '1'], ['way/3', '2']]);
  });
});

describe('simplify', () => {
  it('drops staircase vertices within tolerance', () => {
    const stairs: Vec2[] = [];
    for (let i = 0; i < 40; i++) stairs.push([i * 0.5, Math.floor(i / 2) * 0.5]);
    stairs.push([20, 0], [0, 0]);
    expect(simplify(stairs, 0.6).length).toBeLessThan(10);
  });
});

describe('Tali Recreation (the easy version)', () => {
  const c: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali-simple.json', 'utf8'));
  const forest: DiscCourseFile = JSON.parse(readFileSync('public/courses/tali.json', 'utf8'));
  const trees = decodeTrees(c.trees);
  const real = decodeTrees(forest.trees);

  it('is the vector style with real trees: a subset of the real (forest) version', () => {
    expect(c.style).toBe('vector');
    expect(c.canopy).toEqual([]);
    expect(trees.length).toBeGreaterThan(1000);
    expect(trees.length).toBeLessThan(real.length);
    const key = (t: Tree) => `${t.x.toFixed(2)},${t.y.toFixed(2)}`;
    const realKeys = new Set(real.map(key));
    expect(trees.every((t) => realKeys.has(key(t)))).toBe(true);
  });

  it('keeps every crown a few meters back from fairways, greens and tees', () => {
    const { fairwayHalf, greenR, clear } = RECREATION;
    for (const t of trees) for (const h of c.holes) {
      // (Positions are rounded to cm in the file.)
      expect(distToPolyline([t.x, t.y], h.routing) - t.r).toBeGreaterThan(fairwayHalf + clear - 0.02);
      expect(dist([t.x, t.y], h.pin) - t.r).toBeGreaterThan(greenR + clear - 0.02);
      expect(dist([t.x, t.y], h.tee) - t.r).toBeGreaterThan(clear + 2 - 0.02);
    }
  });
});
