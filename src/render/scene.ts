// Top-down renderer (D5): orthographic camera looking straight down at z = 0, rotated so the hole
// plays "up" the screen. Everything lives in the local frame (meters, z up), so swapping in a
// perspective camera and a displaced ground mesh later doesn't touch game code.
import * as THREE from 'three';
import type { Vec2 } from '../course/geo';
import type { CourseHole } from '../course/types';
import type { SurfaceGrid } from '../game/surfaces';
import type { Vec3 } from '../game/terrain';
import { classCanvas } from './classTexture';
import type { Imagery } from './tiles';

export type ViewMode = 'photo' | 'overlay' | 'classes';
export const VIEW_LABELS: Record<ViewMode, string> = { photo: 'Photo', overlay: 'Photo + classes', classes: 'Classes' };

const OVERLAY_Z = 1;

export class HoleScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  private center: Vec2 = [0, 0];
  /** Pixels per meter. */
  private ppm = 2;
  /** Unit vector of "screen up" in world: tee → green. */
  readonly up: Vec2;

  private photo?: THREE.Mesh;
  private classes: THREE.Mesh;
  private overlay: THREE.Mesh;
  private view: ViewMode = 'photo';
  private readonly pixelScaled: THREE.Object3D[] = [];
  private readonly balls: THREE.Group[] = [];
  private readonly aimLine: THREE.Line;
  private readonly aimRing: THREE.LineLoop;
  private readonly trails = new THREE.Group();
  private readonly aimMat: THREE.LineDashedMaterial;

  constructor(private readonly container: HTMLElement, hole: CourseHole, grid: SurfaceGrid, playerColors: string[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color('#1d2419');

    const dx = hole.pin[0] - hole.tee[0];
    const dy = hole.pin[1] - hole.tee[1];
    const L = Math.hypot(dx, dy) || 1;
    this.up = [dx / L, dy / L];

    const gridMax: Vec2 = [grid.min[0] + grid.cols * grid.cell, grid.min[1] + grid.rows * grid.cell];
    this.classes = this.groundPlane(classCanvas(grid, this.up), [grid.min, gridMax], 0.01, 1);
    this.overlay = this.groundPlane(classCanvas(grid, this.up, 110), [grid.min, gridMax], 0.02, 1);
    this.classes.visible = false;
    this.overlay.visible = false;

    // Pin: cup + pole + flag, in pixel units (scaled by 1/ppm each frame).
    const pin = new THREE.Group();
    pin.add(disc(4, '#111111'), ring(4, 5.5, '#ffffff'));
    const pole = new THREE.Mesh(new THREE.PlaneGeometry(2, 34), basic('#f5f5f5'));
    pole.position.set(0, 17, 0);
    // Counter-clockwise as seen from above, or it's back-face culled.
    const flag = new THREE.Mesh(triangle(0, 20, 20, 27, 0, 34), basic('#e8312c'));
    pin.add(pole, flag);
    pin.position.set(hole.pin[0], hole.pin[1], OVERLAY_Z + 0.5);
    this.pixelScaled.push(pin);
    this.addOverlay(pin, 5);

    // Tee marker.
    const tee = new THREE.Group();
    tee.add(disc(4, '#ffffff'), ring(4, 5.5, '#2a7de1'));
    tee.position.set(hole.tee[0], hole.tee[1], OVERLAY_Z);
    this.pixelScaled.push(tee);
    this.addOverlay(tee, 4);

    // Balls: shadow + ball, pixel units.
    for (const color of playerColors) {
      const g = new THREE.Group();
      const shadow = disc(5, '#000000', 0.4);
      const ball = new THREE.Group();
      ball.add(disc(6.5, '#111111'), disc(5, color));
      g.add(shadow, ball);
      g.userData = { shadow, ball };
      g.visible = false;
      this.balls.push(g);
      this.pixelScaled.push(g);
      this.addOverlay(g, 20);
    }

    this.aimMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 4, gapSize: 3, transparent: true, depthTest: false });
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), this.aimMat);
    this.addOverlay(this.aimLine, 10);
    const circlePts = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    });
    this.aimRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circlePts), new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }));
    this.addOverlay(this.aimRing, 10);
    this.addOverlay(this.trails, 8);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setImagery(img: Imagery, offset: Vec2): void {
    if (this.photo) this.scene.remove(this.photo);
    const b: [Vec2, Vec2] = [[img.bounds[0][0] + offset[0], img.bounds[0][1] + offset[1]], [img.bounds[1][0] + offset[0], img.bounds[1][1] + offset[1]]];
    this.photo = this.groundPlane(img.canvas, b, 0, 0);
    this.setView(this.view);
  }

  setView(mode: ViewMode): void {
    this.view = mode;
    if (this.photo) this.photo.visible = mode !== 'classes';
    this.classes.visible = mode === 'classes' || !this.photo;
    this.overlay.visible = mode === 'overlay';
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  /** Fit the given points on screen with padding (pixels). */
  frame(points: Vec2[], pad = 80, maxPpm = 12): void {
    const right: Vec2 = [this.up[1], -this.up[0]];
    let minU = Infinity, maxU = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const p of points) {
      const u = p[0] * this.up[0] + p[1] * this.up[1];
      const r = p[0] * right[0] + p[1] * right[1];
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    }
    const { w, h } = this.size();
    // Leave room for the bottom HUD.
    const ppmU = (h - 2 * pad - 140) / Math.max(1, maxU - minU);
    const ppmR = (w - 2 * pad) / Math.max(1, maxR - minR);
    this.ppm = Math.min(maxPpm, Math.max(0.2, Math.min(ppmU, ppmR)));
    const cu = (minU + maxU) / 2 - 60 / this.ppm; // shift up for the HUD
    const cr = (minR + maxR) / 2;
    this.center = [this.up[0] * cu + right[0] * cr, this.up[1] * cu + right[1] * cr];
    this.updateCamera();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0);
    v.unproject(this.camera);
    return [v.x, v.y];
  }

  worldToScreen(p: Vec2): [number, number] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p[0], p[1], 0).project(this.camera);
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
  }

  panPixels(dx: number, dy: number): void {
    const right: Vec2 = [this.up[1], -this.up[0]];
    this.center = [
      this.center[0] - (right[0] * dx) / this.ppm + (this.up[0] * dy) / this.ppm,
      this.center[1] - (right[1] * dx) / this.ppm + (this.up[1] * dy) / this.ppm,
    ];
    this.updateCamera();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const w = this.screenToWorld(clientX, clientY);
    const next = Math.min(40, Math.max(0.2, this.ppm * factor));
    const f = next / this.ppm;
    this.ppm = next;
    this.center = [w[0] + (this.center[0] - w[0]) / f, w[1] + (this.center[1] - w[1]) / f];
    this.updateCamera();
  }

  /** Ball positions; `z` lifts the ball toward screen-up and grows it, the shadow stays on the ground. */
  setBall(i: number, p: Vec3 | null, active: boolean): void {
    const g = this.balls[i];
    g.visible = p !== null;
    if (!p) return;
    g.position.set(p[0], p[1], OVERLAY_Z + (active ? 1 : 0.5));
    const { ball, shadow } = g.userData as { ball: THREE.Object3D; shadow: THREE.Object3D };
    const lift = Math.max(0, p[2]);
    // Offsets are in the group's pixel units; convert meters → pixels.
    const liftPx = lift * 0.35 * this.ppm;
    ball.position.set(0, liftPx, 0.1);
    ball.scale.setScalar(1 + lift / 30);
    shadow.visible = lift > 0.05;
  }

  setAim(from: Vec2 | null, to: Vec2, radius: number, color: string): void {
    this.aimLine.visible = this.aimRing.visible = from !== null;
    if (!from) return;
    this.aimLine.geometry.dispose();
    this.aimLine.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from[0], from[1], OVERLAY_Z), new THREE.Vector3(to[0], to[1], OVERLAY_Z),
    ]);
    this.aimLine.computeLineDistances();
    this.aimMat.color.set(color);
    (this.aimRing.material as THREE.LineBasicMaterial).color.set(color);
    this.aimRing.position.set(to[0], to[1], OVERLAY_Z);
    this.aimRing.scale.setScalar(Math.max(radius, 1.5));
  }

  addTrail(samples: Vec3[], color: string): void {
    const pts = samples.map((s) => new THREE.Vector3(s[0], s[1], OVERLAY_Z - 0.1));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false }));
    line.renderOrder = 8;
    this.trails.add(line);
  }

  clearTrails(): void {
    for (const c of [...this.trails.children]) {
      this.trails.remove(c);
      (c as THREE.Line).geometry.dispose();
    }
  }

  render(): void {
    const s = 1 / this.ppm;
    for (const o of this.pixelScaled) o.scale.set(s, s, 1);
    // Pixel-scaled groups use local +y as screen-up: rotate them to match the camera.
    const rot = Math.atan2(this.up[1], this.up[0]) - Math.PI / 2;
    for (const o of this.pixelScaled) o.rotation.z = rot;
    this.aimMat.dashSize = 8 / this.ppm;
    this.aimMat.gapSize = 6 / this.ppm;
    this.renderer.render(this.scene, this.camera);
  }

  private size() {
    return { w: this.container.clientWidth, h: this.container.clientHeight };
  }

  private resize(): void {
    const { w, h } = this.size();
    this.renderer.setSize(w, h);
    this.updateCamera();
  }

  private updateCamera(): void {
    const { w, h } = this.size();
    const hw = w / 2 / this.ppm;
    const hh = h / 2 / this.ppm;
    Object.assign(this.camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.camera.position.set(this.center[0], this.center[1], 1000);
    this.camera.up.set(this.up[0], this.up[1], 0);
    this.camera.lookAt(this.center[0], this.center[1], 0);
    this.camera.updateProjectionMatrix();
  }

  private groundPlane(canvas: HTMLCanvasElement, b: [Vec2, Vec2], z: number, order: number): THREE.Mesh {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const w = b[1][0] - b[0][0];
    const h = b[1][1] - b[0][1];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: order > 0 }));
    m.position.set(b[0][0] + w / 2, b[0][1] + h / 2, z);
    m.renderOrder = order;
    this.scene.add(m);
    return m;
  }

  private addOverlay(o: THREE.Object3D, order: number): void {
    o.renderOrder = order;
    o.traverse((c) => {
      c.renderOrder = order;
      const mat = (c as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) { mat.depthTest = false; mat.transparent = true; }
    });
    this.scene.add(o);
  }
}

function basic(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}

function disc(r: number, color: string, opacity = 1): THREE.Mesh {
  return new THREE.Mesh(new THREE.CircleGeometry(r, 24), basic(color, opacity));
}

function ring(r0: number, r1: number, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.RingGeometry(r0, r1, 24), basic(color));
}

function triangle(...xy: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([xy[0], xy[1], 0, xy[2], xy[3], 0, xy[4], xy[5], 0], 3));
  return g;
}
