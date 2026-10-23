// Themed-course 3D props (CC0 models: Kenney, KayKit, Quaternius): load once per model, clone per
// prop, play animations, spin windmill blades on the shared game clock (the same clock the physics
// uses). glTF and FBX files, plus a few procedural models named "proc:…".
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { PropDef, Tree } from '../course/disc-types';
import { asset } from '../assets';
import { hingeAngle, slideOffset } from '../disc/props';
import { nearFaded } from './disc3d';

export interface PropsView {
  group: THREE.Group;
  /** Advance animations by dt (s) and set spinning parts for game clock t (s). */
  update(t: number, dt: number): void;
  /** Rendered object for prop-trees, keyed by the course tree they represent. */
  treeObjects: Map<Tree, THREE.Object3D>;
}

export async function loadProps(defs: PropDef[], trees: Tree[], base = asset('models/')): Promise<PropsView> {
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
  /** Drawbridges and sliders: set from the clock each frame. */
  const movers: ((t: number) => void)[] = [];
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
    const mo = d.motion;
    if (mo?.kind === 'hinge') {
      // Model space is Y-up with its front at −Z: tipping the plank forward is −θ about X.
      const obj = model.getObjectByName(mo.node);
      if (obj) movers.push((t) => { obj.rotation.x = -hingeAngle(mo.swing, t); });
    } else if (mo?.kind === 'slide') {
      movers.push((t) => { const o = slideOffset(mo.slide, t); root.position.set(d.at[0] + o[0], d.at[1] + o[1], d.lift ?? 0); });
    }
    if (d.tree !== undefined && trees[d.tree]) {
      treeObjects.set(trees[d.tree], root);
      // Model trees thin out up close too, like the course's own trees.
      inner.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.material) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(nearFaded) : nearFaded(mesh.material);
      });
    }
  }));

  return {
    group,
    treeObjects,
    update(t, dt) {
      for (const m of mixers) m.update(dt);
      // Same angle formula as bladeAngle() in src/disc/props.ts (rotation about the model's Z axis).
      for (const s of spinners) s.obj.rotation[s.axis] = s.phase + s.omega * t;
      for (const m of movers) m(t); // same schedules as the colliders (src/disc/props.ts)
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
  if (name === 'drawbridge') {
    // Wooden plank 1 wide, 0.92 long, hinged at its bottom edge (node "plank" pivots at the origin),
    // with iron bands and two chains running up its face (Fantasy Fairways' castle gate).
    const wood = new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: '#3d3b3a', roughness: 0.6, metalness: 0.4 });
    const plank = new THREE.Group();
    plank.name = 'plank';
    for (let i = 0; i < 6; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1 / 6 - 0.006, 0.92, 0.045), wood);
      board.position.set(-0.5 + (i + 0.5) / 6, 0.46, 0);
      plank.add(board);
    }
    for (const y of [0.15, 0.46, 0.77]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(1, 0.035, 0.055), dark);
      band.position.set(0, y, -0.002);
      plank.add(band);
    }
    for (const x of [-0.42, 0.42]) {
      const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6), dark);
      chain.position.set(x, 0.47, 0.03);
      plank.add(chain);
    }
    const root = new THREE.Group();
    root.add(plank);
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
