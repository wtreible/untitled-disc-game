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

// ---------- colliders from model geometry ----------
/** Triangles of a GLB in model units (node translations applied; the kits use no rotation/scale). */
export function triangles(model: string): [number, number, number][][] {
  const b = readFileSync(`public/models/${model}`);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const bin = 20 + len + 8; // the BIN chunk's data starts after its 8-byte header
  const read = (ai: number): number[] => {
    const a = j.accessors[ai], v = j.bufferViews[a.bufferView];
    const n = a.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[a.type];
    const off = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(a.componentType === 5126 ? b.readFloatLE(off + i * 4) : a.componentType === 5125 ? b.readUInt32LE(off + i * 4) : b.readUInt16LE(off + i * 2));
    }
    return out;
  };
  const tris: [number, number, number][][] = [];
  const visit = (ni: number, o: number[]) => {
    const n = j.nodes[ni];
    const t = n.translation ?? [0, 0, 0];
    const at = [o[0] + t[0], o[1] + t[1], o[2] + t[2]];
    if (n.mesh !== undefined) for (const pr of j.meshes[n.mesh].primitives) {
      const pos = read(pr.attributes.POSITION);
      const idx = read(pr.indices);
      const P = (k: number): [number, number, number] => [pos[k * 3] + at[0], pos[k * 3 + 1] + at[1], pos[k * 3 + 2] + at[2]];
      for (let i = 0; i + 2 < idx.length; i += 3) tris.push([P(idx[i]), P(idx[i + 1]), P(idx[i + 2])]);
    }
    for (const c of n.children ?? []) visit(c, at);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) visit(r, [0, 0, 0]);
  return tris;
}

/**
 * Boxes that follow a model's front outline (its X–Y silhouette, Y up), for shapes with holes you
 * throw through. The silhouette is rasterized at `cell` units and cut into horizontal bands; each
 * solid run in a band becomes a box as deep as the geometry in it. A column counts as solid in a
 * band only if most of the band's rows are, so boxes never reach into the hole by more than half a
 * band. Model units, relative to `center` (x, ·, z).
 */
export function silhouetteBoxes(model: string, center: [number, number, number], band = 0.04, cell = 0.005): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] {
  const tris = triangles(model).map((t) => t.map(([x, y, z]) => [x - center[0], y, z - center[2]] as [number, number, number]));
  const xs = tris.flat().map((p) => p[0]), ys = tris.flat().map((p) => p[1]);
  const [xMin, xMax, yMin, yMax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const nx = Math.ceil((xMax - xMin) / cell), ny = Math.ceil((yMax - yMin) / cell);
  const solid = new Uint8Array(nx * ny);
  const depth = Array.from({ length: ny }, () => [Infinity, -Infinity]);
  for (const [a, b, c] of tris) {
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-12) continue; // edge-on to the front view
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - xMin) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - xMin) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - yMin) / cell)), k1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - yMin) / cell));
    for (let k = k0; k <= k1; k++) {
      const y = yMin + (k + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = xMin + (i + 0.5) * cell;
        const w0 = (b[0] - x) * (c[1] - y) - (c[0] - x) * (b[1] - y);
        const w1 = (c[0] - x) * (a[1] - y) - (a[0] - x) * (c[1] - y);
        const w2 = (a[0] - x) * (b[1] - y) - (b[0] - x) * (a[1] - y);
        if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) {
          solid[k * nx + i] = 1;
          depth[k][0] = Math.min(depth[k][0], a[2], b[2], c[2]);
          depth[k][1] = Math.max(depth[k][1], a[2], b[2], c[2]);
        }
      }
    }
  }
  const out: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] = [];
  const rowsPer = Math.max(1, Math.round(band / cell));
  for (let k0 = 0; k0 < ny; k0 += rowsPer) {
    const k1 = Math.min(ny, k0 + rowsPer);
    const zs = depth.slice(k0, k1).filter((d) => d[0] <= d[1]);
    if (zs.length === 0) continue;
    const z0 = Math.min(...zs.map((d) => d[0])), z1 = Math.max(...zs.map((d) => d[1]));
    let run = -1;
    for (let i = 0; i <= nx; i++) {
      let n = 0;
      if (i < nx) for (let k = k0; k < k1; k++) n += solid[k * nx + i];
      const on = i < nx && n * 2 > k1 - k0;
      if (on && run < 0) run = i;
      if (!on && run >= 0) {
        out.push({ x0: xMin + run * cell, x1: xMin + i * cell, y0: yMin + k0 * cell, y1: yMin + k1 * cell, z0, z1 });
        run = -1;
      }
    }
  }
  return out;
}
