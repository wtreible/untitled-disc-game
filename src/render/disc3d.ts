// 3D models for disc golf: basket (to standard dimensions), instanced trees, disc.
import * as THREE from 'three';
import type { Tree, TreeMix } from '../course/disc-types';
import type { Vec2 } from '../course/geo';
import { DISC_RADIUS } from '../disc/discs';
import { BASKET } from '../disc/flight';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { asset } from '../assets';
import { TREE_KIND_NAMES, treeKindInfo, treeShape } from '../disc/treeShapes';

export function basketModel(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: '#b9bec4' });
  const yellow = new THREE.MeshLambertMaterial({ color: '#f2c230' });
  const B = BASKET;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(B.poleR, B.poleR, B.bandTop + 0.05, 10), metal);
  pole.rotation.x = Math.PI / 2;
  pole.position.z = (B.bandTop + 0.05) / 2;
  g.add(pole);

  // Tray: open-topped cylinder wall plus a floor.
  const trayH = B.trayTop - B.trayBottom;
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(B.trayR, B.trayR * 0.92, trayH, 28, 1, true), new THREE.MeshLambertMaterial({ color: '#9aa1a8', side: THREE.DoubleSide }));
  tray.rotation.x = Math.PI / 2;
  tray.position.z = B.trayBottom + trayH / 2;
  g.add(tray);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(B.trayR * 0.92, 28), metal);
  floor.position.z = B.trayBottom + 0.01;
  g.add(floor);
  const trayBand = new THREE.Mesh(new THREE.TorusGeometry(B.trayR, 0.012, 6, 32), yellow);
  trayBand.position.z = B.trayTop;
  g.add(trayBand);

  // Top band and lid.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(B.bandR, B.bandR, B.bandTop - B.chainTop, 28, 1, true), new THREE.MeshLambertMaterial({ color: '#f2c230', side: THREE.DoubleSide }));
  band.rotation.x = Math.PI / 2;
  band.position.z = (B.chainTop + B.bandTop) / 2;
  g.add(band);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(B.bandR, 28), yellow);
  lid.position.z = B.bandTop;
  g.add(lid);

  // Chains: two rings of chains hanging from the band, gathered toward the pole at the bottom.
  const pts: number[] = [];
  const ring = (n: number, rTop: number, rBot: number, twist: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const at = (t: number) => {
          // Sag outward a little mid-chain.
          const r = rTop + (rBot - rTop) * t + Math.sin(Math.PI * t) * 0.02;
          const ang = a + twist * t;
          return [Math.cos(ang) * r, Math.sin(ang) * r, B.chainTop - (B.chainTop - B.trayTop - 0.04) * t];
        };
        pts.push(...at(t0), ...at(t1));
      }
    }
  };
  ring(24, B.chainR, 0.06, 0.25);
  ring(12, B.chainR * 0.55, 0.04, -0.2);
  const chains = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#d7dbe0' }));
  g.add(chains);
  return g;
}

/**
 * Course trees. Branched models (Quaternius, CC0) placed exactly as the physics places them
 * (src/disc/treeShapes.ts), with the old trunk + ellipsoid blobs standing in until the models load
 * and, on big forests, away from the first-person eye (see LOD). A tree switching between the two
 * dissolves over FADE_S (a screen-door dither, so no transparency sorting) instead of popping.
 */
