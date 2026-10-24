// Spectators by the basket (Kenney Mini Characters, CC0): they stand around the green, watch the
// disc, sprint out of the way of a throw coming at them, and cheer or groan at the result. Where
// they stand and where they run to is src/game/gallery.ts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { Vec2 } from '../course/geo';
import type { Vec3 } from '../game/terrain';
import { asset } from '../assets';
import { approachAt, dodge, dodgeDue, gallerySpots, lineOfPlay } from '../game/gallery';

const MODELS = ['male-a', 'female-a', 'male-c', 'female-c', 'male-e', 'female-e'];
type Clip = 'idle' | 'walk' | 'sprint' | 'jump' | 'emote-yes' | 'emote-no';
/** Grown-up height, m. */
const HEIGHT = 1.75;
const SPRINT = 5.5;
const WALK = 1.5;
/** How long a cheer or groan lasts, s. */
const REACT_S = 2.4;

interface Person {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<Clip, THREE.AnimationAction>;
  clip: Clip;
  at: Vec2;
  to: Vec2 | null;
  speed: number;
  /** Heading they face, and want to face. */
  face: number;
  want: number;
  /** Seconds left of a cheer or groan. */
  react: number;
}

type Loaded = { scene: THREE.Object3D; animations: THREE.AnimationClip[]; scale: number };
let models: Promise<Loaded[]> | null = null;
function loadModels(): Promise<Loaded[]> {
  models ??= Promise.all(MODELS.map(async (m) => {
    const g = await new GLTFLoader().loadAsync(asset(`models/people/${m}.glb`));
    const box = new THREE.Box3().setFromObject(g.scene);
    return { scene: g.scene, animations: g.animations, scale: HEIGHT / Math.max(0.01, box.max.y - box.min.y) };
  }));
  return models;
}

