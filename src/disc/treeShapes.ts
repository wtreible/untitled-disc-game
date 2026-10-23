// Course trees drawn as branched models (Quaternius Stylized Nature MegaKit and Textured LowPoly
// Trees, CC0) collide as the
// model does: a solid trunk up to where it forks, and random branch hits only inside the leaf
// clumps (the "green regions"). Shapes are measured by scripts/build-tree-shapes.ts. The model,
// its turn and its scale come from the tree's position and size, so physics and rendering agree.
import type { Tree, TreeMix } from '../course/disc-types';
import { GREEN_VOLUME_RATIO, TREE_KINDS } from './treeShapes.data';

export interface TreeShape {
  kind: number;
  yaw: number;
  /** Horizontal and vertical scale from model meters. */
  sxy: number;
  sz: number;
  /** Trunk slices in world space (z relative to the ground). */
  trunk: { x: number; y: number; z0: number; z1: number; r: number }[];
  /** Is a point (z relative to the ground) inside a leaf clump? */
  green(x: number, y: number, z: number): boolean;
}

/**
 * The leaf clumps hold less volume than the ellipsoid crowns they replace (about 38%), so branch
 * hits per meter inside them are stepped up a little. A disc still meets fewer branches overall.
 */
export const GREEN_DENSITY_BOOST = GREEN_VOLUME_RATIO < 0.75 ? 1.3 : 1;

const KINDS = TREE_KINDS.map((k) => {
  const raw = Uint8Array.from(atob(k.vox.bits), (c) => c.charCodeAt(0));
  return { ...k, bits: raw };
});

/** Courses without their own tree models: the MegaKit's. */
const DEFAULT_MIX: TreeMix = { broadleaf: ['CommonTree'], conifer: ['Pine'] };

const poolCache = new Map<string, { broadleaf: number[]; conifer: number[] }>();
function pools(mix: TreeMix) {
  const key = `${mix.broadleaf.join()}|${mix.conifer.join()}`;
  let p = poolCache.get(key);
  if (!p) {
    const of = (prefixes: string[]) => KINDS.map((k, i) => (prefixes.some((pre) => k.name.startsWith(`${pre}_`)) ? i : -1)).filter((i) => i >= 0);
    p = { broadleaf: of(mix.broadleaf), conifer: of(mix.conifer) };
    if (!p.broadleaf.length || !p.conifer.length) throw new Error(`Tree mix ${key} names no models`);
    poolCache.set(key, p);
  }
  return p;
}

/** Model file names (public/models/qtrees/<name>.gltf), indexed by kind. */
export const TREE_KIND_NAMES = KINDS.map((k) => k.name);

/** Model-space transform pieces for rendering: axis (model x, z of the trunk base) and height. */
export function treeKindInfo(kind: number): { axis: [number, number]; H: number; R: number } {
  const k = KINDS[kind];
  return { axis: [k.axis[0], k.axis[1]], H: k.H, R: k.R };
}

const hash = (x: number, y: number, s: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

const cache = new WeakMap<Tree, TreeShape>();

export function treeShape(t: Tree, mix: TreeMix = DEFAULT_MIX): TreeShape {
  const hit = cache.get(t);
  if (hit) return hit;
  // Low crowns read as conifers: mostly conifer models; the rest mostly broadleaf.
  const conifer = t.b < t.h * 0.25;
  const p = pools(mix);
  const pool = hash(t.x, t.y, 1) < (conifer ? 0.65 : 0.25) ? p.conifer : p.broadleaf;
  const kind = pool[Math.floor(hash(t.x, t.y, 2) * pool.length)];
  const k = KINDS[kind];
  const yaw = hash(t.x, t.y, 3) * Math.PI * 2;
  const sxy = t.r / k.R, sz = t.h / k.H;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  // Model (Y-up) → world (Z-up): model x → +x, model z → −y, then turn by yaw about the trunk base.
  const toWorld = (mx: number, mz: number): [number, number] => {
    const lx = (mx - k.axis[0]) * sxy, ly = -(mz - k.axis[1]) * sxy;
    return [t.x + lx * cs - ly * sn, t.y + lx * sn + ly * cs];
  };
  const trunk = k.trunk.map((s) => { const [x, y] = toWorld(s.x, s.z); return { x, y, z0: s.y0 * sz, z1: s.y1 * sz, r: s.r * sxy }; });
  const { min, n, cell } = k.vox;
  const green = (x: number, y: number, z: number) => {
    const dx = x - t.x, dy = y - t.y;
    const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
    const mx = k.axis[0] + lx / sxy, mz = k.axis[1] - ly / sxy, my = z / sz;
    const i = Math.floor((mx - min[0]) / cell), j = Math.floor((my - min[1]) / cell), kk = Math.floor((mz - min[2]) / cell);
    if (i < 0 || j < 0 || kk < 0 || i >= n[0] || j >= n[1] || kk >= n[2]) return false;
    const q = (j * n[2] + kk) * n[0] + i;
    return (k.bits[q >> 3] & (1 << (q & 7))) !== 0;
  };
  const shape = { kind, yaw, sxy, sz, trunk, green };
  cache.set(t, shape);
  return shape;
}