export function treeMeshes(trees: Tree[], mix?: TreeMix): THREE.Group {
  const g = new THREE.Group();
  const n = trees.length;
  const trunkGeo = new THREE.CylinderGeometry(1, 1.2, 1, 7);
  trunkGeo.rotateX(Math.PI / 2);
  trunkGeo.translate(0, 0, 0.5);
  const blobDither = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1);
  trunkGeo.setAttribute('dither', blobDither);
  const trunks = new THREE.InstancedMesh(trunkGeo, dithered(new THREE.MeshLambertMaterial({ color: '#5b4632' })), n);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  crownGeo.setAttribute('dither', blobDither);
  const crowns = new THREE.InstancedMesh(crownGeo, dithered(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true })), n);
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const trunkM: THREE.Matrix4[] = [], crownM: THREE.Matrix4[] = [];
  trees.forEach((t, i) => {
    trunkM.push(new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, 0), q, new THREE.Vector3(t.t, t.t, t.h * 0.9)));
    const hz = Math.max(0.3, (t.h - t.b) / 2);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (t.x * 7.13 + t.y * 3.7) % (Math.PI * 2));
    crownM.push(new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.b + hz), yaw, new THREE.Vector3(t.r, t.r, hz)));
    // Conifers (low crown base) darker, broadleaf lighter; a little per-tree variation.
    const v = ((t.x * 12.9898 + t.y * 78.233) % 1 + 1) % 1;
    const conifer = t.b < t.h * 0.25;
    c.setHSL(conifer ? 0.36 : 0.27 + v * 0.04, 0.45 + v * 0.15, conifer ? 0.16 + v * 0.05 : 0.24 + v * 0.08);
    crowns.setColorAt(i, c);
  });
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  g.add(trunks, crowns);
  const state: TreeState = {
    trees, trunks, crowns, trunkM, crownM, blobDither, visible: () => true, lod: n > LOD_ALL, eye: null, models: null, quality: 'high',
    fade: new Float32Array(n), target: new Uint8Array(n), active: new Set(), last: 0, lock: null,
  };
  g.userData = state;
  refresh(state);
  const placed = trees.map((t) => treeShape(t, mix));
  loadTreeModels(new Set(placed.map((p) => p.kind))).then((kinds) => {
    // One instanced mesh per model part (bark, leaves), sized for every tree of that kind, with
    // its own per-instance dither (the part's vertex data is shared with other groups).
    const count = kinds.map(() => 0);
    for (const p of placed) count[p.kind]++;
    const meshes = kinds.map((parts, k) => parts.map((part) => {
      const cap = Math.max(1, count[k]);
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(part.geo.attributes)) geo.setAttribute(name, attr);
      geo.setIndex(part.geo.index);
      geo.setAttribute('dither', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      const im = new THREE.InstancedMesh(geo, part.mat, cap);
      im.count = 0;
      im.frustumCulled = false; // instances span the course; the base geometry's bounds don't
      g.add(im);
      return im;
    }));
    const matrices = trees.map((t, i) => {
      const sh = placed[i], info = treeKindInfo(sh.kind);
      // Model (Y-up, trunk base at axis) → world: recenter, stand up, scale, turn, place.
      return new THREE.Matrix4().makeTranslation(t.x, t.y, 0)
        .multiply(new THREE.Matrix4().makeRotationZ(sh.yaw))
        .multiply(new THREE.Matrix4().makeScale(sh.sxy, sh.sxy, sh.sz))
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeTranslation(-info.axis[0], 0, -info.axis[1]));
    });
    state.models = { meshes, kindOf: placed.map((p) => p.kind), matrices };
    refresh(state); // the first models fade in too
  }).catch((e) => console.warn('Tree models failed to load; keeping simple trees', e));
  return g;
}

/** Forests bigger than this draw models only near the first-person eye. */
const LOD_ALL = 1500;
/**
 * Big forests by graphics setting: the nearest trees to the eye within this radius, all the way
 * round, at most this many. Not by view direction: looking about would swap trees in and out.
 */
const LOD: Record<TreeQuality, { radius: number; max: number }> = { low: { radius: 0, max: 0 }, medium: { radius: 70, max: 170 }, high: { radius: 100, max: 360 } };
export type TreeQuality = 'low' | 'medium' | 'high';
/** Blob ↔ model dissolve time. */
const FADE_S = 1.1;
/** Re-pick the model trees after the eye moves this far. */
const REPICK_M = 4;
/** Trees already drawn as models stay so until clearly out: farther, or outranked by a good margin. */
const KEEP_RADIUS = 1.15;
const KEEP_BONUS_M = 12;
/**
 * Following a throw, the model set is locked to the trees nearest the flight path, this many times
 * the usual count. In simulation (Tali Forest, Medium) that makes 80–100% of the trees within 25 m
 * of the chase camera models, against 45–69% for the moving eye zone, with no changes mid-flight.
 */
const CORRIDOR_MULT = 1.5;
/**
 * Hole flyovers: every tree within this of the camera's path is a model for the whole flight (at
 * most FLYOVER_MULT times the usual count, nearest first), swapped in at the cut to the flyover.
 * The eye zone's re-picking every few meters at flyover speed was what kept trees popping in.
 */
const FLYOVER_RADIUS: Record<TreeQuality, number> = { low: 0, medium: 45, high: 60 };
const FLYOVER_MULT = 4;

