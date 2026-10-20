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
import { basketModel, discMesh, setTreesVisible, treeMeshes } from './disc3d';
import type { ViewMode } from './scene';
import type { Imagery } from './tiles';
import { treeSymbols, vectorGround } from './vectorCourse';

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
  private readonly classes?: THREE.Mesh;
  private readonly overlayPlane?: THREE.Mesh;
  /** 'vector': flat drawn ground + tree symbols, no imagery. */
  readonly style: 'photo' | 'vector';
  private readonly vector?: THREE.Group;
  private readonly symbols?: THREE.Group;
  private readonly beacon: THREE.Mesh;
  private beaconAt: Vec2 = [0, 0];
  // Per-viewer course (roguelike): which trees exist for the current player, placed trees,
  // ponds, basket size/position, magnet ring. See setViewer().
  private readonly baseTrees: Tree[];
  private readonly treeIdx = new Map<Tree, number>();
  private readonly holes: DiscHole[];
  private holeIndex = 0;
  private readonly baskets: THREE.Group[] = [];
  private readonly extras = new THREE.Group();
  private extraSymbols = new THREE.Group();
  private readonly ponds = new THREE.Group();
  private readonly magnetRing: THREE.LineLoop;
  private readonly placePreview = new THREE.Group();
  private readonly spread = new THREE.Group();
  // First-person extras: target ring + ground line, and a top-down minimap inset.
  private readonly target3d = new THREE.Group();
  private readonly targetLine: THREE.Line;
  private readonly targetMat: THREE.LineDashedMaterial;
  private readonly miniCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  private miniCenter: Vec2 = [0, 0];
  private miniPpm = 1;
  /** Minimap rect in CSS pixels from the bottom-left corner of the canvas. */
  readonly minimap = { x: 12, y: 12, w: 250, h: 250 };
  private readonly skyColor: THREE.Color;
  private readonly groundColor: THREE.Color;
  private readonly fog: THREE.Fog;
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

    this.style = course.style ?? 'photo';
    if (this.style === 'vector') {
      this.vector = vectorGround(course);
      this.scene.add(this.vector);
      this.symbols = treeSymbols(trees, OVERLAY_Z - 5);
      this.scene.add(this.symbols);
    } else {
      const gridMax: Vec2 = [grid.min[0] + grid.cols * grid.cell, grid.min[1] + grid.rows * grid.cell];
      this.classes = this.groundPlane(classCanvas(grid, [0, 1]), [grid.min, gridMax], 0.01, 1);
      this.overlayPlane = this.groundPlane(classCanvas(grid, [0, 1], 110), [grid.min, gridMax], 0.02, 2);
      this.classes.visible = false;
      this.overlayPlane.visible = false;
    }

    // First-person beacon over the current basket, so it can be found from the tee.
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 16, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.55, fog: false }));
    this.beacon.visible = false;
    this.scene.add(this.beacon);

    this.scene.add(this.extras, this.ponds);
    if (this.symbols) this.scene.add(this.extraSymbols);
    this.magnetRing = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2), Math.sin((i / 64) * Math.PI * 2), 0))),
      new THREE.LineBasicMaterial({ color: '#c58cff', transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.magnetRing.visible = false;
    this.magnetRing.renderOrder = 3;
    this.scene.add(this.magnetRing);
    this.placePreview.renderOrder = 12;
    this.scene.add(this.placePreview, this.spread);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.name = 'ring';
    this.targetMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.5, transparent: true, opacity: 0.7, depthWrite: false });
    this.targetLine = new THREE.Line(new THREE.BufferGeometry(), this.targetMat);
    this.target3d.add(ring, this.targetLine);
    this.target3d.visible = false;
    this.scene.add(this.target3d);

    const sky = this.style === 'vector' ? '#bcd9f2' : '#a9c8e8';
    this.skyColor = new THREE.Color(sky);
    this.groundColor = new THREE.Color(this.style === 'vector' ? '#3c4a37' : '#1d2419');
    this.fog = new THREE.Fog(sky, 80, 520);

    this.trees3d = treeMeshes(trees);
    this.world3d.add(this.trees3d);
    this.baseTrees = trees;
    trees.forEach((t, i) => this.treeIdx.set(t, i));
    this.holes = course.holes;
    for (const h of course.holes) {
      const b = basketModel();
      b.position.set(h.pin[0], h.pin[1], 0);
      this.baskets.push(b);
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
    this.holeIndex = Math.max(0, this.holes.indexOf(h));
    const [a, b] = [h.tee, h.pin];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    this.up = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    this.teeMarker.position.set(h.tee[0], h.tee[1], OVERLAY_Z);
    this.basketMarker.position.set(h.pin[0], h.pin[1], OVERLAY_Z);
    this.beaconAt = h.pin;
    this.beacon.position.set(h.pin[0], h.pin[1], 1.6 + 8);
    this.updateOrtho();
  }

  /** Show what one camera should see: first person (fp = true) or a top-down view. */
  private applyVisibility(fp = this.fp): void {
    const v = this.view;
    this.overlays.visible = !fp;
    if (this.style === 'vector') {
      // One drawn world: flat symbols from above, the same trees in 3D at eye level.
      this.symbols!.visible = !fp;
      this.trees3d.visible = fp;
    } else {
      if (this.photo) this.photo.visible = v !== 'classes';
      this.classes!.visible = v === 'classes' || !this.photo;
      this.overlayPlane!.visible = v === 'overlay' && !fp;
      // Trees: always in first person; top-down only in the class view (the photo shows real ones).
      this.trees3d.visible = fp || v === 'classes' || !this.photo;
    }
    for (const c of this.world3d.children) if (c !== this.trees3d) c.visible = fp;
    // Placed (roguelike) trees follow the same rule as the base trees.
    this.extras.visible = this.trees3d.visible;
    this.extraSymbols.visible = !fp && !!this.symbols?.visible;
    this.placePreview.visible = !fp;
    for (const d of this.discs3d) d.layers.set(fp ? 0 : 1); // hide 3D discs from top-down passes
    this.target3d.layers.set(fp ? 0 : 1);
    this.beacon.layers.set(fp ? 0 : 1);
    this.scene.background = fp ? this.skyColor : this.groundColor;
    this.scene.fog = fp ? this.fog : null;
  }

  // ---------- cameras ----------

  setFirstPerson(on: boolean): void {
    this.fp = on;
    if (!on) this.beacon.visible = false;
    this.applyVisibility();
  }

  /** Place the first-person eye at `at`, looking along yaw (CCW from +x) and pitch (up +). */
  setEye(at: Vec2, yaw: number, pitch: number): void {
    this.persp.position.set(at[0] - Math.cos(yaw) * 0.6, at[1] - Math.sin(yaw) * 0.6, EYE);
    this.beacon.visible = this.fp && Math.hypot(at[0] - this.beaconAt[0], at[1] - this.beaconAt[1]) > 15;
    const d = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    this.persp.lookAt(this.persp.position.clone().add(d));
  }

  /** First-person: keep the eye where it is and turn toward a world point (e.g. the disc in flight). */
  lookToward(p: Vec3, smoothing = 0.15): void {
    const cur = new THREE.Vector3();
    this.persp.getWorldDirection(cur);
    const want = new THREE.Vector3(p[0], p[1], p[2]).sub(this.persp.position).normalize();
    cur.lerp(want, smoothing).normalize();
    this.persp.lookAt(this.persp.position.clone().add(cur));
  }

  /**
   * Show the course as one player plays it: which base trees exist for them, trees planted
   * against them, their ponds, their basket size and position, and their magnet radius.
   */
  setViewer(v: { trees: Set<Tree>; extras: Tree[]; ponds: { c: Vec2; r: number }[]; basketScale: number; magnet: number; tee: Vec2; pin: Vec2 }): void {
    setTreesVisible(this.trees3d, (i) => v.trees.has(this.baseTrees[i]));
    // Placed trees: rebuilt each time (a handful at most).
    for (const c of [...this.extras.children]) this.extras.remove(c);
    if (v.extras.length) this.extras.add(treeMeshes(v.extras));
    if (this.symbols) {
      const rebuild = (g: THREE.Group, list: Tree[]) => {
        for (const c of [...g.children]) { g.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
        for (const c of [...treeSymbols(list, OVERLAY_Z - 5).children]) g.add(c);
      };
      rebuild(this.symbols, this.baseTrees.filter((t) => v.trees.has(t)));
      rebuild(this.extraSymbols, v.extras);
    }
    for (const c of [...this.ponds.children]) this.ponds.remove(c);
    for (const p of v.ponds) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(p.r, 32), new THREE.MeshBasicMaterial({ color: '#4f8fcf', depthWrite: false }));
      m.position.set(p.c[0], p.c[1], 0.035);
      m.renderOrder = -9;
      this.ponds.add(m);
    }
    for (const b of this.baskets) b.scale.set(v.basketScale, v.basketScale, 1);
    const cur = this.baskets[this.holeIndex];
    if (cur) cur.position.set(v.pin[0], v.pin[1], 0);
    this.basketMarker.position.set(v.pin[0], v.pin[1], OVERLAY_Z);
    this.basketMarker.userData.scale = v.basketScale;
    this.teeMarker.position.set(v.tee[0], v.tee[1], OVERLAY_Z);
    this.beaconAt = v.pin;
    this.beacon.position.set(v.pin[0], v.pin[1], 1.6 + 8);
    this.magnetRing.visible = v.magnet > 0;
    this.magnetRing.position.set(v.pin[0], v.pin[1], 0.06);
    this.magnetRing.scale.setScalar(Math.max(0.01, v.magnet));
  }

  /** Placement mode: rings for what's been placed so far (top-down), or null to clear. */
  setPlacementPreview(items: { at: Vec2; r: number; color: string }[] | null): void {
    for (const c of [...this.placePreview.children]) this.placePreview.remove(c);
    for (const it of items ?? []) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.2, it.r - 0.35), it.r, 32), new THREE.MeshBasicMaterial({ color: it.color, transparent: true, opacity: 0.9, depthTest: false }));
      ring.position.set(it.at[0], it.at[1], OVERLAY_Z + 3);
      ring.renderOrder = 12;
      this.placePreview.add(ring);
    }
  }

  /** First-person target: ring on the ground at `to`, dashed ground line from the thrower. */
  setTarget3d(from: Vec2 | null, to: Vec2, color: string): void {
    this.target3d.visible = from !== null;
    if (!from) return;
    const ring = this.target3d.getObjectByName('ring') as THREE.Mesh;
    ring.position.set(to[0], to[1], 0.04);
    (ring.material as THREE.MeshBasicMaterial).color.set(color);
    this.targetLine.geometry.dispose();
    this.targetLine.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from[0], from[1], 0.05), new THREE.Vector3(to[0], to[1], 0.05)]);
    this.targetLine.computeLineDistances();
    this.targetMat.color.set(color);
  }

  /** Hide the minimap inset (e.g. during replays). */
  minimapEnabled = true;
  private savedFov: number | null = null;

  /** Restore the player's field of view after a replay. */
  endChase(): void {
    if (this.savedFov !== null) {
      this.persp.fov = this.savedFov;
      this.persp.updateProjectionMatrix();
      this.savedFov = null;
    }
  }

  /**
   * Replay chase camera: behind and above the disc, looking at it. `heading` is the direction of
   * travel. Eased so bounces and tree kicks don't whip the camera around.
   */
  chase(p: Vec3, heading: number, reset = false): void {
    const back = 3.5, up = 1.2;
    const want = new THREE.Vector3(p[0] - Math.cos(heading) * back, p[1] - Math.sin(heading) * back, Math.max(1.0, p[2] + up));
    if (reset) {
      // The replay has its own lens; the player's scroll zoom is restored by endChase().
      this.savedFov = this.persp.fov;
      this.persp.fov = 55;
      this.persp.updateProjectionMatrix();
      this.persp.position.copy(want);
    } else {
      // Tight follow: at 0.12 the camera settled ~8 m back from a fast disc.
      this.persp.position.lerp(want, 0.3);
    }
    this.persp.lookAt(p[0], p[1], p[2]);
    this.beacon.visible = Math.hypot(p[0] - this.beaconAt[0], p[1] - this.beaconAt[1]) > 15;
  }

  /** First-person zoom: scroll changes the field of view. */
  zoomFov(factor: number): void {
    this.persp.fov = Math.min(105, Math.max(25, this.persp.fov * factor));
    this.persp.updateProjectionMatrix();
  }

  /** Frame the minimap on these points (current hole + players), hole pointing up. */
  setMinimapFrame(points: Vec2[], pad = 18): void {
    const right: Vec2 = [this.up[1], -this.up[0]];
    let minU = Infinity, maxU = -Infinity, minR = Infinity, maxR = -Infinity;
    for (const p of points) {
      const u = p[0] * this.up[0] + p[1] * this.up[1];
      const r = p[0] * right[0] + p[1] * right[1];
      minU = Math.min(minU, u); maxU = Math.max(maxU, u); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    }
    const { w, h } = this.minimap;
    this.miniPpm = Math.min(6, (h - 2 * pad) / Math.max(10, maxU - minU), (w - 2 * pad) / Math.max(10, maxR - minR));
    const cu = (minU + maxU) / 2, cr = (minR + maxR) / 2;
    this.miniCenter = [this.up[0] * cu + right[0] * cr, this.up[1] * cu + right[1] * cr];
    const hw = w / 2 / this.miniPpm, hh = h / 2 / this.miniPpm;
    Object.assign(this.miniCam, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.miniCam.position.set(this.miniCenter[0], this.miniCenter[1], 1000);
    this.miniCam.up.set(this.up[0], this.up[1], 0);
    this.miniCam.lookAt(this.miniCenter[0], this.miniCenter[1], 0);
    this.miniCam.updateProjectionMatrix();
  }

  /** Minimap click → world point, or null if outside the inset. */
  minimapToWorld(clientX: number, clientY: number): Vec2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { x, y, w, h } = this.minimap;
    const lx = clientX - rect.left - x;
    const ly = rect.bottom - clientY - y; // from the bottom
    if (!this.fp || lx < 0 || ly < 0 || lx > w || ly > h) return null;
    const v = new THREE.Vector3((lx / w) * 2 - 1, (ly / h) * 2 - 1, 0).unproject(this.miniCam);
    return [v.x, v.y];
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

  /** Top-down: world point → client pixels. */
  worldToScreen(p: Vec2): [number, number] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p[0], p[1], 0).project(this.ortho);
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
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
    // A real 21 cm disc is sub-pixel past ~20 m. Grow it with √distance so it still shrinks on
    // screen as it flies away (~40 px at 5 m, ~20 px at 20 m, ~9 px at 100 m) but stays trackable.
    // (Scaling linearly with distance kept it the same size on screen at any range.)
    d3.scale.setScalar(Math.min(8, Math.max(1, Math.sqrt(this.persp.position.distanceTo(d3.position) / 3))));
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
  setPreview(samples: Vec3[] | null, color: string, spread: Vec3[][] = []): void {
    // Oracle: faint lines for the ±1σ wobble spread.
    for (const c of [...this.spread.children]) { this.spread.remove(c); (c as THREE.Line).geometry.dispose(); }
    for (const sp of samples ? spread : []) {
      if (sp.length < 2) continue;
      const pts = sp.filter((_, i) => i % 3 === 0).map((q) => new THREE.Vector3(q[0], q[1], this.fp ? q[2] : OVERLAY_Z + 0.5));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthTest: false }));
      l.renderOrder = 11;
      this.spread.add(l);
    }
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

  /** Remove the most recent trail (mulligan). */
  popTrail(): void {
    const c = this.trails.children[this.trails.children.length - 1] as THREE.Line | undefined;
    if (c) { this.trails.remove(c); c.geometry.dispose(); }
  }

  clearTrails(): void {
    for (const c of [...this.trails.children]) {
      this.trails.remove(c);
      (c as THREE.Line).geometry.dispose();
    }
  }

  render(): void {
    const rot = Math.atan2(this.up[1], this.up[0]) - Math.PI / 2;
    const scalePixels = (ppm: number) => {
      const k = 1 / ppm;
      for (const o of this.pixelScaled) { o.scale.set(k, k, 1); o.rotation.z = rot; }
      const dash = 8 / ppm;
      this.aimMat.dashSize = this.previewMat.dashSize = dash;
      this.aimMat.gapSize = this.previewMat.gapSize = dash * 0.7;
    };
    this.persp.layers.set(0);
    if (!this.fp) {
      scalePixels(this.ppm);
      this.ortho.layers.enableAll();
      this.ortho.layers.disable(1);
      this.renderer.render(this.scene, this.ortho);
      return;
    }
    // First person, then the minimap inset drawn top-down over the bottom-left corner.
    this.previewMat.dashSize = 0.25;
    this.previewMat.gapSize = 0.18;
    this.renderer.render(this.scene, this.persp);
    if (!this.minimapEnabled) return;

    const { x, y, w, h } = this.minimap;
    const size = this.size();
    this.applyVisibility(false);
    scalePixels(this.miniPpm);
    this.miniCam.layers.set(0);
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(x, y, w, h);
    this.renderer.setViewport(x, y, w, h);
    this.renderer.setClearColor(this.groundColor, 1);
    this.renderer.clear(true, true, false);
    const bg = this.scene.background;
    this.scene.background = null;
    this.renderer.render(this.scene, this.miniCam);
    this.scene.background = bg;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.w, size.h);
    this.applyVisibility(true);
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