const turnToward = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export class Gallery {
  readonly group = new THREE.Group();
  private people: Person[] = [];
  private hole = 0;
  /** A throw's dodges, waiting for the disc to come near: who, where to, and at which sample. */
  private dodges: { p: Person; to: Vec2; at: number }[] = [];

  /** `free`: open ground someone can stand on. */
  constructor(private readonly free: (p: Vec2) => boolean) {}

  /** New hole: up to n people around the basket. `incoming`: direction throws come in on (unit). */
  async setHole(pin: Vec2, incoming: Vec2, n: number): Promise<void> {
    const hole = ++this.hole;
    for (const p of this.people) this.group.remove(p.root);
    this.people = [];
    this.dodges = [];
    if (n <= 0) return;
    let loaded: Loaded[];
    try { loaded = await loadModels(); } catch (e) { console.warn('Spectators failed to load', e); return; }
    if (hole !== this.hole) return; // another hole started while loading
    // Same people in the same places whenever this hole is played.
    let seed = Math.floor(Math.abs(pin[0] * 73.1 + pin[1] * 19.7)) >>> 0;
    const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    gallerySpots(pin, incoming, n, this.free, rng).forEach((s, i) => {
      const src = loaded[(i + seed) % loaded.length];
      const inner = cloneSkinned(src.scene);
      const model = new THREE.Group();
      model.add(inner);
      model.rotation.x = Math.PI / 2; // glTF Y-up → course Z-up
      model.scale.setScalar(src.scale * (0.92 + rng() * 0.14));
      const root = new THREE.Group();
      root.add(model);
      root.position.set(s.at[0], s.at[1], 0);
      this.group.add(root);
      const mixer = new THREE.AnimationMixer(inner);
      const actions = new Map<Clip, THREE.AnimationAction>();
      for (const a of src.animations) actions.set(a.name as Clip, mixer.clipAction(a));
      const idle = actions.get('idle');
      if (idle) { idle.play(); idle.time = rng() * idle.getClip().duration; }
      const p: Person = { root, mixer, actions, clip: 'idle', at: [...s.at], to: null, speed: 0, face: s.face, want: s.face, react: 0 };
      this.people.push(p);
      this.pose(p);
    });
  }

  /**
   * A throw is on its way (its whole flight, 60 Hz): anyone in its path will sprint clear, but
   * only as the disc comes near (see watch), not the moment it's thrown.
   */
  onThrow(path: Vec3[]): void {
    this.dodges = [];
    for (const p of this.people) {
      const from = p.to ?? p.at;
      const to = dodge(from, path, this.free);
      if (to) this.dodges.push({ p, to, at: approachAt(from, path) });
    }
  }

  /** A new lie: anyone standing on the line from it to the basket strolls aside. */
  clearLine(from: Vec2, pin: Vec2): void {
    const line = lineOfPlay(from, pin);
    for (const p of this.people) {
      if (p.to) continue;
      const to = dodge(p.at, line, this.free);
      if (to) this.go(p, to, WALK);
    }
  }

  /** Cheer, nod or groan: everyone within `within` m of `near`. */
  react(kind: 'cheer' | 'yes' | 'no', near: Vec2, within = 25): void {
    const clip: Clip = kind === 'cheer' ? 'jump' : kind === 'yes' ? 'emote-yes' : 'emote-no';
    for (const p of this.people) {
      if (p.to || Math.hypot(p.at[0] - near[0], p.at[1] - near[1]) > within) continue;
      p.react = REACT_S * (0.85 + Math.random() * 0.3);
      this.play(p, clip);
    }
  }

  /**
   * Where the disc is (null: nothing in the air). People nearby turn to watch it. `t`, the sample
   * it's at in a live flight and `samplesPerS` how fast those go by: whoever must dodge it runs
   * once it's close enough that they have to.
   */
  watch(disc: Vec3 | null, t?: number, samplesPerS = 60): void {
    if (!disc) { this.dodges = []; return; }
    if (t !== undefined) {
      this.dodges = this.dodges.filter((d) => {
        if (!dodgeDue(d.at - t, samplesPerS, Math.hypot(d.to[0] - d.p.at[0], d.to[1] - d.p.at[1]), SPRINT)) return true;
        this.go(d.p, d.to, SPRINT);
        return false;
      });
    }
    for (const p of this.people) {
      if (p.to || Math.hypot(disc[0] - p.at[0], disc[1] - p.at[1]) > 60) continue;
      p.want = Math.atan2(disc[1] - p.at[1], disc[0] - p.at[0]);
    }
  }

  update(dt: number): void {
    for (const p of this.people) {
      if (p.to) {
        const dx = p.to[0] - p.at[0], dy = p.to[1] - p.at[1], d = Math.hypot(dx, dy);
        const step = p.speed * dt;
        if (d <= step) {
          p.at = p.to;
          p.to = null;
          this.play(p, 'idle');
        } else {
          p.at = [p.at[0] + (dx / d) * step, p.at[1] + (dy / d) * step];
          p.want = Math.atan2(dy, dx);
        }
      } else if (p.react > 0) {
        p.react -= dt;
        if (p.react <= 0) this.play(p, 'idle');
      }
      p.face = turnToward(p.face, p.want, 1 - Math.exp(-dt * (p.to ? 14 : 4)));
      this.pose(p);
      p.mixer.update(dt);
    }
  }

  private go(p: Person, to: Vec2, speed: number): void {
    p.to = to;
    p.speed = speed;
    p.react = 0;
    this.play(p, speed > WALK ? 'sprint' : 'walk');
  }

  private play(p: Person, clip: Clip): void {
    if (p.clip === clip) return;
    const next = p.actions.get(clip), prev = p.actions.get(p.clip);
    if (!next) return;
    next.reset().play();
    if (prev) next.crossFadeFrom(prev, 0.2, false);
    p.clip = clip;
  }

  private pose(p: Person): void {
    p.root.position.set(p.at[0], p.at[1], 0);
    // The models face their +Z; standing up (+Z → −Y), so heading h needs a yaw of h + π/2.
    p.root.rotation.z = p.face + Math.PI / 2;
  }
}