interface TreeState {
  trees: Tree[];
  trunks: THREE.InstancedMesh;
  crowns: THREE.InstancedMesh;
  trunkM: THREE.Matrix4[];
  crownM: THREE.Matrix4[];
  /** Blob visibility per tree (1 − its model fade), shared by trunks and crowns. */
  blobDither: THREE.InstancedBufferAttribute;
  visible: (i: number) => boolean;
  lod: boolean;
  /** First-person eye position, where the model zone was last picked. */
  eye: [number, number] | null;
  models: { meshes: THREE.InstancedMesh[][]; kindOf: number[]; matrices: THREE.Matrix4[] } | null;
  /** Low: no models anywhere. Medium / high: all models on small courses, LOD on big forests. */
  quality: TreeQuality;
  /** Per tree: how far it has dissolved into its model (0 blob … 1 model), and where it's going. */
  fade: Float32Array;
  target: Uint8Array;
  /** Trees that are models or on their way in or out (the only ones per-frame work touches). */
  active: Set<number>;
  /** Last tick time (ms). */
  last: number;
  /** Following a throw or a flyover: the model set is fixed to its path (see lockTreeLod). */
  lock: { path: Vec2[]; flyover: boolean } | null;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Every tree's most-visible dither (1 = solid). Phase Disc's player sees through trees at 0.35. */
const TREE_SOLIDITY = { value: 1 };
export function setTreeSolidity(v: number): void {
  TREE_SOLIDITY.value = v;
}

/**
 * Up close, trees thin out so you can see past them: fully solid from NEAR_FADE[1] m from the
 * camera, down to NEAR_MIN solid at NEAR_FADE[0] m and closer (first person, chase cam). Drawn only.
 */
const NEAR_FADE = [2, 8];
const NEAR_MIN = 0.35;

/** The near fade as GLSL: how solid a fragment `d` m from the camera is. */
const NEAR_GLSL = (d: string) => `mix(${NEAR_MIN.toFixed(2)}, 1.0, smoothstep(${NEAR_FADE[0].toFixed(1)}, ${NEAR_FADE[1].toFixed(1)}, ${d}))`;
const BAYER_GLSL = `float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i] + 0.5) / 16.0;
}`;

/**
 * Just the near fade, for trees drawn as ordinary models (themed courses' palms and Kenney trees),
 * which have no per-instance dither. Clones the material.
 */
export function nearFaded(m: THREE.Material): THREE.Material {
  const n = m.clone();
  n.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCamDist;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCamDist = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vCamDist;\n${BAYER_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\nfloat solid = ${NEAR_GLSL('vCamDist')};\nif (solid < 0.999 && bayer4(gl_FragCoord.xy) > solid) discard;`);
  };
  n.customProgramCacheKey = () => 'tree-near';
  return n;
}

/** Trees sway with the hole's wind (m/s, blowing toward); drawn only, the physics trees stand still. */
const TREE_WIND = { value: new THREE.Vector2() };
const TREE_TIME = { value: 0 };
export function setTreeWind(w: Vec2): void {
  TREE_WIND.value.set(w[0], w[1]);
}

/**
 * Dither-dissolve: each instance carries a 'dither' visibility (0…1); fragments above it on a 4×4
 * Bayer pattern are dropped. Opaque rendering stays (no sorting), and at 1 nothing changes.
 */
function dithered<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTreeSolidity = TREE_SOLIDITY;
    sh.uniforms.uTreeWind = TREE_WIND;
    sh.uniforms.uTreeTime = TREE_TIME;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float dither;\nvarying float vDither;\nvarying float vCamDist;\nuniform vec2 uTreeWind;\nuniform float uTreeTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDither = dither;')
      // Sway: lean downwind, more the higher up (∝ height²), gusting, out of step from tree to tree.
      .replace('#include <project_vertex>', `#include <project_vertex>
#ifdef USE_INSTANCING
{
  vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec2 base = instanceMatrix[3].xy;
  float h = max(wp.z, 0.0);
  float gust = 0.55 + 0.45 * sin(uTreeTime * 1.7 + base.x * 0.31 + base.y * 0.23);
  vec2 sway = (uTreeWind * gust + 0.6 * vec2(sin(uTreeTime * 1.1 + base.y), cos(uTreeTime * 0.9 + base.x))) * h * h * 0.0004;
  mvPosition.xyz += (viewMatrix * vec4(sway, 0.0, 0.0)).xyz;
  gl_Position = projectionMatrix * mvPosition;
}
#endif
vCamDist = -mvPosition.z;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vDither;
varying float vCamDist;
uniform float uTreeSolidity;
${BAYER_GLSL}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float near = ${NEAR_GLSL('vCamDist')};
float solid = min(min(vDither, uTreeSolidity), near);
if (solid < 0.999 && bayer4(gl_FragCoord.xy) > solid) discard;`);
  };
  m.customProgramCacheKey = () => 'tree-dither';
  return m;
}

/** Which trees should be models now (with hysteresis), then redraw everything. */
function refresh(s: TreeState): void {
  // Locked to a path: it decides (again, now that models, visibility or quality changed).
  if (s.lod && s.lock) return applyLock(s, false);
  const n = s.trees.length;
  const want = new Uint8Array(n);
  if (s.models) {
    if (!s.lod && s.quality !== 'low') want.fill(1);
    else if (s.lod && s.eye && LOD[s.quality].max > 0) {
      // Big forests: the nearest trees all round. Trees already models get a head start, so the
      // edge of the set doesn't flicker as the eye moves.
      const { radius, max } = LOD[s.quality];
      const [ex, ey] = s.eye;
      const cand: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const t = s.trees[i];
        const d = Math.hypot(t.x - ex, t.y - ey);
        const was = s.target[i] === 1;
        if (d < radius * (was ? KEEP_RADIUS : 1)) cand.push([d - (was ? KEEP_BONUS_M : 0), i]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, i] of cand.slice(0, max)) want[i] = 1;
    }
  }
  for (let i = 0; i < n; i++) {
    if (!s.visible(i)) want[i] = 0;
    if (want[i] !== s.target[i]) { s.target[i] = want[i]; s.active.add(i); }
  }
  writeBlobs(s, null);
  writeModels(s);
}

/** Blob matrices and dither, for all trees (null) or just these. */
function writeBlobs(s: TreeState, only: Iterable<number> | null): void {
  const d = s.blobDither.array as Float32Array;
  const set = (i: number) => {
    const on = s.visible(i) && s.fade[i] < 1;
    s.trunks.setMatrixAt(i, on ? s.trunkM[i] : ZERO);
    s.crowns.setMatrixAt(i, on ? s.crownM[i] : ZERO);
    d[i] = 1 - s.fade[i];
  };
  if (only) for (const i of only) set(i);
  else for (let i = 0; i < s.trees.length; i++) set(i);
  s.trunks.instanceMatrix.needsUpdate = true;
  s.crowns.instanceMatrix.needsUpdate = true;
  s.blobDither.needsUpdate = true;
}

/** Pack every tree that's at least partly a model into its kind's instanced meshes. */
function writeModels(s: TreeState): void {
  if (!s.models) return;
  const fill = s.models.meshes.map(() => 0);
  for (const i of s.active) {
    if (s.fade[i] <= 0 || !s.visible(i)) continue;
    const k = s.models.kindOf[i];
    for (const im of s.models.meshes[k]) {
      im.setMatrixAt(fill[k], s.models.matrices[i]);
      (im.geometry.getAttribute('dither').array as Float32Array)[fill[k]] = s.fade[i];
    }
    fill[k]++;
  }
  s.models.meshes.forEach((parts, k) => {
    for (const im of parts) {
      im.count = fill[k];
      im.instanceMatrix.needsUpdate = true;
      (im.geometry.getAttribute('dither') as THREE.BufferAttribute).needsUpdate = true;
    }
  });
}

/** Advance the dissolves (call every frame, any view). */
export function tickTrees(g: THREE.Group, now: number): void {
  TREE_TIME.value = now / 1000;
  const s = g.userData as TreeState;
  const dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 0;
  s.last = now;
  if (!s.models || s.active.size === 0 || dt === 0) return;
  const step = dt / FADE_S;
  const moved: number[] = [];
  for (const i of s.active) {
    const goal = s.target[i];
    const f = s.fade[i];
    if (f === goal) { if (goal === 0) s.active.delete(i); continue; }
    s.fade[i] = goal ? Math.min(1, f + step) : Math.max(0, f - step);
    moved.push(i);
    if (s.fade[i] === 0 && goal === 0) s.active.delete(i);
  }
  if (moved.length === 0) return;
  writeBlobs(s, moved);
  writeModels(s);
}

/** Show only the trees whose index is in `visible` (hidden trees go at once, no fade). */
export function setTreesVisible(g: THREE.Group, visible: (i: number) => boolean): void {
  const s = g.userData as TreeState;
  s.visible = visible;
  refresh(s);
}

/** Graphics setting for one tree group. */
export function setTreeQuality(g: THREE.Group, q: TreeQuality): void {
  const s = g.userData as TreeState;
  if (s.quality === q) return;
  s.quality = q;
  s.eye = null; // re-pick on the next frame
  refresh(s);
}

/** Big forests: move the model zone with the first-person eye (re-picked every few meters). */
export function updateTreeLod(g: THREE.Group, x: number, y: number): void {
  const s = g.userData as TreeState;
  if (!s.lod || !s.models || s.lock) return;
  if (s.eye && Math.hypot(x - s.eye[0], y - s.eye[1]) < REPICK_M) return;
  s.eye = [x, y];
  refresh(s);
}

type ModelPart = { geo: THREE.BufferGeometry; mat: THREE.Material };
const modelPromises = new Map<number, Promise<ModelPart[]>>();

/**
 * The tree models a course uses (each loaded once per page): every kind's meshes as (geometry,
 * material) pairs, indexed by kind; kinds not asked for are empty.
 */
function loadTreeModels(used: Set<number>): Promise<ModelPart[][]> {
  return Promise.all(TREE_KIND_NAMES.map((_, k) => (used.has(k) ? loadTreeModel(k) : Promise.resolve([]))));
}

function loadTreeModel(kind: number): Promise<ModelPart[]> {
  let p = modelPromises.get(kind);
  if (p) return p;
  p = (async () => {
    const gltf = await new GLTFLoader().loadAsync(asset(`models/qtrees/${TREE_KIND_NAMES[kind]}.gltf`));
    const parts: ModelPart[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = dithered((mesh.material as THREE.MeshStandardMaterial).clone());
      mat.metalness = 0;
      mat.roughness = 1;
      parts.push({ geo: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mat });
    });
    return parts;
  })();
  modelPromises.set(kind, p);
  return p;
}

export function discMesh(color: string): THREE.Mesh {
  // Flattened, slightly domed disc.
  const geo = new THREE.CylinderGeometry(DISC_RADIUS * 0.92, DISC_RADIUS, 0.022, 28);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
}

/**
 * Big forests, while following a throw: models for the trees nearest its flight path (x, y points),
 * fixed until unlocked, so nothing pops in or out as the chase camera flies along. null unlocks
 * (the eye zone takes over again, dissolving as usual). `flyover`: the path is a hole flyover's
 * (points a few meters apart): every tree within FLYOVER_RADIUS of it, at once.
 */
export function lockTreeLod(g: THREE.Group, path: Vec2[] | null, flyover = false): void {
  const s = g.userData as TreeState;
  if (!s.lod) return;
  if (!path) {
    if (!s.lock) return;
    s.lock = null;
    s.eye = null;
    return;
  }
  s.lock = { path, flyover };
  applyLock(s, flyover);
}

/**
 * Pick the locked model set. `instant`: swap without the dissolve (the cut to a flyover hides it).
 * Re-applied when the models arrive (a first hole's flyover can start before they have), fading in.
 */
function applyLock(s: TreeState, instant: boolean): void {
  const { path, flyover } = s.lock!;
  const max = Math.round(LOD[s.quality].max * (flyover ? FLYOVER_MULT : CORRIDOR_MULT));
  const radius = flyover ? FLYOVER_RADIUS[s.quality] : Infinity;
  const want = new Uint8Array(s.trees.length);
  if (s.models && max > 0) {
    const pts = flyover ? path : path.filter((_, k) => k % 15 === 0 || k === path.length - 1);
    const ranked: [number, number][] = [];
    s.trees.forEach((t, i) => {
      if (!s.visible(i)) return;
      let d = Infinity;
      for (const q of pts) d = Math.min(d, Math.hypot(t.x - q[0], t.y - q[1]));
      if (d <= radius) ranked.push([d, i]);
    });
    ranked.sort((a, b) => a[0] - b[0]);
    for (const [, i] of ranked.slice(0, max)) want[i] = 1;
  }
  for (let i = 0; i < want.length; i++) {
    if (want[i] === s.target[i] && !(instant && s.fade[i] !== want[i])) continue;
    s.target[i] = want[i];
    s.active.add(i);
    if (instant) s.fade[i] = want[i];
  }
  writeBlobs(s, null);
  writeModels(s);
}
