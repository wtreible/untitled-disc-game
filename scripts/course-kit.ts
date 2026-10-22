// Shared helpers for the hand-designed themed courses (scripts/build-*-course.ts): model bounds,
// hole geometry, ground strips, and a prop/tree collector with its own seeded RNG.
import { readFileSync } from 'node:fs';
import type { DiscHole, PropDef, Tree } from '../src/course/disc-types';
import { dist, polylineLength, type Vec2 } from '../src/course/geo';
import type { Rings } from '../src/course/types';
import type { Collider } from '../src/disc/props';
import { parFromLength } from '../src/course/disc-build';

// ---------- model sizes, read from the GLBs (Y-up, meters at scale 1) ----------
/**
 * Mesh bounds including node translations. (Nature Kit models sit under a parent shifted down
 * 0.05; ignoring that made their colliders 0.05 × scale too tall.)
 */
export function bbox(model: string): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of triangles(model)) for (const v of t) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], v[i]); max[i] = Math.max(max[i], v[i]); }
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
  /**
   * A model that collides as its shape (shapeColliders). `round`: a cylinder instead, `fit` of the
   * footprint (for round things where a cylinder is the better match, like the giant golf balls).
   */
  function solid(model: string, at: Vec2, scale: number, o: { yaw?: number; anim?: string; hit?: string; tag?: string; fit?: number; lift?: number; round?: boolean; offset?: [number, number, number] } = {}): PropDef {
    const lift = o.lift ?? 0;
    const yaw = o.yaw ?? R(0, Math.PI * 2);
    let colliders: Collider[];
    if (o.round) {
      const { min, max } = bbox(model);
      const r = (Math.max(max[0] - min[0], max[2] - min[2]) / 2) * scale * (o.fit ?? 0.8);
      colliders = [{ kind: 'cyl', c: at, r, z0: lift + min[1] * scale, z1: lift + max[1] * scale, tag: o.tag ?? model }];
    } else colliders = shapeColliders(model, at, yaw, scale, { lift, tag: o.tag, offset: o.offset });
    const p: PropDef = { model, at, yaw, scale, anim: o.anim, hit: o.hit, colliders };
    if (o.offset) p.offset = o.offset;
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
/** Column-major 4×4 matrices, as glTF stores them. */
type M4 = number[];
const I4: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function trs(t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]): M4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

/**
 * Triangles of a GLB in model units, with every node's transform applied (translation, rotation,
 * scale or matrix). Skinned meshes are taken in their bind pose.
 */
