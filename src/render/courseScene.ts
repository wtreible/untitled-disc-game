// Disc golf renderer: the whole course in one scene, two cameras.
//  - Top-down: orthographic, rotated so the current hole plays up the screen (same idea as HoleScene).
//  - First person: perspective camera at the thrower's eyes, used for putting (and on demand).
// Overlays (pixel-sized markers, aim line) only show top-down; 3D trees, baskets and discs show in
// first person, and trees also show in the top-down class view (the photo already has real trees).
import * as THREE from 'three';
import type { DiscCourseFile, DiscHole, Tree } from '../course/disc-types';
import type { Vec2 } from '../course/geo';
import type { SurfaceGrid } from '../game/surfaces';
import type { Vec3 } from '../game/terrain';
import { classCanvas } from './classTexture';
import { basketModel, discMesh, treeMeshes } from './disc3d';
import type { ViewMode } from './scene';
import type { Imagery } from './tiles';

const OVERLAY_Z = 30; // above the tallest crowns, so top-down overlays aren't hidden by trees
const EYE = 1.65;

export class CourseScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  private readonly persp = new THREE.PerspectiveCamera(62, 1, 0.05, 2000);
  private fp = false;
  private center: Vec2 = [0, 0];
  private ppm = 2;
  up: Vec2 = [0, 1];

  private photo?: THREE.Mesh;
  private readonly classes: THREE.Mesh;
  private readonly overlayPlane: THREE.Mesh;
  private view: ViewMode = 'photo';
  private readonly trees3d: THREE.Group;
  private readonly overlays = new THREE.Group();
  private readonly world3d = new THREE.Group();
  private readonly pixelScaled: THREE.Object3D[] = [];
  private readonly teeMarker: THREE.Group;
  private readonly basketMarker: THREE.Group;
  private readonly discMarkers: THREE.Group[] = [];
  private readonly discs3d: THREE.Mesh[] = [];
  private readonly aimLine: THREE.Line;
  private readonly aimMat: THREE.LineDashedMaterial;
  private readonly preview: THREE.Line;
  private readonly previewMat: THREE.LineDashedMaterial;
  private readonly trails = new THREE.Group();

  constructor(private readonly container: HTMLElement, course: DiscCourseFile, grid: SurfaceGrid, trees: Tree[], playerColors: string[]) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight('#dfeaff', '#4a5a3a', 1.6));
    const sun = new THREE.DirectionalLight('#fff6e0', 1.6);
    sun.position.set(-150, -100, 300);
    this.scene.add(sun);
    this.persp.up.set(0, 0, 1);

    const gridMax: Vec2 = [grid.min[0] + grid.cols * grid.cell, grid.min[1] + grid.rows * grid.cell];
    this.classes = this.groundPlane(classCanvas(grid, [0, 1]), [grid.min, gridMax], 0.01, 1);
    this.overlayPlane = this.groundPlane(classCanvas(grid, [0, 1], 110), [grid.min, gridMax], 0.02, 2);
    this.classes.visible = false;
    this.overlayPlane.visible = false;

    this.trees3d = treeMeshes(trees);
    this.world3d.add(this.trees3d);
    for (const h of course.holes) {
      const b = basketModel();
      b.position.set(h.pin[0], h.pin[1], 0);
      this.world3d.add(b);
      // Tee pad.
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshLambertMaterial({ color: '#9a9488' }));
      const [a, c] = [h.routing[0], h.routing[1] ?? h.pin];
      pad.rotation.z = Math.atan2(c[1] - a[1], c[0] - a[0]);
      pad.position.set(h.tee[0], h.tee[1], 0.03);
      this.world3d.add(pad);
    }
    this.scene.add(this.world3d);

    // Top-down markers, in pixel units.
    this.teeMarker = new THREE.Group();
    this.teeMarker.add(rect(14, 8, '#d8d2c4'), rectOutline(14, 8, '#222222'));
    this.basketMarker = new THREE.Group();
    this.basketMarker.add(disc2d(9, '#222222'), disc2d(7, '#f2c230'), disc2d(3, '#9aa1a8'));
    for (const m of [this.teeMarker, this.basketMarker]) { this.pixelScaled.push(m); this.overlays.add(m); }

    for (const color of playerColors) {
      const g = new THREE.Group();
      const shadow = disc2d(5, '#000000', 0.4);
      const body = new THREE.Group();
      body.add(disc2d(6.5, '#111111'), disc2d(5, color));
      g.add(shadow, body);
      g.userData = { shadow, body };
      g.visible = false;
      this.discMarkers.push(g);
      this.pixelScaled.push(g);
      this.overlays.add(g);
      const d3 = discMesh(color);
      d3.visible = false;
      this.discs3d.push(d3);
      this.scene.add(d3);
    }

    this.aimMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 4, gapSize: 3, transparent: true, opacity: 0.6, depthTest: false });
    this.aimLine = new THREE.Line(new THREE.BufferGeometry(), this.aimMat);
    this.previewMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 4, gapSize: 3, transparent: true, depthTest: false });
    this.preview = new THREE.Line(new THREE.BufferGeometry(), this.previewMat);
    this.overlays.add(this.aimLine, this.trails);
    this.scene.add(this.preview);
    this.overlays.traverse((o) => {
      o.renderOrder = 10;
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) { mat.depthTest = false; mat.transparent = true; }
    });
    this.preview.renderOrder = 11;
    this.scene.add(this.overlays);

    this.applyVisibility();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------- configuration ----------

  setImagery(img: Imagery, offset: Vec2): void {
    if (this.photo) this.scene.remove(this.photo);
    const b: [Vec2, Vec2] = [[img.bounds[0][0] + offset[0], img.bounds[0][1] + offset[1]], [img.bounds[1][0] + offset[0], img.bounds[1][1] + offset[1]]];
    this.photo = this.groundPlane(img.canvas, b, 0, 0);
    this.applyVisibility();
  }

  setView(mode: ViewMode): void {
    this.view = mode;
    this.applyVisibility();
  }

  get viewMode(): ViewMode {
    return this.view;
  }

  get firstPerson(): boolean {
    return this.fp;
  }

  setHole(h: DiscHole): void {
    const [a, b] = [h.tee, h.pin];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    this.up = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    this.teeMarker.position.set(h.tee[0], h.tee[1], OVERLAY_Z);
    this.basketMarker.position.set(h.pin[0], h.pin[1], OVERLAY_Z);
    this.updateOrtho();
  }

  private applyVisibility(): void {
    const v = this.view;
    if (this.photo) this.photo.visible = v !== 'classes';
    this.classes.visible = v === 'classes' || !this.photo;
    this.overlayPlane.visible = v === 'overlay' && !this.fp;
    this.overlays.visible = !this.fp;
    // Trees: always in first person; top-down only in the class view (the photo shows real ones).
    this.trees3d.visible = this.fp || v === 'classes' || !this.photo;
    for (const c of this.world3d.children) if (c !== this.trees3d) c.visible = this.fp;
    this.scene.background = new THREE.Color(this.fp ? '#a9c8e8' : '#1d2419');
    this.scene.fog = this.fp ? new THREE.Fog('#a9c8e8', 60, 420) : null;
  }

  // ---------- cameras ----------

  setFirstPerson(on: boolean): void {
    this.fp = on;
    this.applyVisibility();
  }

  /** Place the first-person eye at `at`, looking along yaw (CCW from +x) and pitch (up +). */
  setEye(at: Vec2, yaw: number, pitch: number): void {
    this.persp.position.set(at[0] - Math.cos(yaw) * 0.6, at[1] - Math.sin(yaw) * 0.6, EYE);
    const d = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    this.persp.lookAt(this.persp.position.clone().add(d));
  }

  /** Fit points on screen (top-down). */
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
    const ppmU = (h - 2 * pad - 150) / Math.max(1, maxU - minU);
    const ppmR = (w - 2 * pad) / Math.max(1, maxR - minR);
    this.ppm = Math.min(maxPpm, Math.max(0.2, Math.min(ppmU, ppmR)));
    const cu = (minU + maxU) / 2 - 65 / this.ppm;
    const cr = (minR + maxR) / 2;
    this.center = [this.up[0] * cu + right[0] * cr, this.up[1] * cu + right[1] * cr];
    this.updateOrtho();
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0);
    v.unproject(this.ortho);
    return [v.x, v.y];
  }

  panPixels(dx: number, dy: number): void {
    const right: Vec2 = [this.up[1], -this.up[0]];
    this.center = [
      this.center[0] - (right[0] * dx) / this.ppm + (this.up[0] * dy) / this.ppm,
      this.center[1] - (right[1] * dx) / this.ppm + (this.up[1] * dy) / this.ppm,
    ];
    this.updateOrtho();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    const w = this.screenToWorld(clientX, clientY);
    const next = Math.min(40, Math.max(0.2, this.ppm * factor));
    const f = next / this.ppm;
    this.ppm = next;
    this.center = [w[0] + (this.center[0] - w[0]) / f, w[1] + (this.center[1] - w[1]) / f];
    this.updateOrtho();
  }

  // ---------- dynamic objects ----------

  setDisc(i: number, p: Vec3 | null, bank: number, heading: number, active: boolean): void {
    const g = this.discMarkers[i];
    const d3 = this.discs3d[i];
    g.visible = p !== null;
    d3.visible = p !== null && this.fp;
    if (!p) return;
    g.position.set(p[0], p[1], OVERLAY_Z + (active ? 2 : 1));
    const { body, shadow } = g.userData as { body: THREE.Object3D; shadow: THREE.Object3D };
    const lift = Math.max(0, p[2] - 0.05);
    body.position.set(0, lift * 0.35 * this.ppm, 0.1);
    body.scale.setScalar(1 + lift / 25);
    shadow.visible = lift > 0.3;
    d3.position.set(p[0], p[1], Math.max(p[2], 0.012));
    // Tilt: bank about the direction of travel.
    d3.rotation.set(0, 0, 0);
    d3.rotateZ(heading);
    d3.rotateX(-bank);
  }

  setAim(from: Vec2 | null, to: Vec2, color: string): void {
    this.aimLine.visible = from !== null;
    if (!from) return;
    this.aimLine.geometry.dispose();
    this.aimLine.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from[0], from[1], OVERLAY_Z), new THREE.Vector3(to[0], to[1], OVERLAY_Z)]);
    this.aimLine.computeLineDistances();
    this.aimMat.color.set(color);
  }

  /** Ghost flight path. Top-down it's drawn flat above everything; in first person at true height. */
  setPreview(samples: Vec3[] | null, color: string): void {
    this.preview.visible = samples !== null && samples.length > 1;
    if (!samples || samples.length < 2) return;
    this.preview.geometry.dispose();
    const pts = samples.filter((_, i) => i % 2 === 0).map((s) => new THREE.Vector3(s[0], s[1], this.fp ? s[2] : OVERLAY_Z + 1));
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.preview.computeLineDistances();
    this.previewMat.color.set(color);
    this.previewMat.opacity = this.fp ? 0.5 : 0.9;
  }

  addTrail(samples: Vec3[], color: string): void {
    const pts = samples.map((s) => new THREE.Vector3(s[0], s[1], OVERLAY_Z - 1));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false }));
    line.renderOrder = 9;
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
    const rot = Math.atan2(this.up[1], this.up[0]) - Math.PI / 2;
    for (const o of this.pixelScaled) { o.scale.set(s, s, 1); o.rotation.z = rot; }
    const dash = this.fp ? 0.25 : 8 / this.ppm;
    this.aimMat.dashSize = this.previewMat.dashSize = dash;
    this.aimMat.gapSize = this.previewMat.gapSize = dash * 0.7;
    this.renderer.render(this.scene, this.fp ? this.persp : this.ortho);
  }

  // ---------- internals ----------

  private size() {
    return { w: this.container.clientWidth, h: this.container.clientHeight };
  }

  private resize(): void {
    const { w, h } = this.size();
    this.renderer.setSize(w, h);
    this.persp.aspect = w / Math.max(1, h);
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }

  private updateOrtho(): void {
    const { w, h } = this.size();
    const hw = w / 2 / this.ppm;
    const hh = h / 2 / this.ppm;
    Object.assign(this.ortho, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.ortho.position.set(this.center[0], this.center[1], 1000);
    this.ortho.up.set(this.up[0], this.up[1], 0);
    this.ortho.lookAt(this.center[0], this.center[1], 0);
    this.ortho.updateProjectionMatrix();
  }

  private groundPlane(canvas: HTMLCanvasElement, b: [Vec2, Vec2], z: number, order: number): THREE.Mesh {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const w = b[1][0] - b[0][0];
    const h = b[1][1] - b[0][1];
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: order > 0, depthWrite: order === 0 }));
    m.position.set(b[0][0] + w / 2, b[0][1] + h / 2, z);
    m.renderOrder = order;
    this.scene.add(m);
    return m;
  }
}

function basic(color: string, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}

function disc2d(r: number, color: string, opacity = 1): THREE.Mesh {
  return new THREE.Mesh(new THREE.CircleGeometry(r, 24), basic(color, opacity));
}

function rect(w: number, h: number, color: string): THREE.Mesh {
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(color));
}

function rectOutline(w: number, h: number, color: string): THREE.LineLoop {
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => new THREE.Vector3(x, y, 0.1));
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, depthTest: false }));
}
