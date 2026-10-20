// Shared helpers for the hand-designed themed courses (scripts/build-*-course.ts): model bounds,
// hole geometry, ground strips, and a prop/tree collector with its own seeded RNG.
import { readFileSync } from 'node:fs';
import type { DiscHole, PropDef, Tree } from '../src/course/disc-types';
import { dist, polylineLength, type Vec2 } from '../src/course/geo';
import type { Rings } from '../src/course/types';
import { parFromLength } from '../src/course/disc-build';

// ---------- model sizes, read from the GLBs (Y-up, meters at scale 1) ----------
/**
 * Mesh bounds including node translations. (Nature Kit models sit under a parent shifted down
 * 0.05; ignoring that made their colliders 0.05 × scale too tall.)
 */
export function bbox(model: string): { min: number[]; max: number[] } {
  const b = readFileSync(`public/models/${model}`);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const visit = (ni: number, off: number[]) => {
    const n = j.nodes[ni];
    const t = n.translation ?? [0, 0, 0];
    const o = [off[0] + t[0], off[1] + t[1], off[2] + t[2]];
    if (n.mesh !== undefined) for (const pr of j.meshes[n.mesh].primitives) {
      const a = j.accessors[pr.attributes.POSITION];
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], a.min[i] + o[i]); max[i] = Math.max(max[i], a.max[i] + o[i]); }
    }
    for (const c of n.children ?? []) visit(c, o);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) visit(r, [0, 0, 0]);
  return { min, max };
}

// ---------- holes ----------
export type HoleSpec = { name: string; tee: Vec2; via?: Vec2[]; pin: Vec2; par?: number };

export function makeHoles(spec: HoleSpec[]): DiscHole[] {
  return spec.map((h, i) => {
    const routing: Vec2[] = [h.tee, ...(h.via ?? []), h.pin];
    const L = polylineLength(routing);
    return { ref: String(i + 1), name: h.name, par: h.par ?? parFromLength(L), par_source: 'length', tee: h.tee, pin: h.pin, routing, length_m: L, warnings: [] };
  });
}

/** Point at fraction f of the hole line, offset `lateral` m to the left. */
export function along(h: DiscHole, f: number, lateral = 0): Vec2 {
  let s = f * h.length_m;
  for (let i = 1; i < h.routing.length; i++) {
    const [a, b] = [h.routing[i - 1], h.routing[i]];
    const L = dist(a, b);
    if (s <= L || i === h.routing.length - 1) {
      const t = Math.min(1, s / L), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      return [a[0] + (b[0] - a[0]) * t - uy * lateral, a[1] + (b[1] - a[1]) * t + ux * lateral];
    }
    s -= L;
  }
  return h.pin;
}

/** Direction of routing segment i. */
export const heading = (h: DiscHole, i = 0) => { const [a, b] = [h.routing[i], h.routing[i + 1]]; return Math.atan2(b[1] - a[1], b[0] - a[0]); };
/** Direction of the routing segment at fraction f of the hole. */
export function headingAt(h: DiscHole, f: number): number {
  const a = along(h, Math.max(0, f - 0.01)), b = along(h, Math.min(1, f + 0.01));
  return Math.atan2(b[1] - a[1], b[0] - a[0]);
}
/** Yaw that points a model's local forward (model −Z) along direction `dir`. */
export const facing = (dir: number) => dir - Math.PI / 2;
/** Yaw that points a character's face (model +Z: KayKit, Quaternius) along direction `dir`. */
export const faceToward = (dir: number) => dir + Math.PI / 2;

// ---------- ground ----------
/** Segment rectangles plus round joints, `half` m either side of the polyline. */
export function strip(pts: Vec2[], half: number): Rings[] {
  const out: Rings[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]; const L = dist(a, b) || 1;
    const nx = (-(b[1] - a[1]) / L) * half, ny = ((b[0] - a[0]) / L) * half;
    out.push([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]]);
  }
  for (const p of pts) out.push([Array.from({ length: 20 }, (_, i): Vec2 => [p[0] + half * Math.cos((i / 20) * Math.PI * 2), p[1] + half * Math.sin((i / 20) * Math.PI * 2)])]);
  return out;
}