export function triangles(model: string): [number, number, number][][] {
  const b = readFileSync(`public/models/${model}`);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
  const bin = 20 + len + 8; // the BIN chunk's data starts after its 8-byte header
  const SIZE: Record<number, number> = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 };
  const COMPS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const read = (ai: number): number[] => {
    const a = j.accessors[ai], v = j.bufferViews[a.bufferView];
    const comps = COMPS[a.type], size = SIZE[a.componentType];
    const stride = v.byteStride ?? comps * size;
    const base = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const out: number[] = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
      const off = base + i * stride + c * size;
      out.push(a.componentType === 5126 ? b.readFloatLE(off) : a.componentType === 5125 ? b.readUInt32LE(off) : a.componentType === 5123 ? b.readUInt16LE(off) : b.readUInt8(off));
    }
    return out;
  };
  const tris: [number, number, number][][] = [];
  const visit = (ni: number, parent: M4) => {
    const n = j.nodes[ni];
    const m = mul(parent, n.matrix ?? trs(n.translation, n.rotation, n.scale));
    if (n.mesh !== undefined) for (const pr of j.meshes[n.mesh].primitives) {
      if (pr.mode !== undefined && pr.mode !== 4) continue; // triangles only
      const pos = read(pr.attributes.POSITION);
      const idx = pr.indices !== undefined ? read(pr.indices) : Array.from({ length: pos.length / 3 }, (_, k) => k);
      const P = (k: number): [number, number, number] => {
        const [x, y, z] = [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
        return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
      };
      for (let i = 0; i + 2 < idx.length; i += 3) tris.push([P(idx[i]), P(idx[i + 1]), P(idx[i + 2])]);
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  for (const r of j.scenes[j.scene ?? 0].nodes) visit(r, I4);
  return tris;
}

/**
 * Boxes that follow a model's front outline (its X–Y silhouette, Y up), for shapes with holes you
 * throw through. The silhouette is rasterized at `cell` units and cut into horizontal bands; each
 * solid run in a band becomes a box as deep as the geometry in it. A column counts as solid in a
 * band only if most of the band's rows are, so boxes never reach into the hole by more than half a
 * band. Bands stacked with the same run and depth are merged into one taller box. Model units,
 * relative to `center` (x, ·, z).
 *
 * Bands were 0.04 units until 2026-10-21: on the hex ring's slanted sides (0.6 m bands at scale 15)
 * a disc hitting the ring had a median 0.2 m and up to 0.9 m of air between it and the frame.
 */
export function silhouetteBoxes(model: string, center: [number, number, number], band = 0.01, cell = 0.0025): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] {
  const tris = triangles(model).map((t) => t.map(([x, y, z]) => [x - center[0], y, z - center[2]] as [number, number, number]));
  const xs = tris.flat().map((p) => p[0]), ys = tris.flat().map((p) => p[1]);
  const [xMin, xMax, yMin, yMax] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const nx = Math.ceil((xMax - xMin) / cell), ny = Math.ceil((yMax - yMin) / cell);
  const solid = new Uint8Array(nx * ny);
  // Depth (model z) per cell: a box gets the depth of what's inside it, not of the whole band
  // (the ring's thick corner blocks made every box in their band as deep as them).
  const zMin = new Float32Array(nx * ny).fill(Infinity), zMax = new Float32Array(nx * ny).fill(-Infinity);
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
          const q = k * nx + i;
          solid[q] = 1;
          // The triangle's depth at this point (barycentric), not its whole extent.
          const sum = w0 + w1 + w2;
          const z = sum !== 0 ? (w0 * a[2] + w1 * b[2] + w2 * c[2]) / sum : a[2];
          if (z < zMin[q]) zMin[q] = z;
          if (z > zMax[q]) zMax[q] = z;
        }
      }
    }
  }
  const out: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }[] = [];
  const rowsPer = Math.max(1, Math.round(band / cell));
  for (let k0 = 0; k0 < ny; k0 += rowsPer) {
    const k1 = Math.min(ny, k0 + rowsPer);
    // Each column's depth in this band; a run is cut where the depth steps (a bar's thick outer
    // plate and its recessed inner lip get their own boxes).
    const colDepth = (j: number): [number, number] => {
      let z0 = Infinity, z1 = -Infinity;
      for (let k = k0; k < k1; k++) { const q = k * nx + j; if (zMin[q] < z0) z0 = zMin[q]; if (zMax[q] > z1) z1 = zMax[q]; }
      return [z0, z1];
    };
    const DEPTH_STEP = 0.01;
    let run = -1, rz0 = Infinity, rz1 = -Infinity;
    const flush = (end: number) => {
      if (run < 0 || rz0 > rz1) { run = -1; return; }
      const box = { x0: xMin + run * cell, x1: xMin + end * cell, y0: yMin + k0 * cell, y1: yMin + k1 * cell, z0: rz0, z1: rz1 };
      // Same run and depth as a box ending right below: grow that one instead.
      const same = (p: number, q: number) => Math.abs(p - q) < cell * 0.5;
      const below = out.find((o) => same(o.y1, box.y0) && same(o.x0, box.x0) && same(o.x1, box.x1) && same(o.z0, box.z0) && same(o.z1, box.z1));
      if (below) below.y1 = box.y1; else out.push(box);
      run = -1;
    };
    for (let i = 0; i <= nx; i++) {
      let n = 0;
      if (i < nx) for (let k = k0; k < k1; k++) n += solid[k * nx + i];
      const on = i < nx && n * 2 > k1 - k0;
      if (!on) { flush(i); continue; }
      const [c0, c1] = colDepth(i);
      if (run >= 0 && (Math.abs(c0 - rz0) > DEPTH_STEP || Math.abs(c1 - rz1) > DEPTH_STEP)) flush(i);
      if (run < 0) { run = i; rz0 = c0; rz1 = c1; } else { rz0 = Math.min(rz0, c0); rz1 = Math.max(rz1, c1); }
    }
  }
  return out;
}

// ---------- colliders from a model's 3D shape ----------
export type ModelBox = { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };

/**
 * A model's solid shape as a few boxes (model units, Y up): its triangles are rasterized into a
 * voxel grid of `cell`, small gaps between faces closed, hollow interiors filled, then the voxels
 * merged greedily into boxes. Open shapes (a market stall's roof on posts, a trebuchet's frame)
 * stay open, where one cylinder around them made the empty space solid.
 */
