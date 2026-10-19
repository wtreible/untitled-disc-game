import type { LatLon, Vec2 } from './geo';
import type { CourseFeature, Rings } from './types';

export interface DiscHole {
  ref: string;
  par: number;
  /** 'osm' when tagged; 'length' when estimated from hole length (docs/08). */
  par_source: 'osm' | 'length';
  tee: Vec2;
  /** Basket position. Named `pin` so the shared turn/score logic works for both sports. */
  pin: Vec2;
  routing: Vec2[];
  length_m: number;
  /** Data problems found while building (missing tee/basket node, etc.). */
  warnings: string[];
}

/** One tree, in local meters. Collision model: trunk cylinder + crown ellipsoid (docs/08). */
export interface Tree {
  x: number;
  y: number;
  /** Total height. */
  h: number;
  /** Crown radius. */
  r: number;
  /** Height of the lowest branches (crown bottom). */
  b: number;
  /** Trunk radius. */
  t: number;
}

export interface DiscCourseFile {
  sport: 'disc';
  name: string;
  source: { osm_timestamp: string; course_osm_id: string; attribution: string[] };
  origin: LatLon;
  imagery_offset_m: Vec2;
  bounds: [Vec2, Vec2];
  /** Playable area polygons; outside them is OB. */
  boundary: Rings[];
  /** Water, paths, tee pads. */
  features: CourseFeature[];
  /** Canopy polygons (lie = "trees" under them), with their height-class top. */
  canopy: { rings: Rings; height_m: number }[];
  /** Forced-OB polygons inside the boundary: roads, buildings, the neighboring golf course. */
  ob: Rings[];
  /** Flat [x, y, h, r, b, t, ...] to keep the file small; decode with decodeTrees(). */
  trees: number[];
  holes: DiscHole[];
}

export const TREE_STRIDE = 6;

export function decodeTrees(flat: number[]): Tree[] {
  const out: Tree[] = [];
  for (let i = 0; i + TREE_STRIDE <= flat.length; i += TREE_STRIDE) {
    out.push({ x: flat[i], y: flat[i + 1], h: flat[i + 2], r: flat[i + 3], b: flat[i + 4], t: flat[i + 5] });
  }
  return out;
}

export function encodeTrees(trees: Tree[]): number[] {
  return trees.flatMap((t) => [t.x, t.y, t.h, t.r, t.b, t.t]);
}