export const circle = (c: Vec2, r: number, n = 40): Vec2[] => Array.from({ length: n }, (_, i): Vec2 => [c[0] + r * Math.cos((i / n) * Math.PI * 2), c[1] + r * Math.sin((i / n) * Math.PI * 2)]);

/** Rectangle centered at c, rotated by `a`, half sizes hu (along a) × hv. */
export function rect(c: Vec2, a: number, hu: number, hv: number): Vec2[] {
  const u: Vec2 = [Math.cos(a), Math.sin(a)], v: Vec2 = [-u[1], u[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]): Vec2 => [c[0] + u[0] * su * hu + v[0] * sv * hv, c[1] + u[1] * su * hu + v[1] * sv * hv]);
}

/** Tee mat polygon for a hole. */
export function teeMat(h: DiscHole): Vec2[] {
  const a = heading(h); const u: Vec2 = [Math.cos(a), Math.sin(a)], v: Vec2 = [-u[1], u[0]];
  const c = (su: number, sv: number): Vec2 => [h.tee[0] + u[0] * su + v[0] * sv, h.tee[1] + u[1] * su + v[1] * sv];
  return [c(-1.5, -1), c(2.5, -1), c(2.5, 1), c(-1.5, 1)];
}

/** JSON with numbers rounded to mm (lat/lon kept). */
export const courseJson = (course: unknown) => JSON.stringify(course, (k, v) => (typeof v === 'number' && k !== 'lat' && k !== 'lon' ? Math.round(v * 1000) / 1000 : v));

// ---------- props and trees ----------
export function propKit(seed: number) {
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const R = (a: number, b: number) => a + rng() * (b - a);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const props: PropDef[] = [];
  const trees: Tree[] = [];

  /** Cylinder collider sized from the model's footprint (fraction `fit` of the half-width). */
  function solid(model: string, at: Vec2, scale: number, o: { yaw?: number; anim?: string; hit?: string; tag?: string; fit?: number; lift?: number } = {}): PropDef {
    const { min, max } = bbox(model);
    const r = (Math.max(max[0] - min[0], max[2] - min[2]) / 2) * scale * (o.fit ?? 0.8);
    const lift = o.lift ?? 0;
    const p: PropDef = {
      model, at, yaw: o.yaw ?? R(0, Math.PI * 2), scale, anim: o.anim, hit: o.hit,
      colliders: [{ kind: 'cyl', c: at, r, z0: lift + min[1] * scale, z1: lift + max[1] * scale, tag: o.tag ?? model }],
    };
    if (o.lift) p.lift = o.lift;
    props.push(p);
    return p;
  }

  function decor(model: string, at: Vec2, scale: number, yaw = R(0, Math.PI * 2), extra: Partial<PropDef> = {}): PropDef {
    const p: PropDef = { model, at, yaw, scale, colliders: [], ...extra };
    props.push(p);
    return p;
  }

  /** A model tree: rendered as the model, collides as a Tree (trunk + crown ellipsoid). */
  function tree(model: string, at: Vec2, scale: number, o: { crown?: number; base?: number } = {}): void {
    const { min, max } = bbox(model);
    const h = (max[1] - min[1]) * scale;
    const r = (Math.max(max[0] - min[0], max[2] - min[2]) / 2) * scale * 0.9;
    const palm = model.includes('palm');
    trees.push({ x: at[0], y: at[1], h, r: r * (o.crown ?? 1), b: h * (o.base ?? (palm ? 0.7 : 0.3)), t: 0.06 * scale });
    props.push({ model, at, yaw: R(0, Math.PI * 2), scale, colliders: [], tree: trees.length - 1 });
  }

  return { rng, R, pick, props, trees, solid, decor, tree };
}
