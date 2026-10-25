// Little bursts where a throw makes contact: a puff of grass or dust on landing, a splash and
// ripples in water, leaves shaken loose from a tree, sparks off a prop. Played from the same cues
// as the sounds (src/audio/cues.ts), so they happen live and again in the replay. Augments add
// their own: fire, confetti, glows, a shield, wisps, wood chips, and trails behind the disc.
import * as THREE from 'three';
import type { Vec3 } from '../game/terrain';
import { groundAt } from './ground';

interface Burst {
  obj: THREE.Points | THREE.Mesh;
  /** Particles: velocities (m/s, xyz per particle). Ripples: none. */
  vel?: Float32Array;
  age: number;
  life: number;
  gravity: number;
  /** Air drag per second (velocity × e^(−drag·dt)). */
  drag: number;
  /** Leaves: sideways flutter. */
  flutter?: number;
  /** Ripples: grow to this radius. */
  grow?: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Trails behind a disc, by augment (src/modes/disc.ts picks them from the thrower's augments). */
export type TrailStyle = 'comet' | 'kite' | 'gold' | 'ghost' | 'homing' | 'laser' | 'feather' | 'cannon' | 'perfect' | 'ember' | 'frost';
const TRAILS: Record<TrailStyle, { colors: string[]; n: number; size: number; life: number; spread: number; rise: number; gravity: number; flutter?: number }> = {
  /** Comet Tail: a long, bright, icy tail. */
  comet: { colors: ['#e8f7ff', '#9fdcff', '#ffffff'], n: 4, size: 0.16, life: 1.6, spread: 0.12, rise: 0, gravity: 0 },
  /** Kite: streamers fluttering behind. */
  kite: { colors: ['#ff4d6d', '#ffd23f', '#4dabf7', '#5ee07a'], n: 2, size: 0.09, life: 0.9, spread: 0.3, rise: 0, gravity: 0.4, flutter: 3 },
  /** Golden Arm: gold sparkle. */
  gold: { colors: ['#ffd23f', '#fff3a0', '#ffb800'], n: 2, size: 0.07, life: 0.7, spread: 0.25, rise: 0, gravity: 1.5 },
  /** Phase Disc, Ghost Disc: ghostly wisps. */
  ghost: { colors: ['#b48cff', '#d9c8ff'], n: 2, size: 0.11, life: 1, spread: 0.2, rise: 0.2, gravity: 0, flutter: 1 },
  /** Homing Chains: a thin blue line. */
  homing: { colors: ['#5fd4ff', '#c4f0ff'], n: 2, size: 0.06, life: 0.6, spread: 0.04, rise: 0, gravity: 0 },
  /** Laser Disc: a red laser line. */
  laser: { colors: ['#ff3b3b', '#ff9a9a'], n: 3, size: 0.05, life: 0.5, spread: 0.01, rise: 0, gravity: 0 },
  /** Featherweight, Hover Plastic: white feathers drifting down. */
  feather: { colors: ['#ffffff', '#eef3f8'], n: 1, size: 0.09, life: 1.4, spread: 0.3, rise: 0.3, gravity: 0.6, flutter: 2 },
  /** Cannon Arm: smoke and sparks off the release. */
  cannon: { colors: ['#ff9a3c', '#ffd23f', '#6a625a'], n: 3, size: 0.12, life: 0.8, spread: 0.3, rise: 0.3, gravity: -0.5 },
  /** An armed Perfect Form throw: a pale gold aura. */
  perfect: { colors: ['#fff6c8', '#ffe28a'], n: 2, size: 0.13, life: 0.6, spread: 0.1, rise: 0, gravity: 0 },
  /** Fireball, once it has burned a tree: embers. */
  ember: { colors: ['#ff7a1a', '#ffcf3f', '#ff4d1a'], n: 2, size: 0.08, life: 0.8, spread: 0.2, rise: 0.4, gravity: -0.8 },
  /** Ice Veins (putts): frost. */
  frost: { colors: ['#cfefff', '#ffffff'], n: 2, size: 0.07, life: 0.8, spread: 0.15, rise: 0, gravity: 0.3 },
};

/** Round, soft-edged particle sprite (Points are squares without one). */
let dotTex: THREE.Texture | null = null;
function dot(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

export class Effects {
  readonly group = new THREE.Group();
  private bursts: Burst[] = [];

  /** Landing: a puff the color of the ground. */
  puff(at: Vec3, colors: string[], n = 16): void {
    this.particles(at, n, colors, 0.07, 1.1, () => [rnd(-1.6, 1.6), rnd(-1.6, 1.6), rnd(0.6, 2.2)], 9.8, 2.5);
  }

  /** Water: droplets thrown up and two ripples spreading out. */
  splash(at: Vec3): void {
    this.particles([at[0], at[1], groundAt(at[0], at[1]) + 0.05], 28, ['#e8f4ff', '#bcdcf5', '#ffffff'], 0.06, 1.0, () => {
      const a = Math.random() * Math.PI * 2, r = rnd(0.5, 2.2);
      return [Math.cos(a) * r, Math.sin(a) * r, rnd(2.5, 5)];
    }, 9.8, 0.4);
    for (const [delay, grow] of [[0, 2.6], [0.25, 1.8]]) this.ripple(at, grow, delay);
  }

  /** A tree: leaves shaken loose, fluttering down. */
  leaves(at: Vec3, n = 14): void {
    this.particles([at[0], at[1], Math.max(1, at[2])], n, ['#4f7d2c', '#6f9a35', '#9cae3a', '#c7a43a'], 0.09, 2.6, () => [rnd(-1, 1), rnd(-1, 1), rnd(0, 1.2)], 1.6, 1.8, 1.4);
  }

  /** A prop (windmill, cow, castle…): a little shower of sparks. */
  sparks(at: Vec3): void {
    this.particles(at, 18, ['#fff3a0', '#ffd23f', '#ffffff'], 0.06, 0.6, () => [rnd(-3, 3), rnd(-3, 3), rnd(0, 3)], 6, 3);
  }

  /** Fireball: a tree going up in flames and smoke. */
  fire(at: Vec3): void {
    const base: Vec3 = [at[0], at[1], Math.max(0.5, at[2])];
    this.particles(base, 46, ['#ff4d1a', '#ff9a2e', '#ffd23f', '#fff3a0'], 0.22, 1.4, () => [rnd(-1.2, 1.2), rnd(-1.2, 1.2), rnd(2, 6)], -1.5, 1.8);
    this.particles(base, 22, ['#3a3530', '#5a524a', '#7a7068'], 0.32, 2.6, () => [rnd(-0.8, 0.8), rnd(-0.8, 0.8), rnd(1.5, 3.5)], -0.6, 0.8, 0.6);
  }

  /** Trick Shot (and aces): confetti thrown up over the basket. */
  confetti(at: Vec3): void {
    this.particles([at[0], at[1], Math.max(1, at[2])], 70, ['#ff4d6d', '#ffd23f', '#4dabf7', '#5ee07a', '#b48cff', '#ffffff'], 0.09, 2.6, () => [rnd(-3.5, 3.5), rnd(-3.5, 3.5), rnd(4, 9)], 5, 1.2, 2);
  }

  /** A soft burst of light (a save, a catch, a split, a nudge): `colors`, rising a little. */
  glow(at: Vec3, colors: string[], n = 24, size = 0.12): void {
    this.particles(at, n, colors, size, 0.9, () => { const a = Math.random() * Math.PI * 2, r = rnd(0.6, 2); return [Math.cos(a) * r, Math.sin(a) * r, rnd(0.2, 1.6)]; }, -0.4, 2.5);
  }

  /** OB Insurance: a shield ring flashing where it saved you. */
  shield(at: Vec3): void {
    this.ripple([at[0], at[1], groundAt(at[0], at[1]) + 0.4], 2.4, 0, '#7ee0ff');
    this.glow(at, ['#7ee0ff', '#ffffff'], 18);
  }

  /** Phasing through a tree: ghostly wisps. */
  wisps(at: Vec3, colors = ['#b48cff', '#d9c8ff', '#ffffff']): void {
    this.particles(at, 16, colors, 0.14, 1.1, () => [rnd(-0.8, 0.8), rnd(-0.8, 0.8), rnd(0.2, 1)], -0.5, 1.5, 1);
  }

  /** Lumberjack: wood chips flying off the trunk. */
  chips(at: Vec3): void {
    this.particles(at, 16, ['#c79a5a', '#a87a42', '#e2c08a'], 0.08, 1.2, () => [rnd(-3, 3), rnd(-3, 3), rnd(1, 4)], 9.8, 1.5);
  }

  /** Storm Front: a gust swirling past (leaves and dust carried along `dir`). */
  gust(at: Vec3, dir: [number, number]): void {
    this.particles(at, 20, ['#dfe8ef', '#c7d6b0', '#ffffff'], 0.07, 1.6, () => [dir[0] * rnd(3, 6) + rnd(-0.6, 0.6), dir[1] * rnd(3, 6) + rnd(-0.6, 0.6), rnd(0, 1.2)], 0.3, 0.4, 1.5);
  }

  /** A few trail particles behind a disc in flight, in a style (see TRAILS); call every frame or two. */
  trail(at: Vec3, style: TrailStyle): void {
    const t = TRAILS[style];
    this.particles(at, t.n, t.colors, t.size, t.life, () => [rnd(-t.spread, t.spread), rnd(-t.spread, t.spread), rnd(-t.spread, t.spread) + t.rise], t.gravity, 2, t.flutter);
  }

  update(dt: number): void {
    for (const b of this.bursts) {
      b.age += dt;
      const k = Math.min(1, b.age / b.life);
      const mat = b.obj.material as THREE.PointsMaterial | THREE.MeshBasicMaterial;
      if (b.vel) {
        const pos = (b.obj as THREE.Points).geometry.getAttribute('position') as THREE.BufferAttribute;
        const p = pos.array as Float32Array, v = b.vel;
        const keep = Math.exp(-b.drag * dt);
        for (let i = 0; i < v.length; i += 3) {
          v[i] *= keep; v[i + 1] *= keep; v[i + 2] = v[i + 2] * keep - b.gravity * dt;
          if (b.flutter) { v[i] += Math.sin(b.age * 5 + i) * b.flutter * dt; v[i + 1] += Math.cos(b.age * 4 + i) * b.flutter * dt; }
          p[i] += v[i] * dt; p[i + 1] += v[i + 1] * dt; p[i + 2] = Math.max(0.02, p[i + 2] + v[i + 2] * dt);
          if (p[i + 2] <= 0.02) { v[i] = v[i + 1] = v[i + 2] = 0; } // settled
        }
        pos.needsUpdate = true;
        mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      } else if (b.grow) {
        const t = Math.max(0, b.age) / b.life;
        b.obj.visible = b.age >= 0;
        b.obj.scale.setScalar(0.2 + b.grow * t);
        mat.opacity = 0.7 * (1 - t);
      }
    }
    for (const b of this.bursts.filter((x) => x.age >= x.life)) {
      this.group.remove(b.obj);
      b.obj.geometry.dispose();
      (b.obj.material as THREE.Material).dispose();
    }
    this.bursts = this.bursts.filter((x) => x.age < x.life);
  }

  private particles(at: Vec3, n: number, colors: string[], size: number, life: number, v0: () => [number, number, number], gravity: number, drag: number, flutter?: number): void {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      pos.set([at[0] + rnd(-0.1, 0.1), at[1] + rnd(-0.1, 0.1), at[2] + rnd(0, 0.1)], i * 3);
      vel.set(v0(), i * 3);
      c.set(colors[i % colors.length]).toArray(col, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const obj = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dot(), vertexColors: true, transparent: true, depthWrite: false }));
    obj.frustumCulled = false;
    this.group.add(obj);
    this.bursts.push({ obj, vel, age: 0, life, gravity, drag, flutter });
  }

  private ripple(at: Vec3, grow: number, delay: number, color = '#e8f4ff'): void {
    const obj = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    obj.position.set(at[0], at[1], Math.max(0.06, at[2]));
    obj.visible = false;
    this.group.add(obj);
    this.bursts.push({ obj, age: -delay, life: 1.3, gravity: 0, drag: 0, grow });
  }
}
