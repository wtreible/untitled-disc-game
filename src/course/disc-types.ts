import type { LatLon, Vec2 } from './geo';
import type { CourseFeature, Rings } from './types';
import type { Collider } from '../disc/props';

export interface DiscHole {
  ref: string;
  /** Themed hole name (hand-designed courses). */
  name?: string;
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

/** A decorative/obstacle 3D model on a themed course (docs/12-mini-golf-madness.md). */
export interface PropDef {
  /** Path under /models, e.g. "minigolf/structure-windmill.glb". */
  model: string;
  at: Vec2;
  /** Rotation about the vertical axis; local forward (model −Z) points at angle yaw + π/2. */
  yaw: number;
  scale: number;
  /** Animation clip to loop (Kenney animals: idle, eat, dance, walk…). */
  anim?: string;
  /** Spin a named node about its local Z axis using the matching blades collider's clock. */
  spin?: { node: string; omega: number; phase: number };
  /** Physics colliders in world space (see src/disc/props.ts). */
  colliders: Collider[];
  /** Index into the course's trees when this model *is* a tree (collision uses the tree model). */
  tree?: number;
  /** Toast shown when hit. */
  hit?: string;
  /** Raise the model this far off the ground (balls centered on their origin, a lion on a rock). */
  lift?: number;
}

export interface DiscCourseFile {
  sport: 'disc';
  /** Themed props and models; their colliders join the physics. */
  props?: PropDef[];
  /** Ground colors overriding the vector defaults (keys of VECTOR_COLORS). */
  palette?: Record<string, string>;
  sky?: string;
  /** 'photo': satellite imagery + dense canopy trees. 'vector': flat drawn course, few trees. */
  style?: 'photo' | 'vector';
  /** Branch hits per meter inside a crown. A forest needs it low; lone feature trees are fully leafy. */
  branch_density?: number;
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
