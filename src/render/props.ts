// Themed-course 3D props (Kenney CC0 models): load once per model, clone per prop, play animal
// animations, spin windmill blades on the shared game clock (the same clock the physics uses).
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
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
  const loader = new GLTFLoader();
  const cache = new Map<string, Promise<GLTF>>();
  const load = (m: string) => {
    if (!cache.has(m)) cache.set(m, loader.loadAsync(base + m).then((g) => { matte(g.scene); return g; }));
    return cache.get(m)!;
  };
  const group = new THREE.Group();
  const mixers: THREE.AnimationMixer[] = [];
  const spinners: { obj: THREE.Object3D; omega: number; phase: number }[] = [];
  const treeObjects = new Map<Tree, THREE.Object3D>();

  await Promise.all(defs.map(async (d) => {
    const gltf = await load(d.model);
    const animated = gltf.animations.length > 0 && !!d.anim;
    const model = animated ? cloneSkinned(gltf.scene) : gltf.scene.clone(true);
    // glTF is Y-up; the course is Z-up. Model −Z (its front) ends up along local +Y, then yaw.
    model.rotation.x = Math.PI / 2;
    model.scale.setScalar(d.scale);
    const root = new THREE.Group();
    root.position.set(d.at[0], d.at[1], d.lift ?? 0);
    root.rotation.z = d.yaw;
    root.add(model);
    group.add(root);
    if (animated) {
      const clip = gltf.animations.find((a) => a.name === d.anim) ?? gltf.animations[0];
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(clip);
      action.play();
      action.time = Math.random() * clip.duration; // don't move in lockstep
      mixers.push(mixer);
    }
    if (d.spin) {
      const obj = model.getObjectByName(d.spin.node);
      if (obj) spinners.push({ obj, omega: d.spin.omega, phase: d.spin.phase });
    }
    if (d.tree !== undefined && trees[d.tree]) treeObjects.set(trees[d.tree], root);
  }));

  return {
    group,
    treeObjects,
    update(t, dt) {
      for (const m of mixers) m.update(dt);
      // Same angle formula as bladeAngle() in src/disc/props.ts (rotation about the model's Z axis).
      for (const s of spinners) s.obj.rotation.z = s.phase + s.omega * t;
    },
  };
}

/**
 * Kenney's Nature Kit materials set metallicFactor 1. With no environment map, metal renders
 * nearly black, so make every prop material matte (cartoon models aren't meant to be metal).
 */
function matte(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] | undefined;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      if ('metalness' in mat) { mat.metalness = 0; mat.roughness = Math.max(0.7, mat.roughness ?? 1); }
    }
  });
}
