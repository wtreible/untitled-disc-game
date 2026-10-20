// Themed-course 3D props (CC0 models: Kenney, KayKit, Quaternius): load once per model, clone per
// prop, play animations, spin windmill blades on the shared game clock (the same clock the physics
// uses). glTF and FBX files, plus a few procedural models named "proc:…".
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { PropDef, Tree } from '../course/disc-types';

export interface PropsView {
  group: THREE.Group;
  /** Advance animations by dt (s) and set spinning parts for game clock t (s). */
  update(t: number, dt: number): void;
  /** Rendered object for prop-trees, keyed by the course tree they represent. */
  treeObjects: Map<Tree, THREE.Object3D>;
}

export async function loadProps(defs: PropDef[], trees: Tree[], base = '/models/'): Promise<PropsView> {
  const gltf = new GLTFLoader();
  const fbx = new FBXLoader();
  const cache = new Map<string, Promise<Loaded>>();
  const load = (m: string) => {
    if (!cache.has(m)) {
      const p: Promise<Loaded> = m.startsWith('proc:') ? Promise.resolve({ scene: procedural(m.slice(5)), animations: [] })
        : m.endsWith('.fbx') ? fbx.loadAsync(base + m).then((g) => ({ scene: g, animations: g.animations }))
        : gltf.loadAsync(base + m);
      cache.set(m, p.then((g) => { matte(g.scene); return g; }));
    }
    return cache.get(m)!;
  };
  const group = new THREE.Group();
  const mixers: THREE.AnimationMixer[] = [];
  const spinners: { obj: THREE.Object3D; omega: number; phase: number; axis: 'x' | 'y' | 'z' }[] = [];
  const treeObjects = new Map<Tree, THREE.Object3D>();

  await Promise.all(defs.map(async (d) => {
    const src = await load(d.model);
    const animated = src.animations.length > 0 && !!d.anim;
    const inner = animated ? cloneSkinned(src.scene) : src.scene.clone(true);
    // Recenter models authored off-origin (Kenney Space Kit sits at about (2, 0, 1.5)).
    if (d.offset) inner.position.set(-d.offset[0], -d.offset[1], -d.offset[2]);
    if (d.tint) tint(inner, d.tint);
    // Sunk props: the ground doesn't write depth, so cut them off at ground level or the buried part
    // draws over the road and looks solid where nothing collides.
    if ((d.lift ?? 0) < 0) clipBelowGround(inner);
    const model = new THREE.Group();
    model.add(inner);
    // glTF is Y-up; the course is Z-up. Model −Z (its front) ends up along local +Y, then yaw.
    model.rotation.x = Math.PI / 2;
    model.scale.setScalar(d.scale);
    const root = new THREE.Group();
    root.position.set(d.at[0], d.at[1], d.lift ?? 0);
    root.rotation.z = d.yaw;
    root.add(model);
    group.add(root);
    if (animated) {
      const clip = src.animations.find((a) => a.name === d.anim) ?? src.animations[0];
      const mixer = new THREE.AnimationMixer(inner);
      const action = mixer.clipAction(clip);
      action.play();
      action.time = Math.random() * clip.duration; // don't move in lockstep
      mixers.push(mixer);
    }
    if (d.spin) {
      const obj = model.getObjectByName(d.spin.node);
      if (obj) spinners.push({ obj, omega: d.spin.omega, phase: d.spin.phase, axis: d.spin.axis ?? 'z' });
    }
    if (d.tree !== undefined && trees[d.tree]) treeObjects.set(trees[d.tree], root);
  }));

  return {
    group,
    treeObjects,
    update(t, dt) {
      for (const m of mixers) m.update(dt);
      // Same angle formula as bladeAngle() in src/disc/props.ts (rotation about the model's Z axis).
      for (const s of spinners) s.obj.rotation[s.axis] = s.phase + s.omega * t;
    },
  };
}

type Loaded = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };

/** Procedural models, Y-up like glTF, about 1 unit across. */
function procedural(name: string): THREE.Object3D {
  if (name === 'mystery-box') {
    // A glowing "?" cube that turns on its node "box" (Rainbow Runs).
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#ffe066');
    grad.addColorStop(1, '#ff8a3d');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 8;
    g.strokeRect(6, 6, 116, 116);
    g.fillStyle = '#ffffff';
    g.font = 'bold 92px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', 64, 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffb347', emissiveIntensity: 0.35, transparent: true, opacity: 0.92 }));
    box.name = 'box';
    box.position.y = 0.5;
    const root = new THREE.Group();
    root.add(box);
    return root;
  }
  throw new Error(`unknown procedural model ${name}`);
}

/**
 * Kenney's Nature Kit materials set metallicFactor 1. With no environment map, metal renders
 * nearly black, so make every prop material matte (cartoon models aren't meant to be metal).
 * Quaternius FBX materials come in as shiny Phong with white specular: dull those too.
 */
function matte(root: THREE.Object3D): void {
  for (const mat of materials(root)) {
    if (mat instanceof THREE.MeshStandardMaterial) { mat.metalness = 0; mat.roughness = Math.max(0.7, mat.roughness ?? 1); }
    if (mat instanceof THREE.MeshPhongMaterial) { mat.specular.set('#111111'); mat.shininess = 4; mat.emissive.set('#000000'); }
  }
}

/** Recolor materials by name on this clone (its materials are copied first, so others keep theirs). */
function tint(root: THREE.Object3D, colors: Record<string, string>): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const swap = (m: THREE.Material) => {
      const c = colors[m.name];
      if (!c || !('color' in m)) return m;
      const n = m.clone() as THREE.MeshPhongMaterial;
      n.color.set(c);
      return n;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

const GROUND = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)];

function clipBelowGround(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.material) return;
    const clip = (m: THREE.Material) => { const n = m.clone(); n.clippingPlanes = GROUND; return n; };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clip) : clip(mesh.material);
  });
}

function materials(root: THREE.Object3D): THREE.Material[] {
  const out: THREE.Material[] = [];
  root.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) out.push(...(Array.isArray(m) ? m : [m])); });
  return out;
}
