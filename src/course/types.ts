import type { LatLon, Vec2 } from './geo';

// Surface classes, docs/04-course-model.md. Listed lowest priority first:
// where polygons overlap, the later class in this list wins.
export const SURFACE_CLASSES = ['oob', 'rough', 'trees', 'path', 'fairway', 'tee', 'green', 'bunker', 'water'] as const;
export type SurfaceClass = (typeof SURFACE_CLASSES)[number];

export function surfacePriority(c: SurfaceClass): number {
  return SURFACE_CLASSES.indexOf(c);
}

/** One polygon: outer ring first, then holes. Local meters. */
export type Rings = Vec2[][];

export interface CourseFeature {
  class: Exclude<SurfaceClass, 'oob' | 'trees'>;
  osm_id: string;
  rings: Rings;
}

export interface TreeFeature {
  osm_id: string;
  rings: Rings;
  height_m: number;
}

export interface CourseHole {
  ref: string;
  par: number;
  tee: Vec2;
  pin: Vec2;
  routing: Vec2[];
  length_m: number;
  features: CourseFeature[];
  trees: TreeFeature[];
  /** Course boundary polygons; everything outside is out of bounds. */
  boundary: Rings[];
  /** Local-frame bounds of everything the hole needs: [[minX, minY], [maxX, maxY]]. */
  bounds: [Vec2, Vec2];
}

export interface CourseFile {
  name: string;
  links?: string;
  source: { osm_timestamp: string; course_osm_id: string; attribution: string };
  /** Local frame origin (green centroid of the first hole). */
  origin: LatLon;
  /** Manual photo-vs-polygon alignment nudge, meters (applied to imagery). */
  imagery_offset_m: Vec2;
  holes: CourseHole[];
}
