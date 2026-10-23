// Collision shapes for the branched tree models (Quaternius Stylized Nature MegaKit, CC0, plus
// birches, spruces and oaks from his Textured LowPoly Trees via `npm run import-trees`), measured
// from their geometry: the trunk as stacked cylinder slices up to where it forks, and the leaf
// clumps ("green regions") as a filled voxel grid. Writes src/disc/treeShapes.data.ts.
//
//   npm run tree-shapes
import { readFileSync, writeFileSync } from 'node:fs';

const DIR = 'public/models/qtrees';
const KINDS = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'Pine_1', 'Pine_2', 'Pine_3', 'Pine_4', 'Pine_5',
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `Birch_${i}`), ...[1, 2, 3, 4, 5].map((i) => `Spruce_${i}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `Oak_${i}`)];
/** Voxel size (model meters; the models are 7–9.5 m tall). */
const CELL = 0.3;
/** Trunk slice height. */
const SLICE = 0.4;

type V3 = [number, number, number];

/** Triangles per material name, from a .gltf with an external .bin (no node transforms: checked). */
function load(name: string): Map<string, V3[][]> {
  const j = JSON.parse(readFileSync(`${DIR}/${name}.gltf`, 'utf8'));
  const bin = readFileSync(`${DIR}/${j.buffers[0].uri}`);
  for (const n of j.nodes) if (n.translation || n.rotation || n.scale || n.matrix) throw new Error(`${name}: node transform not handled`);
  const read = (ai: number): number[] => {
    const a = j.accessors[ai], v = j.bufferViews[a.bufferView];
    const comps = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : 2;
    const stride = v.byteStride ?? comps * size;
    const out: number[] = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < comps; c++) {
      const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + i * stride + c * size;
      out.push(a.componentType === 5126 ? bin.readFloatLE(off) : a.componentType === 5125 ? bin.readUInt32LE(off) : bin.readUInt16LE(off));
    }
    return out;
  };
  const out = new Map<string, V3[][]>();
  for (const m of j.meshes) for (const pr of m.primitives) {
    const pos = read(pr.attributes.POSITION), idx = read(pr.indices);
    const P = (k: number): V3 => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
    const mat = j.materials[pr.material].name as string;
    const list = out.get(mat) ?? [];
    for (let i = 0; i + 2 < idx.length; i += 3) list.push([P(idx[i]), P(idx[i + 1]), P(idx[i + 2])]);
    out.set(mat, list);
  }
  return out;
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

/**
 * The imported birches, spruces and oaks are low-poly: a trunk segment has vertices only at its ends, often
 * meters apart, so their slices are traced from points along the bark's edges too.
 */
const SPARSE = /^(Birch|Spruce|Oak)_/;

function edgePoints(tris: V3[][]): V3[] {
  const out: V3[] = [];
  for (const t of tris) for (let e = 0; e < 3; e++) {
    const a = t[e], b = t[(e + 1) % 3];
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (SLICE / 4));
    for (let k = 0; k < steps; k++) out.push([0, 1, 2].map((q) => a[q] + ((b[q] - a[q]) * k) / steps) as V3);
  }
  return out;
}

function trunk(bark: V3[][], sparse = false): { x: number; z: number; y0: number; y1: number; r: number }[] {
  const verts = sparse ? edgePoints(bark) : bark.flat();
  const base = verts.filter((v) => v[1] < SLICE);
  let cx = base.reduce((a, v) => a + v[0], 0) / base.length, cz = base.reduce((a, v) => a + v[2], 0) / base.length;
  let r = pct(base.map((v) => Math.hypot(v[0] - cx, v[2] - cz)), 0.8);
  const out: { x: number; z: number; y0: number; y1: number; r: number }[] = [];
  const top = Math.max(...verts.map((v) => v[1]));
  for (let y = 0; y < top; y += SLICE) {
    // Only vertices near the trunk's last axis: side branches start there but leave the window.
    const sl = verts.filter((v) => v[1] >= y && v[1] < y + SLICE && Math.hypot(v[0] - cx, v[2] - cz) < 1.8 * r + 0.08);
    if (sl.length < 6) break;
    const nx = sl.reduce((a, v) => a + v[0], 0) / sl.length, nz = sl.reduce((a, v) => a + v[2], 0) / sl.length;
    const nr = pct(sl.map((v) => Math.hypot(v[0] - nx, v[2] - nz)), 0.7);
    if (nr > 1.6 * r || nr < 0.03) break; // forked into branches (or thinned to twigs)
    out.push({ x: nx, z: nz, y0: y, y1: y + SLICE, r: nr });
    cx = nx; cz = nz; r = nr;
  }
  return out;
}

/** Leaf volume: rasterize the leaf triangles, close small gaps, fill clump interiors, open back. */
function greenVoxels(leaves: V3[][]) {
  const vs = leaves.flat();
  const min: V3 = [0, 1, 2].map((i) => Math.min(...vs.map((v) => v[i])) - 2 * CELL) as V3;
  const max: V3 = [0, 1, 2].map((i) => Math.max(...vs.map((v) => v[i])) + 2 * CELL) as V3;
  const n: V3 = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / CELL)) as V3;
  const id = (i: number, j: number, k: number) => (j * n[2] + k) * n[0] + i;
  const inGrid = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2];
  let g = new Uint8Array(n[0] * n[1] * n[2]);
  for (const [a, b, c] of leaves) {
    const steps = Math.ceil(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2])) / (CELL / 3)) + 1;
    for (let u = 0; u <= steps; u++) for (let v = 0; v <= steps - u; v++) {
      const s = u / steps, t = v / steps;
      const p = [0, 1, 2].map((q) => a[q] + (b[q] - a[q]) * s + (c[q] - a[q]) * t);
      const [i, j, k] = [0, 1, 2].map((q) => Math.floor((p[q] - min[q]) / CELL));
      if (inGrid(i, j, k)) g[id(i, j, k)] = 1;
    }
  }
  const morph = (src: Uint8Array, grow: boolean) => {
    const out = new Uint8Array(src.length);
    for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (let i = 0; i < n[0]; i++) {
      let any = false, all = true;
      for (const [di, dj, dk] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const [a, b, c] = [i + di, j + dj, k + dk];
        const on = inGrid(a, b, c) && src[id(a, b, c)] === 1;
        any ||= on; all &&= on;
      }
      out[id(i, j, k)] = (grow ? any : all) ? 1 : 0;
    }
    return out;
  };
  g = morph(g, true); // close the gaps between leaf cards
  // Fill: everything not reachable from the grid's border without crossing leaves is inside a clump.
  const outside = new Uint8Array(g.length);
  const queue: number[] = [];
  for (let j = 0; j < n[1]; j++) for (let k = 0; k < n[2]; k++) for (let i = 0; i < n[0]; i++) {
    if ((i === 0 || j === 0 || k === 0 || i === n[0] - 1 || j === n[1] - 1 || k === n[2] - 1) && !g[id(i, j, k)]) { outside[id(i, j, k)] = 1; queue.push(id(i, j, k)); }
  }
  while (queue.length) {
    const c = queue.pop()!;
    const i = c % n[0], k = Math.floor(c / n[0]) % n[2], j = Math.floor(c / (n[0] * n[2]));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const [a, b, cc] = [i + di, j + dj, k + dk];
      if (!inGrid(a, b, cc)) continue;
      const q = id(a, b, cc);
      if (!g[q] && !outside[q]) { outside[q] = 1; queue.push(q); }
    }
  }
  for (let q = 0; q < g.length; q++) if (!outside[q]) g[q] = 1;
  g = morph(g, false); // undo the closing's growth at the surface
  return { min, n, cells: g };
}

const kinds = KINDS.map((name) => {
  const mats = load(name);
  const bark = [...mats].filter(([m]) => m.startsWith('Bark')).flatMap(([, t]) => t);
  const leaves = [...mats].filter(([m]) => m.startsWith('Leaves') || m.startsWith('Leaf')).flatMap(([, t]) => t);
  const tr = trunk(bark, SPARSE.test(name));
  const all = [...bark, ...leaves].flat();
  const H = Math.max(...all.map((v) => v[1]));
  const ax = tr[0].x, az = tr[0].z;
  const vox = greenVoxels(leaves);
  // Crown radius: the farthest green cell from the trunk base, so a course tree's r bounds its
  // leaves (and the tree index's search radius still covers every contact).
  let R = 0;
  for (let j = 0; j < vox.n[1]; j++) for (let k = 0; k < vox.n[2]; k++) for (let i = 0; i < vox.n[0]; i++) {
    if (vox.cells[(j * vox.n[2] + k) * vox.n[0] + i]) R = Math.max(R, Math.hypot(vox.min[0] + (i + 1) * CELL - ax, vox.min[2] + (k + 1) * CELL - az));
  }
  const solid = vox.cells.reduce((a, c) => a + c, 0);
  const green = solid * CELL ** 3;
  // The crown it replaces: an ellipsoid of radius R from 0.16 H (Tali's typical crown base) to H.
  const ellipsoid = (4 / 3) * Math.PI * R * R * ((H - 0.16 * H) / 2);
  return {
    name, H, R, axis: [ax, az] as [number, number],
    trunk: tr.map((s) => ({ ...s, x: +s.x.toFixed(3), z: +s.z.toFixed(3), r: +s.r.toFixed(3) })),
    vox: { min: vox.min.map((v) => +v.toFixed(3)), n: vox.n, cell: CELL, bits: Buffer.from(pack(vox.cells)).toString('base64') },
    ratio: green / ellipsoid,
    forkAt: tr.length ? tr[tr.length - 1].y1 : 0,
  };
});

function pack(cells: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(cells.length / 8));
  cells.forEach((c, i) => { if (c) out[i >> 3] |= 1 << (i & 7); });
  return out;
}

for (const k of kinds) console.log(`${k.name.padEnd(13)} H ${k.H.toFixed(2)} R ${k.R.toFixed(2)} trunk r ${k.trunk[0].r.toFixed(2)} to ${k.forkAt.toFixed(1)} m (${(k.forkAt / k.H * 100).toFixed(0)}%), green/old crown ${(k.ratio * 100).toFixed(0)}%`);
const mean = kinds.reduce((a, k) => a + k.ratio, 0) / kinds.length;
console.log(`mean green/old crown volume: ${(mean * 100).toFixed(0)}%`);

writeFileSync('src/disc/treeShapes.data.ts', `// Generated by scripts/build-tree-shapes.ts from public/models/qtrees (npm run tree-shapes). Do not edit.
export const TREE_KINDS = ${JSON.stringify(kinds.map(({ ratio: _r, forkAt: _f, ...k }) => k))};
/** Leaf (green) volume as a fraction of the crown ellipsoid it replaces, averaged over the kinds. */
export const GREEN_VOLUME_RATIO = ${mean.toFixed(3)};
`);
