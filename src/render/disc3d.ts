// 3D models for disc golf: basket (to standard dimensions), instanced trees, disc.
import * as THREE from 'three';
import type { Tree } from '../course/disc-types';
import { DISC_RADIUS } from '../disc/discs';
import { BASKET } from '../disc/flight';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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
 * and, on big forests, beyond LOD_RADIUS of the first-person eye.
 */
export function treeMeshes(trees: Tree[]): THREE.Group {
  const g = new THREE.Group();
  const n = trees.length;
  const trunkGeo = new THREE.CylinderGeometry(1, 1.2, 1, 7);
  trunkGeo.rotateX(Math.PI / 2);
  trunkGeo.translate(0, 0, 0.5);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#5b4632' }), n);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), n);
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
  const state: TreeState = { trees, trunks, crowns, trunkM, crownM, visible: () => true, lod: n > LOD_ALL, eye: null, models: null };
  g.userData = state;
  refresh(state);
  loadTreeModels().then((kinds) => {
    // One instanced mesh per model part (bark, leaves), sized for every tree of that kind.
    const count = kinds.map(() => 0);
    const placed = trees.map((t) => treeShape(t));
    for (const p of placed) count[p.kind]++;
    const meshes = kinds.map((parts, k) => parts.map((part) => {
      const im = new THREE.InstancedMesh(part.geo, part.mat, Math.max(1, count[k]));
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
    refresh(state);
  }).catch((e) => console.warn('Tree models failed to load; keeping simple trees', e));
  return g;
}

/** Forests bigger than this draw models only near the first-person eye. */
const LOD_ALL = 1500;
const LOD_RADIUS = 90;
const LOD_MAX = 300;

interface TreeState {
  trees: Tree[];
  trunks: THREE.InstancedMesh;
  crowns: THREE.InstancedMesh;
  trunkM: THREE.Matrix4[];
  crownM: THREE.Matrix4[];
  visible: (i: number) => boolean;
  lod: boolean;
  /** First-person eye position and unit view direction (x, y, dx, dy). */
  eye: [number, number, number, number] | null;
  models: { meshes: THREE.InstancedMesh[][]; kindOf: number[]; matrices: THREE.Matrix4[] } | null;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function refresh(s: TreeState): void {
  const fill = s.models?.meshes.map(() => 0);
  // Big forests: models for the nearest LOD_MAX trees within LOD_RADIUS that are roughly in view
  // (or within 15 m all round, for looking about).
  let near: Set<number> | null = null;
  if (s.lod) {
    near = new Set();
    if (s.eye) {
      const cand: [number, number][] = [];
      s.trees.forEach((t, i) => {
        const dx = t.x - s.eye![0], dy = t.y - s.eye![1], d = Math.hypot(dx, dy);
        if (s.visible(i) && (d < 15 || (d < LOD_RADIUS && (dx * s.eye![2] + dy * s.eye![3]) / d > 0.2))) cand.push([d, i]);
      });
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, i] of cand.slice(0, LOD_MAX)) near.add(i);
    }
  }
  s.trees.forEach((_t, i) => {
    const on = s.visible(i);
    const model = on && (near === null || near.has(i)) && s.models !== null;
    s.trunks.setMatrixAt(i, on && !model ? s.trunkM[i] : ZERO);
    s.crowns.setMatrixAt(i, on && !model ? s.crownM[i] : ZERO);
    if (model) {
      const k = s.models!.kindOf[i];
      for (const im of s.models!.meshes[k]) im.setMatrixAt(fill![k], s.models!.matrices[i]);
      fill![k]++;
    }
  });
  s.trunks.instanceMatrix.needsUpdate = true;
  s.crowns.instanceMatrix.needsUpdate = true;
  s.models?.meshes.forEach((parts, k) => { for (const im of parts) { im.count = fill![k]; im.instanceMatrix.needsUpdate = true; } });
}

/** Show only the trees whose index is in `visible`. */
export function setTreesVisible(g: THREE.Group, visible: (i: number) => boolean): void {
  const s = g.userData as TreeState;
  s.visible = visible;
  refresh(s);
}

/** Big forests: move the model zone with the first-person eye (re-placed every 10 m or 20° turn). */
export function updateTreeLod(g: THREE.Group, x: number, y: number, dx: number, dy: number): void {
  const s = g.userData as TreeState;
  if (!s.lod || !s.models) return;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  if (s.eye && Math.hypot(x - s.eye[0], y - s.eye[1]) < 10 && ux * s.eye[2] + uy * s.eye[3] > Math.cos(0.35)) return;
  s.eye = [x, y, ux, uy];
  refresh(s);
}

type ModelPart = { geo: THREE.BufferGeometry; mat: THREE.Material };
let modelsPromise: Promise<ModelPart[][]> | null = null;

/** The tree models, once per page: each kind's meshes as (geometry, material) pairs. */
function loadTreeModels(): Promise<ModelPart[][]> {
  modelsPromise ??= Promise.all(TREE_KIND_NAMES.map(async (name) => {
    const gltf = await new GLTFLoader().loadAsync(`/models/qtrees/${name}.gltf`);
    const parts: ModelPart[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      mat.metalness = 0;
      mat.roughness = 1;
      parts.push({ geo: mesh.geometry.clone().applyMatrix4(mesh.matrixWorld), mat });
    });
    return parts;
  }));
  return modelsPromise;
}

export function discMesh(color: string): THREE.Mesh {
  // Flattened, slightly domed disc.
  const geo = new THREE.CylinderGeometry(DISC_RADIUS * 0.92, DISC_RADIUS, 0.022, 28);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
}
