// Things moving around the course so it doesn't sit still: a flock of birds circling the hole,
// butterflies at the tee and the basket, cloud shadows drifting downwind, a streamer on the basket
// showing the wind, rain in wet weather, and shooting stars over Rainbow Runs. All scenery: the
// flight model never sees any of it.
import * as THREE from 'three';
import type { Vec2 } from '../course/geo';
import type { Vec3 } from '../game/terrain';
import { BASKET } from '../disc/flight';
import { SKY_LAYER } from './courseScene';
import type { Weather } from './weather';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Flapper { obj: THREE.Group; wings: [THREE.Object3D, THREE.Object3D]; phase: number }
interface Bird extends Flapper { offset: Vec3 }
interface Butterfly extends Flapper { home: Vec2; at: Vec3; vel: Vec3 }
interface Cloud { mesh: THREE.Mesh; at: Vec2 }

/** Two wings on a hinge, for a bird or a butterfly. */
function flapper(span: number, chord: number, color: string, body?: string): Flapper {
  const obj = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
  const wing = (s: 1 | -1) => {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, chord / 2, 0), new THREE.Vector3(0, -chord / 2, 0), new THREE.Vector3(s * span, -chord * 0.2, 0)]);
    g.computeVertexNormals();
    const hinge = new THREE.Group();
    hinge.add(new THREE.Mesh(g, mat));
    obj.add(hinge);
    return hinge;
  };
  const wings: [THREE.Object3D, THREE.Object3D] = [wing(1), wing(-1)];
  if (body) {
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(chord * 0.12, chord * 0.7, 2, 6).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: body }));
    b.rotation.z = Math.PI / 2;
    obj.add(b);
  }
  return { obj, wings, phase: Math.random() * 10 };
}

