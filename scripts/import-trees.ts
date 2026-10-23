// Import birches and spruces from Quaternius' Textured LowPoly Trees (CC0, May 2020:
// https://opengameart.org/content/lowpoly-textured-trees) into public/models/qtrees as .gltf + .bin,
// named and textured like the MegaKit trees there so `npm run tree-shapes` can measure them.
// The pack's OBJ materials carry no texture maps; they're assigned here by material name.
// Textures are copied as they are (512 px, birch bark 768 px).
//
//   npm run import-trees -- --src "<unzipped pack>/Textured Stylized Trees - May 2020"
//   npm run tree-shapes
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Document, NodeIO } from '@gltf-transform/core';

const { values: args } = parseArgs({ options: { src: { type: 'string' } } });
if (!args.src) throw new Error('--src <unzipped pack folder> is required');
const SRC = args.src;
const OUT = 'public/models/qtrees';

/** Pack model → our name, and its materials → our material name and texture file. */
const MODELS: { from: string; to: string }[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ from: `Birch_${i}`, to: `Birch_${i}` })),
  // The pack's "pines" are spruce-shaped: a narrow cone of drooping tiers.
  ...[1, 2, 3, 4, 5].map((i) => ({ from: `Pine_${i}`, to: `Spruce_${i}` })),
];
const MATERIALS: Record<string, { name: string; tex: string; src: string }> = {
  Birch_Bark: { name: 'Bark_Birch', tex: 'Bark_Birch.png', src: 'Textures/Birch_Bark.png' },
  Birch_Leaves: { name: 'Leaves_Birch', tex: 'Leaves_Birch_C.png', src: 'Textures/Birch_Leaves_Green.png' },
  Bark: { name: 'Bark_Spruce', tex: 'Bark_Spruce.jpg', src: 'Textures/Tree_Bark.jpg' },
  Pine_Leaves: { name: 'Leaves_Spruce', tex: 'Leaves_Spruce_C.png', src: 'Textures/Pine_Leaves.png' },
};

/** Triangles per material as flat position / normal / uv arrays, one vertex per OBJ v/vt/vn triple. */
function readObj(path: string) {
  const v: number[][] = [], vt: number[][] = [], vn: number[][] = [];
  const out = new Map<string, { pos: number[]; nrm: number[]; uv: number[]; idx: number[]; seen: Map<string, number> }>();
  let cur: ReturnType<typeof out.get> | undefined;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const [op, ...a] = line.trim().split(/\s+/);
    if (op === 'v') v.push(a.map(Number));
    else if (op === 'vt') vt.push(a.map(Number));
    else if (op === 'vn') vn.push(a.map(Number));
    else if (op === 'usemtl') {
      if (!out.has(a[0])) out.set(a[0], { pos: [], nrm: [], uv: [], idx: [], seen: new Map() });
      cur = out.get(a[0]);
    } else if (op === 'f') {
      if (!cur) throw new Error(`${path}: face before usemtl`);
      const m = cur;
      const ids = a.map((corner) => {
        const hit = m.seen.get(corner);
        if (hit !== undefined) return hit;
        const [pi, ti, ni] = corner.split('/').map((s) => (s ? parseInt(s, 10) - 1 : -1));
        const id = m.pos.length / 3;
        m.pos.push(...v[pi]);
        m.nrm.push(...(ni >= 0 ? vn[ni] : [0, 1, 0]));
        // OBJ v runs up the image, glTF v down it.
        m.uv.push(ti >= 0 ? vt[ti][0] : 0, ti >= 0 ? 1 - vt[ti][1] : 0);
        m.seen.set(corner, id);
        return id;
      });
      for (let k = 1; k + 1 < ids.length; k++) m.idx.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  return out;
}

const textures = new Map<string, Uint8Array>();
for (const m of Object.values(MATERIALS)) textures.set(m.tex, new Uint8Array(readFileSync(`${SRC}/${m.src}`)));

const io = new NodeIO();
for (const { from, to } of MODELS) {
  const doc = new Document();
  const buffer = doc.createBuffer().setURI(`${to}.bin`);
  const mesh = doc.createMesh(to);
  let verts = 0;
  for (const [mtl, g] of readObj(`${SRC}/OBJ/${from}.obj`)) {
    const def = MATERIALS[mtl];
    if (!def) throw new Error(`${from}: unknown material ${mtl}`);
    const tex = doc.createTexture(def.tex.replace(/\.\w+$/, '')).setURI(def.tex).setMimeType(def.tex.endsWith('.jpg') ? 'image/jpeg' : 'image/png').setImage(textures.get(def.tex)!);
    // Leaf cards are cut out by their alpha and seen from both sides, like the MegaKit's.
    const mat = doc.createMaterial(def.name).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(1)
      .setDoubleSided(true).setAlphaMode('MASK').setAlphaCutoff(0.2);
    const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', arr: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buffer);
    mesh.addPrimitive(doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc('VEC3', new Float32Array(g.pos)))
      .setAttribute('NORMAL', acc('VEC3', new Float32Array(g.nrm)))
      .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.uv)))
      .setIndices(acc('SCALAR', new Uint32Array(g.idx))));
    verts += g.pos.length / 3;
  }
  doc.createScene().addChild(doc.createNode(to).setMesh(mesh));
  await io.write(`${OUT}/${to}.gltf`, doc);
  console.log(`${from} → ${OUT}/${to}.gltf (${verts} vertices)`);
}
