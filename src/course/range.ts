// The driving range: a long mowed lane on open grass, built in code (no course file). Distance
// lines cross it every 50 ft out to 800 ft, the 100s wider and longer; the signs and painted
// numbers are drawn by src/render/rangeMarkers.ts. One "hole" so the round machinery has a tee.
import type { Vec2 } from './geo';
import type { DiscCourseFile, Tree } from './disc-types';
import type { Rings } from './types';

export const FT = 0.3048;
/** Distance lines, feet from the tee. */
export const RANGE_MARKS = Array.from({ length: 16 }, (_, i) => (i + 1) * 50);
/** Every 100 ft gets a big sign and a wide line. */
export const isMajor = (ft: number) => ft % 100 === 0;
/** Mowed lane half-width (m). The range throws up +y from the tee at the origin. */
export const LANE_HALF = 18;
const FAR = RANGE_MARKS[RANGE_MARKS.length - 1] * FT;
const BOUNDS: [Vec2, Vec2] = [[-170, -50], [170, FAR + 60]];

/** Baskets on a fresh range: 150 ft down the middle, 250 ft right, 350 ft left. */
export const DEFAULT_BASKETS: Vec2[] = [[0, 150 * FT], [9, 250 * FT], [-12, 350 * FT]];

const rect = (x0: number, y0: number, x1: number, y1: number): Rings => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];

export function rangeCourse(): DiscCourseFile {
  const [min, max] = BOUNDS;
  const lines = (major: boolean): Rings[] => RANGE_MARKS.filter((ft) => isMajor(ft) === major).map((ft) => {
    const y = ft * FT, half = major ? 0.3 : 0.15, w = major ? LANE_HALF + 6 : LANE_HALF;
    return rect(-w, y - half, w, y + half);
  });
  return {
    sport: 'disc',
    name: 'Driving Range',
    style: 'vector',
    branch_density: 1,
    source: { osm_timestamp: 'n/a (built in code)', course_osm_id: 'none', attribution: [] },
    origin: { lat: 0, lon: 0 },
    imagery_offset_m: [0, 0],
    bounds: BOUNDS,
    boundary: [rect(min[0], min[1], max[0], max[1])],
    features: [
      { class: 'fairway', osm_id: 'range/lane', rings: rect(-LANE_HALF, -8, LANE_HALF, FAR + 25) },
      { class: 'tee', osm_id: 'range/tee', rings: rect(-1.5, -1, 1.5, 1) },
    ],
    decals: [{ color: '#f4f2e8', rings: lines(false) }, { color: '#ffffff', rings: lines(true) }],
    canopy: [],
    ob: [],
    trees: [],
    holes: [{
      ref: 'R', name: 'Driving Range', par: 3, par_source: 'length',
      tee: [0, 0], pin: DEFAULT_BASKETS[0], routing: [[0, 0], [0, FAR]], length_m: FAR, warnings: [],
    }],
  };
}

/** A tree for the range, a little different each time: `rnd` is 0…1. */
export function rangeTree(at: Vec2, rnd: () => number): Tree {
  const h = 7 + rnd() * 6;
  return { x: at[0], y: at[1], h, r: 2 + rnd() * 1.4, b: 1.2 + rnd() * 1.8, t: 0.06 + 0.012 * h };
}