/** Soft round shadow texture, dark in the middle and fading out. */
function softDisc(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export class Life {
  readonly group = new THREE.Group();
  private readonly birds: Bird[] = [];
  private readonly flies: Butterfly[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly flag = new THREE.Group();
  private readonly cloth: THREE.Mesh;
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.Points | null = null;
  private star: { line: THREE.Line; t: number; life: number } | null = null;
  private nextStar = 3;
  private wind: Vec2 = [0, 0];
  private center: Vec2 = [0, 0];
  private flockR = 50;
  private t = 0;
  private weather: Weather | null = null;

  /** `space`: Rainbow Runs (no birds, butterflies or clouds; shooting stars). */
  constructor(private readonly bounds: [Vec2, Vec2], private readonly space: boolean) {
    // Streamer on the basket: a short pole on the lid and a strip of cloth that points downwind.
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 6).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#b9bec4' }));
    pole.position.z = BASKET.bandTop + 0.35;
    this.cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14, 10, 1), new THREE.MeshLambertMaterial({ color: '#ff5a3c', side: THREE.DoubleSide }));
    this.cloth.geometry.translate(0.275, 0, 0); // hangs from the pole at x = 0
    this.cloth.rotation.x = Math.PI / 2; // stand the strip up (its width vertical)
    const arm = new THREE.Group();
    arm.name = 'arm';
    arm.position.z = BASKET.bandTop + 0.62;
    arm.add(this.cloth);
    this.flag.add(pole, arm);
    this.group.add(this.flag);
    if (space) return;
    for (let i = 0; i < 7; i++) {
      const b = flapper(0.45, 0.22, '#2b2b30', '#2b2b30');
      this.birds.push({ ...b, offset: [rnd(-8, 8), rnd(-8, 8), rnd(-3, 3)] });
      this.group.add(b.obj);
    }
    const wingColors = ['#ffb23f', '#ffffff', '#7fc4ff', '#ffe15a', '#ff7aa8'];
    for (let i = 0; i < 6; i++) {
      const f = flapper(0.06, 0.07, wingColors[i % wingColors.length]);
      this.flies.push({ ...f, home: [0, 0], at: [0, 0, 1], vel: [0, 0, 0] });
      this.group.add(f.obj);
    }
    const tex = softDisc();
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: '#000000', transparent: true, opacity: 0.28, depthWrite: false }));
      mesh.scale.set(rnd(50, 90), rnd(35, 60), 1);
      mesh.rotation.z = rnd(0, Math.PI);
      mesh.renderOrder = 3;
      const at: Vec2 = [rnd(bounds[0][0], bounds[1][0]), rnd(bounds[0][1], bounds[1][1])];
      mesh.position.set(at[0], at[1], 0.08);
      this.clouds.push({ mesh, at });
      this.group.add(mesh);
    }
  }

  setWeather(w: Weather): void {
    this.weather = w;
    for (const b of this.birds) b.obj.visible = w.birds;
    for (const f of this.flies) f.obj.visible = !w.rain;
    for (const c of this.clouds) c.mesh.visible = w.clouds;
    if (w.rain && !this.rain) this.rain = this.makeRain();
    if (this.rain) this.rain.visible = w.rain;
    if (w.snow && !this.snow) this.snow = this.makeSnow();
    if (this.snow) this.snow.visible = !!w.snow;
  }

  /** New hole: the flock circles it, butterflies at the tee and basket, the streamer on the basket. */
  setHole(h: { tee: Vec2; pin: Vec2 }, wind: Vec2): void {
    this.wind = wind;
    this.center = [(h.tee[0] + h.pin[0]) / 2, (h.tee[1] + h.pin[1]) / 2];
    this.flockR = Math.max(30, Math.hypot(h.pin[0] - h.tee[0], h.pin[1] - h.tee[1]) * 0.45);
    this.flies.forEach((f, i) => {
      const home = i % 2 ? h.pin : h.tee;
      f.home = [home[0] + rnd(-6, 6), home[1] + rnd(-6, 6)];
      f.at = [f.home[0], f.home[1], rnd(0.4, 1.4)];
    });
    this.flag.position.set(h.pin[0], h.pin[1], 0);
  }

  /** The basket moved for this viewer (Crazy mode): the streamer goes with it. */
  setPin(pin: Vec2): void {
    this.flag.position.set(pin[0], pin[1], 0);
  }

  update(dt: number, eye: Vec3 | null): void {
    this.t += dt;
    const t = this.t;
    const [wx, wy] = this.wind;
    const ws = Math.hypot(wx, wy);
    // Birds: a loose flock wheeling around the hole, 25–35 m up, flapping and gliding.
    const fa = t * 0.12;
    for (const b of this.birds) {
      const a = fa + b.offset[0] * 0.01;
      const x = this.center[0] + Math.cos(a) * this.flockR + b.offset[0];
      const y = this.center[1] + Math.sin(a) * this.flockR + b.offset[1];
      b.obj.position.set(x, y, 30 + b.offset[2] + Math.sin(t * 0.7 + b.phase) * 1.5);
      b.obj.rotation.z = a + Math.PI; // along the circle (counterclockwise)
      const flap = Math.sin(t * 2 + b.phase) > -0.3 ? Math.sin(t * 9 + b.phase) * 0.6 : 0.1; // bursts of flapping, then a glide
      b.wings[0].rotation.y = -flap;
      b.wings[1].rotation.y = flap;
    }
    // Butterflies: a wandering flutter near home, pushed a little by the wind.
    for (const f of this.flies) {
      const pull: Vec3 = [(f.home[0] - f.at[0]) * 0.4, (f.home[1] - f.at[1]) * 0.4, (0.9 - f.at[2]) * 0.8];
      f.vel = [
        f.vel[0] * 0.96 + (pull[0] + rnd(-3, 3) + wx * 0.15) * dt,
        f.vel[1] * 0.96 + (pull[1] + rnd(-3, 3) + wy * 0.15) * dt,
        f.vel[2] * 0.9 + (pull[2] + rnd(-2, 2)) * dt,
      ];
      f.at = [f.at[0] + f.vel[0] * dt, f.at[1] + f.vel[1] * dt, Math.max(0.25, f.at[2] + f.vel[2] * dt)];
      f.obj.position.set(f.at[0], f.at[1], f.at[2]);
      f.obj.rotation.z = Math.atan2(f.vel[1], f.vel[0]);
      const flap = Math.sin(t * 22 + f.phase) * 1.1;
      f.wings[0].rotation.y = -flap;
      f.wings[1].rotation.y = flap;
    }
    // Cloud shadows drift downwind (a little even when calm), wrapping around the course.
    const [min, max] = this.bounds;
    const W = max[0] - min[0] + 200, H = max[1] - min[1] + 200;
    for (const c of this.clouds) {
      c.at = [c.at[0] + (wx * 1.5 + 0.8) * dt, c.at[1] + (wy * 1.5 + 0.3) * dt];
      c.at = [((c.at[0] - min[0] + 100) % W + W) % W + min[0] - 100, ((c.at[1] - min[1] + 100) % H + H) % H + min[1] - 100];
      c.mesh.position.set(c.at[0], c.at[1], 0.08);
    }
    // Streamer: points downwind, lifting with the wind speed and rippling.
    const arm = this.flag.getObjectByName('arm')!;
    arm.rotation.z = ws > 0.05 ? Math.atan2(wy, wx) : 0;
    arm.rotation.y = (1 - Math.min(1, ws / 4)) * 1.3; // calm: hangs down; windy: flies flat
    const pos = this.cloth.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 14 - t * (6 + ws * 2)) * 0.03 * (x / 0.55) * (0.4 + Math.min(1, ws / 3)));
    }
    pos.needsUpdate = true;
    if (this.rain?.visible) this.stepRain(dt, eye);
    if (this.snow && this.weather?.snow) this.stepSnow(dt, eye);
    if (this.space) this.stepStars(dt);
  }

  // Rain: streaks in a box around the first-person eye, falling and blown by the wind.
  private makeRain(): THREE.LineSegments {
    const n = 1400;
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const x = rnd(-25, 25), y = rnd(-25, 25), z = rnd(0, 20); pos.set([x, y, z, x, y, z - 0.35], i * 6); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#c9d3dc', transparent: true, opacity: 0.45, depthWrite: false }));
    rain.frustumCulled = false;
    this.group.add(rain);
    return rain;
  }

  private stepRain(dt: number, eye: Vec3 | null): void {
    const rain = this.rain!;
    rain.visible = !!eye && !!this.weather?.rain;
    if (!eye) return;
    rain.position.set(eye[0], eye[1], 0);
    const pos = rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = pos.array as Float32Array;
    const [wx, wy] = this.wind;
    const vx = wx * 0.6, vy = wy * 0.6, vz = -9;
    for (let i = 0; i < p.length; i += 6) {
      let x = p[i] + vx * dt, y = p[i + 1] + vy * dt, z = p[i + 2] + vz * dt;
      if (z < 0) { x = rnd(-25, 25); y = rnd(-25, 25); z = 20; }
      if (x < -25) x += 50; else if (x > 25) x -= 50;
      if (y < -25) y += 50; else if (y > 25) y -= 50;
      p[i] = x; p[i + 1] = y; p[i + 2] = z;
      p[i + 3] = x - vx * 0.04; p[i + 4] = y - vy * 0.04; p[i + 5] = z - 0.35;
    }
    pos.needsUpdate = true;
  }

  // Snow: flakes in a box around the first-person eye, drifting down, swaying, blown by the wind.
  private makeSnow(): THREE.Points {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([rnd(-25, 25), rnd(-25, 25), rnd(0, 20)], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const snow = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }));
    snow.frustumCulled = false;
    this.group.add(snow);
    return snow;
  }

  private stepSnow(dt: number, eye: Vec3 | null): void {
    const snow = this.snow!;
    snow.visible = !!eye;
    if (!eye) return;
    snow.position.set(eye[0], eye[1], 0);
    const p = (snow.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const [wx, wy] = this.wind;
    const t = performance.now() / 1000;
    for (let i = 0; i < p.length; i += 3) {
      const sway = Math.sin(t * 1.3 + i * 0.37) * 0.35;
      let x = p[i] + (wx * 0.35 + sway) * dt, y = p[i + 1] + (wy * 0.35 + Math.cos(t * 1.1 + i * 0.21) * 0.3) * dt, z = p[i + 2] - 1.1 * dt;
      if (z < 0) { x = rnd(-25, 25); y = rnd(-25, 25); z = 20; }
      if (x < -25) x += 50; else if (x > 25) x -= 50;
      if (y < -25) y += 50; else if (y > 25) y -= 50;
      p[i] = x; p[i + 1] = y; p[i + 2] = z;
    }
    (snow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  // Shooting stars: every few seconds a streak across the dome (first person only).
  private stepStars(dt: number): void {
    if (this.star) {
      this.star.t += dt;
      const k = this.star.t / this.star.life;
      (this.star.line.material as THREE.LineBasicMaterial).opacity = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
      this.star.line.position.addScaledVector(this.star.line.userData.v as THREE.Vector3, dt);
      if (k >= 1) { this.group.remove(this.star.line); this.star.line.geometry.dispose(); this.star = null; }
      return;
    }
    this.nextStar -= dt;
    if (this.nextStar > 0) return;
    this.nextStar = rnd(4, 10);
    const [min, max] = this.bounds;
    const a = rnd(0, Math.PI * 2), el = rnd(0.25, 0.8), r = 1100;
    const p = new THREE.Vector3((min[0] + max[0]) / 2 + Math.cos(el) * Math.cos(a) * r, (min[1] + max[1]) / 2 + Math.cos(el) * Math.sin(a) * r, Math.sin(el) * r);
    const dir = new THREE.Vector3(-Math.sin(a), Math.cos(a), -0.35).normalize();
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(-90)]), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, fog: false }));
    line.position.copy(p);
    line.userData.v = dir.multiplyScalar(420);
    line.layers.set(SKY_LAYER);
    this.group.add(line);
    this.star = { line, t: 0, life: 0.9 };
  }
}