export function modelBoxes(model: string, cell: number, offset: [number, number, number] = [0, 0, 0]): ModelBox[] {
  const tris = triangles(model).map((t) => t.map((v) => [v[0] - offset[0], v[1] - offset[1], v[2] - offset[2]]));
  const vs = tris.flat();
  const min = [0, 1, 2].map((i) => Math.min(...vs.map((v) => v[i])) - cell);
  const max = [0, 1, 2].map((i) => Math.max(...vs.map((v) => v[i])) + cell);
  const n = [0, 1, 2].map((i) => Math.max(1, Math.ceil((max[i] - min[i]) / cell)));
  const id = (i: number, j: number, k: number) => (j * n[2] + k) * n[0] + i;
  const inGrid = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2];
  let g = new Uint8Array(n[0] * n[1] * n[2]);
  for (const [a, b, c] of tris) {
    const steps = Math.ceil(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])) / (cell / 3)) + 1;
    for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
      const s = u / steps, t = v / steps;
      const q = [0, 1, 2].map((i) => Math.floor((a[i] + (b[i] - a[i]) * s + (c[i] - a[i]) * t - min[i]) / cell));
      if (inGrid(q[0], q[1], q[2])) g[id(q[0], q[1], q[2])] = 1;
    }
  }
  // Fill: whatever the outside can't reach without crossing a surface is inside the model.
  const outside = new Uint8Array(g.length);
  const queue: number[] = [];
  for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (let i = 0; i < n[0]; i++) {
    if ((i === 0 || j === 0 || k === 0 || i === n[0] - 1 || j === n[1] - 1 || k === n[2] - 1) && !g[id(i, j, k)]) { outside[id(i, j, k)] = 1; queue.push(id(i, j, k)); }
  }
  while (queue.length) {
    const q = queue.pop()!;
    const i = q % n[0], k = Math.floor(q / n[0]) % n[2], j = Math.floor(q / (n[0] * n[2]));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const [a, b, c] = [i + di, j + dj, k + dk];
      if (!inGrid(a, b, c)) continue;
      const r = id(a, b, c);
      if (!g[r] && !outside[r]) { outside[r] = 1; queue.push(r); }
    }
  }
  for (let q = 0; q < g.length; q++) if (!outside[q]) g[q] = 1;
  // Greedy merge: grow each box along x, then z, then y while every voxel is solid and unclaimed.
  const used = new Uint8Array(g.length);
  const free = (i: number, j: number, k: number) => g[id(i, j, k)] === 1 && !used[id(i, j, k)];
  const out: ModelBox[] = [];
  for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (let i = 0; i < n[0]; i++) {
    if (!free(i, j, k)) continue;
    let i1 = i; while (i1 + 1 < n[0] && free(i1 + 1, j, k)) i1++;
    let k1 = k;
    const rowFree = (kk: number, jj: number) => { for (let x = i; x <= i1; x++) if (!free(x, jj, kk)) return false; return true; };
    while (k1 + 1 < n[2] && rowFree(k1 + 1, j)) k1++;
    let j1 = j;
    const layerFree = (jj: number) => { for (let z = k; z <= k1; z++) if (!rowFree(z, jj)) return false; return true; };
    while (j1 + 1 < n[1] && layerFree(j1 + 1)) j1++;
    for (let y = j; y <= j1; y++) for (let z = k; z <= k1; z++) for (let x = i; x <= i1; x++) used[id(x, y, z)] = 1;
    out.push({ x0: min[0] + i * cell, x1: min[0] + (i1 + 1) * cell, y0: min[1] + j * cell, y1: min[1] + (j1 + 1) * cell, z0: min[2] + k * cell, z1: min[2] + (k1 + 1) * cell });
  }
  return out;
}

/**
 * A prop's colliders from its shape: model boxes placed as src/render/props.ts draws the model
 * (recentered by `offset`, scaled, model X along yaw, model −Z along yaw + 90°, raised by lift).
 * About 0.2 m voxels in the world (thin beams stay thin); coarser if a model would need more than ~150 boxes.
 */
export function shapeColliders(model: string, at: Vec2, yaw: number, scale: number, o: { offset?: [number, number, number]; lift?: number; tag?: string } = {}): Collider[] {
  let cell = 0.2 / scale, boxes = modelBoxes(model, cell, o.offset);
  while (boxes.length > 150 && cell < 2 / scale) { cell *= 1.4; boxes = modelBoxes(model, cell, o.offset); }
  const cs = Math.cos(yaw), sn = Math.sin(yaw), lift = o.lift ?? 0;
  return boxes.map((b) => {
    const mx = ((b.x0 + b.x1) / 2) * scale, mz = ((b.z0 + b.z1) / 2) * scale;
    const lx = mx, ly = -mz; // local: model x → +x, model z → −y
    return {
      kind: 'box' as const, c: [at[0] + lx * cs - ly * sn, at[1] + lx * sn + ly * cs] as Vec2, yaw,
      hx: ((b.x1 - b.x0) / 2) * scale, hy: ((b.z1 - b.z0) / 2) * scale,
      z0: Math.max(0, b.y0 * scale + lift), z1: b.y1 * scale + lift, tag: o.tag ?? model,
    };
  }).filter((k) => k.z1 > 0);
}
