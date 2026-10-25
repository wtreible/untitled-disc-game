// Disc golf renderer: the whole course in one scene, two cameras.
//  - Top-down: orthographic, rotated so the current hole plays up the screen (same idea as HoleScene).
//  - First person: perspective camera at the thrower's eyes, used for putting (and on demand).
// Overlays (pixel-sized markers, aim line) only show top-down; 3D trees, baskets and discs show in
// first person, and trees also show in the top-down class view (the photo already has real trees).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { asset } from '../assets';
import type { DiscCourseFile, DiscHole, Tree, TreeMix } from '../course/disc-types';
import type { Vec2 } from '../course/geo';
import type { SurfaceGrid } from '../game/surfaces';
import { HeightmapTerrain, type Terrain, type Vec3 } from '../game/terrain';
import { classCanvas, waterCanvas } from './classTexture';
import { hillshadeBounds, hillshadeCanvas } from './hillshade';
import { groundAt, setGround } from './ground';
import { basketModel, discMesh, lockTreeLod, setTreeQuality, setTreeSolidity, setTreesVisible, tickTrees, treeMeshes, updateTreeLod, type TreeQuality } from './disc3d';
import { BASKET } from '../disc/flight';
import type { ViewMode } from './scene';
import type { Imagery } from './tiles';
import { treeSymbols, vectorCanvas, vectorGround } from './vectorCourse';
import type { PropsView } from './props';
import { bladeAngle, hingeAngle, slideOffset, type Collider } from '../disc/props';
import type { Weather } from './weather';

const OVERLAY_Z = 30;
/** Default replay chase offset: 2.5 m back and 1.2 m up, as distance + elevation. */
const CHASE_DIST = Math.hypot(2.5, 1.2);
const CHASE_ELEV = Math.atan2(1.2, 2.5); // above the tallest crowns, so top-down overlays aren't hidden by trees
const EYE = 1.65;

/** A see-through disc: Clone Disc's twin, the ghost disc. */
type FadedDisc = { d3: THREE.Mesh; mark: THREE.Group };
/** The ghost disc's color (pale blue-white, unlike any player's). */
const GHOST_COLOR = '#cfe8ff';

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
  /** OSM water drawn see-through over the photo. */
  private readonly waterPlane?: THREE.Mesh;
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
  /** Real ground: arrows on the green pointing downhill, longer where it's steeper (null: flat course). */
  private readonly slopeArrows: THREE.InstancedMesh | null = null;
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
  /** The course's tree models, for placed trees too. */
  private readonly treeMix?: TreeMix;
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
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  /** Multiplies the unlit ground (weather and time of day). */
  private groundTint = new THREE.Color('#ffffff');
  /** Camera moves eased over a moment instead of cutting: first person (eye) or top-down (center, zoom). */
  private eyeGlide: { p: THREE.Vector3; q: THREE.Quaternion; to: { p: THREE.Vector3; q: THREE.Quaternion }; t0: number; dur: number } | null = null;
  private mapGlide: { center: Vec2; ppm: number; to: { center: Vec2; ppm: number }; t0: number; dur: number } | null = null;
  /** When the current basket's chains were last hit (ms), for the shake. */
  private chainHit = -Infinity;

  /** The course has real ground: the ground planes are draped over it. */
  private readonly relief: boolean;

  constructor(private readonly container: HTMLElement, course: DiscCourseFile, grid: SurfaceGrid, trees: Tree[], playerColors: string[], terrain: Terrain | null = null) {
    setGround(terrain);
    this.relief = !!terrain;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.localClippingEnabled = true; // sunk props are clipped at ground level
    container.appendChild(this.renderer.domElement);

    this.hemi = new THREE.HemisphereLight('#dfeaff', '#4a5a3a', 1.6);
    this.sun = new THREE.DirectionalLight('#fff6e0', 1.6);
    this.sun.position.set(-150, -100, 300);
    this.scene.add(this.hemi, this.sun);
    this.persp.up.set(0, 0, 1);

    this.style = course.style ?? 'photo';
    if (this.style === 'vector') {
      if (this.relief) {
        // On real ground the drawn course is painted into a texture and draped over the hills.
        const [min, max] = course.bounds, pad = 400;
        const b: [Vec2, Vec2] = [[min[0] - pad, min[1] - pad], [max[0] + pad, max[1] + pad]];
        this.vector = new THREE.Group();
        this.vector.add(this.groundPlane(vectorCanvas(course, b, 2.5), b, 0, 0));
      } else this.vector = vectorGround(course);
      this.scene.add(this.vector);
      this.symbols = treeSymbols(trees, OVERLAY_Z - 5);
      this.scene.add(this.symbols);
    } else {
      const gridMax: Vec2 = [grid.min[0] + grid.cols * grid.cell, grid.min[1] + grid.rows * grid.cell];
      this.classes = this.groundPlane(classCanvas(grid, [0, 1]), [grid.min, gridMax], 0.01, 1);
      this.overlayPlane = this.groundPlane(classCanvas(grid, [0, 1], 110), [grid.min, gridMax], 0.02, 2);
      this.waterPlane = this.groundPlane(waterCanvas(grid), [grid.min, gridMax], 0.015, 1);
      this.classes.visible = false;
      this.overlayPlane.visible = false;
      this.waterPlane.visible = false;
    }

    if (terrain instanceof HeightmapTerrain) this.groundPlane(hillshadeCanvas(terrain), hillshadeBounds(terrain), 0.03, 4, true);

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
    if (this.relief) {
      this.slopeArrows = new THREE.InstancedMesh(arrowGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }), SLOPE_GRID.length);
      this.slopeArrows.renderOrder = 5;
      this.slopeArrows.frustumCulled = false;
      this.scene.add(this.slopeArrows);
    }
    this.placePreview.renderOrder = 12;
    this.scene.add(this.placePreview, this.spread);

    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
    ring.name = 'ring';
    this.targetMat = new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.6, gapSize: 0.5, transparent: true, opacity: 0.7, depthWrite: false });
    this.targetLine = new THREE.Line(new THREE.BufferGeometry(), this.targetMat);
    this.target3d.add(ring, this.targetLine);
    this.target3d.visible = false;
    this.scene.add(this.target3d);

    const sky = course.sky ?? (this.style === 'vector' ? '#bcd9f2' : '#a9c8e8');
    this.skyColor = new THREE.Color(sky);
    this.groundColor = new THREE.Color(course.palette?.outside ?? (this.style === 'vector' ? '#3c4a37' : '#1d2419'));
    this.fog = new THREE.Fog(sky, 80, 520);
    if (course.stars) this.scene.add(skyStars(course));

    // Trees that a themed course draws as 3D models (props) aren't drawn again as generic trees.
    const modelTrees = new Set((course.props ?? []).filter((p) => p.tree !== undefined).map((p) => trees[p.tree!]));
    trees = trees.filter((t) => !modelTrees.has(t));
    this.treeMix = course.tree_models;
    this.trees3d = treeMeshes(trees, this.treeMix);
    this.world3d.add(this.trees3d);
    this.baseTrees = trees;
    trees.forEach((t, i) => this.treeIdx.set(t, i));
    this.holes = course.holes;
    for (const h of course.holes) {
      const b = basketModel();
      b.position.set(h.pin[0], h.pin[1], groundAt(h.pin[0], h.pin[1]));
      this.baskets.push(b);
      this.world3d.add(b);
      // Tee pad.
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), new THREE.MeshLambertMaterial({ color: '#9a9488' }));
      const [a, c] = [h.routing[0], h.routing[1] ?? h.pin];
      // Turned down the hole, then tilted to lie on the slope.
      pad.quaternion.copy(onSlope(h.tee, Math.atan2(c[1] - a[1], c[0] - a[0]), terrain));
      pad.position.set(h.tee[0], h.tee[1], groundAt(h.tee[0], h.tee[1]) + 0.05);
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
    this.tintGround();
    this.applyVisibility();
  }

  /** Light, sky, fog and ground tint for the round's weather and time of day. */
  setWeather(w: Weather): void {
    this.skyColor.set(w.sky);
    this.fog.color.set(w.sky);
    this.weatherFog = [w.fog[0], w.fog[1]];
    this.applyFog();
    this.hemi.color.set(w.hemi[0]);
    this.hemi.groundColor.set(w.hemi[1]);
    this.hemi.intensity = w.hemi[2];
    this.sun.color.set(w.sun[0]);
    this.sun.intensity = w.sun[1];
    // Same compass direction as before (from the south-west), at the weather's height.
    const az = Math.atan2(-100, -150), el = w.sun[2];
    this.sun.position.set(Math.cos(el) * Math.cos(az) * 360, Math.cos(el) * Math.sin(az) * 360, Math.sin(el) * 360);
    this.groundTint.set(w.ground);
    this.tintGround();
    this.applyVisibility();
  }

  private tintGround(): void {
    const meshes: THREE.Mesh[] = [];
    for (const m of [this.photo, this.classes, this.waterPlane, this.vector]) m?.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      const mat = m.material as THREE.MeshBasicMaterial;
      if (!mat.color) continue;
      mat.userData.base ??= mat.color.clone();
      mat.color.copy(mat.userData.base as THREE.Color).multiply(this.groundTint);
    }
  }

  /** Add something drawn with the course (spectators, effects, ambient life). */
  addObject(o: THREE.Object3D): void {
    this.scene.add(o);
  }

  /** First person: where the eye is (null top-down). */
  eye(): Vec3 | null {
    return this.fp ? [this.persp.position.x, this.persp.position.y, this.persp.position.z] : null;
  }

  /** The current basket's chains take a hit: they swing and settle. On the range, the basket at `at`. */
  shakeChains(at?: Vec2): void {
    this.chainHit = performance.now();
    this.shaking = at ? this.rangeBaskets.find((b) => Math.hypot(b.position.x - at[0], b.position.y - at[1]) < 1) ?? null : null;
  }

  // ---------- driving range: any number of baskets, added and removed at will ----------
  private readonly rangeBaskets: THREE.Group[] = [];
  private readonly rangeBasketMarkers: THREE.Group[] = [];
  private shaking: THREE.Group | null = null;

  /** Replace the holes' own baskets with these (the first call takes the holes' away). */
  setBaskets(pins: Vec2[]): void {
    for (const b of this.baskets) this.world3d.remove(b);
    this.overlays.remove(this.basketMarker);
    for (const b of this.rangeBaskets.splice(0)) this.world3d.remove(b);
    for (const m of this.rangeBasketMarkers.splice(0)) {
      this.overlays.remove(m);
      this.pixelScaled.splice(this.pixelScaled.indexOf(m), 1);
    }
    for (const p of pins) {
      const b = basketModel();
      b.position.set(p[0], p[1], groundAt(p[0], p[1]));
      b.visible = this.fp;
      this.rangeBaskets.push(b);
      this.world3d.add(b);
      const m = new THREE.Group();
      m.add(disc2d(9, '#222222'), disc2d(7, '#f2c230'), disc2d(3, '#9aa1a8'));
      m.position.set(p[0], p[1], OVERLAY_Z);
      m.traverse((o) => { o.renderOrder = 10; });
      this.rangeBasketMarkers.push(m);
      this.pixelScaled.push(m);
      this.overlays.add(m);
    }
    this.shaking = null;
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
    this.beacon.position.set(h.pin[0], h.pin[1], groundAt(h.pin[0], h.pin[1]) + 1.6 + 8);
    this.placeSlopeArrows(h.pin);
    this.updateOrtho();
  }

  /**
   * Lay the slope arrows out around the basket at p: on the ground, pointing downhill, as long as
   * the slope is steep (none where it's under 1%). A putt breaks the way they point.
   */
  private placeSlopeArrows(p: Vec2): void {
    const im = this.slopeArrows;
    if (!im) return;
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), at = new THREE.Vector3();
    SLOPE_GRID.forEach(([dx, dy], i) => {
      const x = p[0] + dx, y = p[1] + dy;
      const n = this.terrainNormal(x, y);
      const grade = Math.hypot(n[0], n[1]) / n[2];
      const k = grade < 0.01 ? 0 : Math.min(1, 0.45 + grade * 9);
      at.set(x, y, groundAt(x, y) + 0.06);
      s.set(k, k, 1);
      m.compose(at, onSlope([x, y], Math.atan2(n[1], n[0]), null, n), s);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  }

  /** The ground's normal at x, y (from neighbouring heights; up on a flat course). */
  private terrainNormal(x: number, y: number): Vec3 {
    const d = 1;
    const gx = (groundAt(x + d, y) - groundAt(x - d, y)) / (2 * d), gy = (groundAt(x, y + d) - groundAt(x, y - d)) / (2 * d);
    const l = Math.hypot(gx, gy, 1);
    return [-gx / l, -gy / l, 1 / l];
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
      this.waterPlane!.visible = !!this.photo?.visible && !this.overlayPlane!.visible;
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
  setEye(at: Vec2, yaw: number, pitch: number, glide = false): void {
    const from = { p: this.persp.position.clone(), q: this.persp.quaternion.clone() };
    this.persp.position.set(at[0] - Math.cos(yaw) * 0.6, at[1] - Math.sin(yaw) * 0.6, groundAt(at[0], at[1]) + EYE);
    this.beacon.visible = this.fp && Math.hypot(at[0] - this.beaconAt[0], at[1] - this.beaconAt[1]) > 15;
    const d = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch));
    this.persp.lookAt(this.persp.position.clone().add(d));
    // Easing toward the new eye (a glide started, or one under way whose end moved, e.g. looking about).
    const to = { p: this.persp.position.clone(), q: this.persp.quaternion.clone() };
    if (glide) {
      const far = from.p.distanceTo(to.p);
      this.eyeGlide = far > 0.3 || from.q.angleTo(to.q) > 0.05 ? { ...from, to, t0: performance.now(), dur: Math.min(1600, 550 + far * 25) } : null;
    } else if (this.eyeGlide) this.eyeGlide.to = to;
    if (this.eyeGlide) { this.persp.position.copy(from.p); this.persp.quaternion.copy(from.q); }
  }

  /** The camera is still easing to a new view (first person or top-down). */
  get gliding(): boolean {
    return !!this.eyeGlide || !!this.mapGlide;
  }

  /** Hole intro flyover: put the camera at `pos` looking at `look`. */
  flyCam(pos: Vec3, look: Vec3): void {
    this.eyeGlide = null;
    this.persp.position.set(pos[0], pos[1], pos[2]);
    this.persp.lookAt(look[0], look[1], look[2]);
    this.beacon.visible = Math.hypot(pos[0] - this.beaconAt[0], pos[1] - this.beaconAt[1]) > 15;
  }

  /** First-person: keep the eye where it is and turn toward a world point (e.g. the disc in flight). */
  lookToward(p: Vec3, smoothing = 0.15): void {
    this.eyeGlide = null;
    const cur = new THREE.Vector3();
    this.persp.getWorldDirection(cur);
    const want = new THREE.Vector3(p[0], p[1], p[2]).sub(this.persp.position).normalize();
    cur.lerp(want, smoothing).normalize();
    this.persp.lookAt(this.persp.position.clone().add(cur));
  }

  private quality: TreeQuality = 'high';
  /** Graphics setting: pixel density and model trees (src/render/disc3d.ts). */
  setGraphics(q: TreeQuality): void {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    this.resize();
    for (const g of [this.trees3d, ...(this.extras.children as THREE.Group[])]) setTreeQuality(g, q);
  }

  /**
   * Big forests: lock the model trees to a throw's flight path while it's followed, or (`flyover`)
   * to a hole flyover's path (null releases).
   */
  lockTrees(path: Vec2[] | null, flyover = false): void {
    for (const g of [this.trees3d, ...(this.extras.children as THREE.Group[])]) lockTreeLod(g, path, flyover);
  }

  /** World angle (CCW from +x) that points up the screen: the look direction in first person. */
  viewHeading(): number {
    if (!this.fp) return Math.atan2(this.up[1], this.up[0]);
    const d = this.persp.getWorldDirection(new THREE.Vector3());
    return Math.atan2(d.y, d.x);
  }

  /** Themed props (models). Visible in every view; model trees follow per-player visibility. */
  private props?: PropsView;
  attachProps(v: PropsView): void {
    this.props = v;
    this.scene.add(v.group);
    if (this.lastViewer) this.setViewer(this.lastViewer);
  }

  updateProps(t: number, dt: number): void {
    this.props?.update(t, dt);
    this.updateColliderDebug(t);
  }

  // ?debug=colliders: magenta wireframes of every prop collider (moving ones follow the clock).
  private debugBlades: { line: THREE.LineSegments; c: Extract<Collider, { kind: 'blades' }> }[] = [];
  private debugMovers: ((t: number) => void)[] = [];
  showColliders(colliders: Collider[], parent: THREE.Object3D = this.scene): void {
    const mat = new THREE.LineBasicMaterial({ color: '#ff2bd6' });
    for (const c of colliders) {
      if (c.kind === 'blades') {
        const line = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
        this.debugBlades.push({ line, c });
        parent.add(line);
        continue;
      }
      if (c.kind === 'slide') {
        const g = new THREE.Group();
        parent.add(g);
        this.showColliders(c.parts, g);
        this.debugMovers.push((t) => { const o = slideOffset(c.slide, t); g.position.set(o[0], o[1], 0); });
        continue;
      }
      if (c.kind === 'hinge') {
        // Pivot at the hinge, plank standing up along local z; tipped toward local +y.
        const pivot = new THREE.Group();
        pivot.position.set(c.c[0], c.c[1], 0);
        pivot.rotation.z = c.yaw;
        const plank = new THREE.Group();
        const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(c.hx * 2, c.halfThick * 2, c.len)), mat);
        m.position.z = c.len / 2;
        plank.add(m);
        pivot.add(plank);
        parent.add(pivot);
        this.debugMovers.push((t) => { plank.rotation.x = -hingeAngle(c.swing, t); });
        continue;
      }
      const geo = c.kind === 'cyl'
        ? new THREE.CylinderGeometry(c.r, c.r, c.z1 - c.z0, 20, 1, true).rotateX(Math.PI / 2)
        : new THREE.BoxGeometry(c.hx * 2, c.hy * 2, c.z1 - c.z0);
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(geo), mat);
      m.position.set(c.c[0], c.c[1], (c.z0 + c.z1) / 2);
      if (c.kind === 'box') m.rotation.z = c.yaw;
      parent.add(m);
    }
  }

  private updateColliderDebug(t: number): void {
    for (const f of this.debugMovers) f(t);
    for (const { line, c } of this.debugBlades) {
      const a = bladeAngle(c, t);
      const X = new THREE.Vector3(Math.cos(c.yaw), Math.sin(c.yaw), 0);
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        const th = Math.PI / 4 + (i * Math.PI) / 2 + a;
        const hub = new THREE.Vector3(...c.hub);
        pts.push(hub, hub.clone().addScaledVector(X, Math.cos(th) * c.radius).add(new THREE.Vector3(0, 0, Math.sin(th) * c.radius)));
      }
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
  }

  private lastViewer?: Parameters<CourseScene['setViewer']>[0];

  /**
   * Show the course as one player plays it: which base trees exist for them, trees planted
   * against them, their ponds, their basket size and position, and their magnet radius.
   */
  setViewer(v: { trees: Set<Tree>; extras: Tree[]; ponds: { c: Vec2; r: number }[]; basketScale: number; magnet: number; tee: Vec2; pin: Vec2; fx?: FieldFx }): void {
    this.lastViewer = v;
    this.setFieldFx(v.fx ?? {}, v.pin, v.basketScale);
    setTreesVisible(this.trees3d, (i) => v.trees.has(this.baseTrees[i]));
    if (this.props) for (const [t, obj] of this.props.treeObjects) obj.visible = v.trees.has(t);
    // Placed trees: rebuilt each time (a handful at most).
    for (const c of [...this.extras.children]) this.extras.remove(c);
    if (v.extras.length) { const g = treeMeshes(v.extras, this.treeMix); setTreeQuality(g, this.quality); this.extras.add(g); }
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
      m.position.set(p.c[0], p.c[1], groundAt(p.c[0], p.c[1]) + 0.035);
      m.renderOrder = -9;
      this.ponds.add(m);
    }
    for (const b of this.baskets) b.scale.set(v.basketScale, v.basketScale, 1);
    this.basketMarker.userData.scale = v.basketScale;
    this.teeMarker.position.set(v.tee[0], v.tee[1], OVERLAY_Z);
    this.magnetRing.visible = v.magnet > 0;
    this.magnetRing.scale.setScalar(Math.max(0.01, v.magnet));
    this.moveBasket(v.pin);
  }

  /**
   * Put the viewer's basket at p, and everything that goes with it (its marker, the beacon, the
   * magnet ring, and the augment looks on it). Moving Basket calls this every frame.
   */
  moveBasket(p: Vec2): void {
    const cur = this.baskets[this.holeIndex];
    const z = groundAt(p[0], p[1]);
    if (cur) cur.position.set(p[0], p[1], z);
    this.basketMarker.position.set(p[0], p[1], OVERLAY_Z);
    this.beaconAt = p;
    this.beacon.position.set(p[0], p[1], z + 1.6 + 8);
    this.magnetRing.position.set(p[0], p[1], z + 0.06);
    this.fxPin.position.set(p[0], p[1], z);
    this.placeSlopeArrows(p);
  }

  /** Fog of War: see only this far (m); null clears it back to the weather's own fog. */
  setFogLimit(r: number | null): void {
    this.fogLimit = r;
    this.applyFog();
  }
  private fogLimit: number | null = null;
  private weatherFog: [number, number] = [80, 520];
  private applyFog(): void {
    [this.fog.near, this.fog.far] = this.fogLimit ? [this.fogLimit * 0.3, this.fogLimit] : this.weatherFog;
  }

  /** Earthquake: shake the camera for this long (s). */
  shake(seconds: number): void {
    this.shakeUntil = performance.now() + seconds * 1000;
  }
  private shakeUntil = 0;

  /** Bridge Builder: plank bridges over the water on the viewer's line (none: []). */
  setBridges(spans: { a: Vec2; b: Vec2; half: number }[]): void {
    for (const c of [...this.bridges.children]) { this.bridges.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    if (!this.bridges.parent) this.scene.add(this.bridges);
    for (const s of spans) {
      const L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), yaw = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      const n = Math.max(1, Math.round(L / 0.6));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n, x = s.a[0] + (s.b[0] - s.a[0]) * f, y = s.a[1] + (s.b[1] - s.a[1]) * f;
        const plank = new THREE.Mesh(new THREE.BoxGeometry(0.5, s.half * 2, 0.12), BRIDGE_WOOD[k % 2]);
        plank.position.set(x, y, groundAt(x, y) + 0.18);
        plank.rotation.z = yaw;
        this.bridges.add(plank);
      }
      // Rails along both sides.
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.12, 0.12), BRIDGE_WOOD[0]);
        const mid: Vec2 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
        rail.position.set(mid[0] - Math.sin(yaw) * side * s.half, mid[1] + Math.cos(yaw) * side * s.half, groundAt(mid[0], mid[1]) + 0.9);
        rail.rotation.z = yaw;
        this.bridges.add(rail);
      }
    }
  }
  private readonly bridges = new THREE.Group();

  /** Basket Buddy: the monkey hops (it just nudged a disc in). */
  buddyHop(): void {
    this.hopAt = performance.now();
  }
  private hopAt = 0;

  // ---------- legendary augments you can see (Crazy mode) ----------
  private readonly fx = new THREE.Group();
  /** The augment looks that sit on the basket, moved with it (moveBasket). */
  private readonly fxPin = new THREE.Group();
  private fxSpot?: THREE.Group;
  private fxBuddy?: THREE.Group;
  private buddyLoading = false;
  private fxMagnet?: THREE.Group;
  private fxVortex?: THREE.Group;
  private fxGimme?: THREE.Mesh;
  private readonly stumps = new THREE.Group();
  private readonly golden = new Set<number>();

  /** The viewer's own legendary effects, drawn on their basket and course. */
  private setFieldFx(f: FieldFx, pin: Vec2, basketScale: number): void {
    if (!this.fx.parent) this.scene.add(this.fx, this.stumps);
    if (!this.fxPin.parent) this.fx.add(this.fxPin);
    this.fxPin.position.set(pin[0], pin[1], 0);
    const top = BASKET.bandTop * 1 + 0.05;
    if (f.magnet && !this.fxMagnet) this.fxMagnet = magnetModel();
    if (this.fxMagnet) {
      this.fxMagnet.visible = !!f.magnet;
      this.fxMagnet.position.set(0, 0, top + 0.45);
      if (!this.fxMagnet.parent) this.fxPin.add(this.fxMagnet);
    }
    if (f.blackHole && !this.fxVortex) this.fxVortex = vortexModel();
    if (this.fxVortex) {
      this.fxVortex.visible = !!f.blackHole;
      this.fxVortex.position.set(0, 0, (BASKET.trayTop + BASKET.chainTop) / 2);
      this.fxVortex.scale.setScalar(basketScale);
      if (!this.fxVortex.parent) this.fxPin.add(this.fxVortex);
    }
    if (f.gimme && !this.fxGimme) {
      this.fxGimme = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 96), new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
      this.fxGimme.renderOrder = 3;
      this.fxPin.add(this.fxGimme);
    }
    if (this.fxGimme) {
      this.fxGimme.visible = (f.gimme ?? 0) > 0;
      this.fxGimme.position.set(0, 0, 0.07);
      this.fxGimme.scale.setScalar(Math.max(0.01, f.gimme ?? 0));
    }
    if (f.spotlight && !this.fxSpot) { this.fxSpot = spotlightModel(); this.fxPin.add(this.fxSpot); }
    if (this.fxSpot) this.fxSpot.visible = !!f.spotlight;
    if (f.buddy && !this.fxBuddy && !this.buddyLoading) {
      // A monkey (Kenney Cube Pets) sitting on the band, looking down the hole.
      this.buddyLoading = true;
      new GLTFLoader().loadAsync(asset('models/pets/animal-monkey.glb')).then((g) => {
        const m = new THREE.Group();
        const inner = g.scene;
        inner.rotation.x = Math.PI / 2;
        inner.scale.setScalar(0.42);
        m.add(inner);
        m.position.set(0, 0, BASKET.bandTop + 0.02);
        this.fxBuddy = m;
        this.fxPin.add(m);
        m.visible = !!this.lastViewer?.fx?.buddy;
      }).catch(() => { this.buddyLoading = false; });
    }
    if (this.fxBuddy) this.fxBuddy.visible = !!f.buddy;
    setTreeSolidity(f.phase ? 0.35 : 1);
  }

  /** Lumberjack: stumps where cut trees stood (for everyone). */
  setStumps(trees: Tree[]): void {
    for (const c of [...this.stumps.children]) this.stumps.remove(c);
    if (!this.stumps.parent) this.scene.add(this.stumps);
    const mat = new THREE.MeshLambertMaterial({ color: '#7a5a3c' });
    for (const t of trees) {
      const r = Math.max(0.15, t.t * 1.3);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r, 0.45, 10).rotateX(Math.PI / 2), mat);
      m.position.set(t.x, t.y, groundAt(t.x, t.y) + 0.22);
      this.stumps.add(m);
    }
  }

  /** Golden Arm: this player's disc is gold. */
  setDiscGold(i: number, on: boolean): void {
    if (on === this.golden.has(i)) return;
    if (on) this.golden.add(i); else this.golden.delete(i);
    const m = this.discs3d[i]?.material as THREE.MeshLambertMaterial | undefined;
    if (!m) return;
    if (!m.userData.base) m.userData.base = m.color.clone();
    m.color.copy(on ? new THREE.Color('#ffc83d') : (m.userData.base as THREE.Color));
    m.emissive.set(on ? '#7a5200' : '#000000');
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
    ring.position.set(to[0], to[1], groundAt(to[0], to[1]) + 0.04);
    (ring.material as THREE.MeshBasicMaterial).color.set(color);
    this.targetLine.geometry.dispose();
    // Along the ground: a straight line would cut through the hills between.
    const pts = Array.from({ length: 33 }, (_, k) => { const x = from[0] + (to[0] - from[0]) * (k / 32), y = from[1] + (to[1] - from[1]) * (k / 32); return new THREE.Vector3(x, y, groundAt(x, y) + 0.05); });
    this.targetLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
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
  /**
   * Player orbit around the disc during replays: yaw offset from "behind the disc", elevation
   * angle, and distance. Drag/scroll change it; it carries over between replays (R resets).
   */
  readonly orbit = { yaw: 0, elev: CHASE_ELEV, dist: CHASE_DIST };

  resetOrbit(): void {
    Object.assign(this.orbit, { yaw: 0, elev: CHASE_ELEV, dist: CHASE_DIST });
  }

  chase(p: Vec3, heading: number, reset = false, dt = 1 / 60): void {
    this.eyeGlide = null;
    // Eased follow, frame-rate independent. The default offset is 2.5 m back, 1.2 m up; the
    // easing lag adds ~2 m on a fast disc, so the camera rides ~4–5 m behind.
    const { yaw, elev, dist } = this.orbit;
    const h = heading + yaw;
    const flat = dist * Math.cos(elev);
    const wx = p[0] - Math.cos(h) * flat, wy = p[1] - Math.sin(h) * flat;
    const want = new THREE.Vector3(wx, wy, Math.max(groundAt(wx, wy) + 0.5, p[2] + dist * Math.sin(elev)));
    if (reset) {
      // The replay has its own lens; the player's scroll zoom is restored by endChase().
      this.savedFov = this.persp.fov;
      this.persp.fov = 55;
      this.persp.updateProjectionMatrix();
      this.persp.position.copy(want);
    } else {
      // ≈ 0.15 per frame at 60 fps. Snapping harder (0.3) shook; softer (0.12) trailed ~8 m back.
      this.persp.position.lerp(want, 1 - Math.exp(-dt * 9.75));
    }
    this.persp.lookAt(p[0], p[1], p[2]);
    this.beacon.visible = Math.hypot(p[0] - this.beaconAt[0], p[1] - this.beaconAt[1]) > 15;
  }

  /** Field of view from settings (scroll zoom adjusts from here). */
  setFov(deg: number): void {
    if (this.savedFov !== null) { this.savedFov = deg; return; } // mid-replay: apply after it
    this.persp.fov = deg;
    this.persp.updateProjectionMatrix();
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
  frame(points: Vec2[], pad = 80, maxPpm = 12, glide = false): void {
    const from = { center: this.center, ppm: this.ppm };
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
    this.mapGlide = glide ? { ...from, to: { center: this.center, ppm: this.ppm }, t0: performance.now(), dur: 700 } : null;
    if (this.mapGlide) { this.center = from.center; this.ppm = from.ppm; }
    this.updateOrtho();
  }

  /** Advance camera glides (render calls this). */
  private stepGlides(now: number): void {
    const ease = (t: number) => t * t * (3 - 2 * t);
    const g = this.eyeGlide;
    if (g) {
      const k = ease(Math.min(1, (now - g.t0) / g.dur));
      this.persp.position.lerpVectors(g.p, g.to.p, k);
      this.persp.quaternion.slerpQuaternions(g.q, g.to.q, k);
      if (k >= 1) this.eyeGlide = null;
    }
    const m = this.mapGlide;
    if (m) {
      const k = ease(Math.min(1, (now - m.t0) / m.dur));
      this.center = [m.center[0] + (m.to.center[0] - m.center[0]) * k, m.center[1] + (m.to.center[1] - m.center[1]) * k];
      this.ppm = m.ppm * Math.pow(m.to.ppm / m.ppm, k);
      this.updateOrtho();
      if (k >= 1) this.mapGlide = null;
    }
  }

  screenToWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1, 0);
    v.unproject(this.ortho);
    return [v.x, v.y];
  }

  /**
   * World point → client pixels in the current view (first person or top-down). `behind`: behind
   * the first-person camera, where x and y mean nothing.
   */
  project(p: Vec3): { x: number; y: number; behind: boolean } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.fp ? this.persp : this.ortho);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: this.fp && v.z > 1 };
  }

  /** Top-down: world point → client pixels. */
  worldToScreen(p: Vec2): [number, number] {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3(p[0], p[1], 0).project(this.ortho);
    return [rect.left + ((v.x + 1) / 2) * rect.width, rect.top + ((1 - v.y) / 2) * rect.height];
  }

  panPixels(dx: number, dy: number): void {
    this.endMapGlide();
    const right: Vec2 = [this.up[1], -this.up[0]];
    this.center = [
      this.center[0] - (right[0] * dx) / this.ppm + (this.up[0] * dy) / this.ppm,
      this.center[1] - (right[1] * dx) / this.ppm + (this.up[1] * dy) / this.ppm,
    ];
    this.updateOrtho();
  }

  zoomAt(clientX: number, clientY: number, factor: number): void {
    this.endMapGlide();
    const w = this.screenToWorld(clientX, clientY);
    const next = Math.min(40, Math.max(0.2, this.ppm * factor));
    const f = next / this.ppm;
    this.ppm = next;
    this.center = [w[0] + (this.center[0] - w[0]) / f, w[1] + (this.center[1] - w[1]) / f];
    this.updateOrtho();
  }

  /** The player took over the map: jump to where the glide was going. */
  private endMapGlide(): void {
    if (!this.mapGlide) return;
    ({ center: this.center, ppm: this.ppm } = this.mapGlide.to);
    this.mapGlide = null;
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
    d3.position.set(p[0], p[1], Math.max(p[2], groundAt(p[0], p[1]) + 0.012));
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

  /** A throw's top-down trail. A fainter one (Clone Disc's other throw) belongs to the next trail added. */
  addTrail(samples: Vec3[], color: string, opacity = 0.7): void {
    const pts = samples.map((s) => new THREE.Vector3(s[0], s[1], OVERLAY_Z - 1));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }));
    line.renderOrder = 9;
    line.userData.twin = opacity < 0.7;
    this.trails.add(line);
  }

  /** Remove the most recent throw's trail, and its Clone Disc twin (mulligan). */
  popTrail(): void {
    const last = () => this.trails.children[this.trails.children.length - 1] as THREE.Line | undefined;
    let c = last();
    if (c) { this.trails.remove(c); c.geometry.dispose(); }
    c = last();
    if (c?.userData.twin) { this.trails.remove(c); c.geometry.dispose(); }
  }

  /** Clone Disc: the other throw's disc, see-through, in either view. */
  setTwin(p: Vec3 | null, color: string, heading = 0): void {
    this.twin ??= this.fadedDisc(0.45);
    this.placeFaded(this.twin, p, color, heading);
  }

  /** Ghost disc (Settings → Ghost disc): this browser's best tee shot on the hole, flying alongside. */
  setGhost(p: Vec3 | null, heading = 0): void {
    this.ghost ??= this.fadedDisc(0.3);
    this.placeFaded(this.ghost, p, GHOST_COLOR, heading);
  }

  private twin: FadedDisc | null = null;
  private ghost: FadedDisc | null = null;

  /** A see-through disc in first person, and a dot on the map. */
  private fadedDisc(opacity: number): FadedDisc {
    const d3 = discMesh('#ffffff');
    const m = d3.material as THREE.MeshLambertMaterial;
    m.transparent = true;
    m.opacity = opacity;
    m.depthWrite = false;
    const mark = new THREE.Group();
    mark.add(disc2d(6.5, '#111111', 0.4), disc2d(5, '#ffffff', 0.5));
    this.pixelScaled.push(mark);
    this.overlays.add(mark);
    this.scene.add(d3);
    return { d3, mark };
  }

  private placeFaded({ d3, mark }: FadedDisc, p: Vec3 | null, color: string, heading: number): void {
    d3.visible = p !== null && this.fp;
    d3.layers.set(this.fp ? 0 : 1);
    mark.visible = p !== null;
    if (!p) return;
    (d3.material as THREE.MeshLambertMaterial).color.set(color);
    for (const c of mark.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(c === mark.children[0] ? '#111111' : color);
    mark.position.set(p[0], p[1], OVERLAY_Z + 1.5);
    d3.position.set(p[0], p[1], Math.max(p[2], groundAt(p[0], p[1]) + 0.012));
    d3.scale.setScalar(Math.min(8, Math.max(1, Math.sqrt(this.persp.position.distanceTo(d3.position) / 3))));
    d3.rotation.set(0, 0, heading);
  }

  clearTrails(): void {
    for (const c of [...this.trails.children]) {
      this.trails.remove(c);
      (c as THREE.Line).geometry.dispose();
    }
  }

  render(): void {
    this.stepGlides(performance.now());
    this.swingChains(performance.now());
    // Legendary effects animate: the magnet bobs, the vortex spins.
    const tt = performance.now() / 1000;
    if (this.fxMagnet?.visible) { this.fxMagnet.rotation.z = tt * 0.8; this.fxMagnet.position.z = BASKET.bandTop + 0.5 + Math.sin(tt * 2.2) * 0.06; }
    if (this.fxVortex?.visible) this.fxVortex.rotation.z = -tt * 2.5;
    if (this.fxSpot?.visible) this.fxSpot.rotation.z = tt * 0.3;
    if (this.fxBuddy?.visible) {
      // The monkey looks about, and hops when it nudges a disc in.
      const hop = (performance.now() - this.hopAt) / 1000;
      this.fxBuddy.position.z = BASKET.bandTop + 0.02 + (hop < 0.6 ? Math.sin((hop / 0.6) * Math.PI) * 0.5 : 0);
      this.fxBuddy.rotation.z = Math.sin(tt * 0.7) * 0.9;
    }
    const groups = [this.trees3d, ...(this.extras.children as THREE.Group[])];
    if (this.fp) {
      // Big forests draw tree models only near the eye.
      const p = this.persp.position;
      for (const g of groups) updateTreeLod(g, p.x, p.y);
    }
    const now = performance.now();
    for (const g of groups) tickTrees(g, now); // blob ↔ model dissolves, in any view
    const rot = Math.atan2(this.up[1], this.up[0]) - Math.PI / 2;
    const scalePixels = (ppm: number) => {
      const k = 1 / ppm;
      for (const o of this.pixelScaled) { o.scale.set(k, k, 1); o.rotation.z = rot; }
      const dash = 8 / ppm;
      this.aimMat.dashSize = this.previewMat.dashSize = dash;
      this.aimMat.gapSize = this.previewMat.gapSize = dash * 0.7;
    };
    this.persp.layers.set(0);
    this.persp.layers.enable(SKY_LAYER);
    // Earthquake: the camera shakes (moved for this frame only).
    const shaking = now < this.shakeUntil;
    const cam = this.fp ? this.persp : this.ortho;
    const jolt = shaking ? new THREE.Vector3((Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.18) : null;
    if (jolt) cam.position.add(jolt);
    if (!this.fp) {
      scalePixels(this.ppm);
      this.ortho.layers.enableAll();
      this.ortho.layers.disable(1);
      this.ortho.layers.disable(SKY_LAYER);
      this.renderer.render(this.scene, this.ortho);
      if (jolt) cam.position.sub(jolt);
      return;
    }
    // First person, then the minimap inset drawn top-down over the bottom-left corner.
    this.previewMat.dashSize = 0.25;
    this.previewMat.gapSize = 0.18;
    this.renderer.render(this.scene, this.persp);
    if (jolt) cam.position.sub(jolt);
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

  /** A hit sets the current basket's chains swinging around the pole, dying out over ~1.5 s. */
  private swingChains(now: number): void {
    const chains = (this.shaking ?? this.baskets[this.holeIndex])?.children.at(-1);
    if (!chains) return;
    const t = (now - this.chainHit) / 1000;
    if (t > 1.8) { chains.rotation.set(0, 0, 0); return; }
    const a = Math.exp(-t * 2.6);
    chains.rotation.set(0.05 * a * Math.sin(t * 19), 0.05 * a * Math.cos(t * 23), 0.3 * a * Math.sin(t * 15));
  }

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

  /** A textured plane over b, draped on real ground. `multiply`: darkens what's under it (hillshade). */
  private groundPlane(canvas: HTMLCanvasElement, b: [Vec2, Vec2], z: number, order: number, multiply = false): THREE.Mesh {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const w = b[1][0] - b[0][0];
    const h = b[1][1] - b[0][1];
    // Real ground: a vertex every ~2.5 m, lifted onto the terrain (z then sits just above it).
    const seg = (n: number) => (this.relief ? Math.min(400, Math.max(1, Math.round(n / 2.5))) : 1);
    const geo = new THREE.PlaneGeometry(w, h, seg(w), seg(h));
    const cx = b[0][0] + w / 2, cy = b[0][1] + h / 2;
    if (this.relief) {
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, groundAt(cx + pos.getX(i), cy + pos.getY(i)));
      geo.computeBoundingSphere();
    }
    const mat = multiply
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false })
      : new THREE.MeshBasicMaterial({ map: tex, transparent: order > 0, depthWrite: order === 0 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(cx, cy, z);
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

/** Sky objects only the first-person camera sees (not top-down or the minimap). */
export const SKY_LAYER = 2;

/** A dome of stars around the course for first person (Rainbow Runs). */
function skyStars(course: DiscCourseFile): THREE.Points {
  const [min, max] = course.bounds;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const n = course.stars!;
  const pos = new Float32Array(n * 3);
  let seed = 11;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, el = Math.asin(rnd() * 1.1 - 0.1), r = 1200;
    pos.set([cx + r * Math.cos(el) * Math.cos(a), cy + r * Math.cos(el) * Math.sin(a), r * Math.sin(el)], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, fog: false }));
  p.layers.set(SKY_LAYER);
  return p;
}

/** A viewer's visible legendary effects (setViewer). */
export interface FieldFx {
  /** Magnet Basket: a horseshoe magnet over the basket. */
  magnet?: boolean;
  /** Black Hole: a dark vortex in the chains. */
  blackHole?: boolean;
  /** Gimme Circle: a gold ring on the ground at this radius (m). */
  gimme?: number;
  /** Phase Disc: see through every tree. */
  phase?: boolean;
  /** Spotlight: a beam of light on the basket. */
  spotlight?: boolean;
  /** Basket Buddy: a monkey sitting on the basket. */
  buddy?: boolean;
}

/** A red horseshoe magnet with silver tips, poles down (for the top of a basket). */
/** Bridge Builder's planks: two woods, alternating. */
const BRIDGE_WOOD = [new THREE.MeshLambertMaterial({ color: '#8a5a32' }), new THREE.MeshLambertMaterial({ color: '#9c6a3c' })];

/** Spotlight: a soft beam coming down on the basket, and its pool of light on the ground. */
function spotlightModel(): THREE.Group {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(2.4, 11, 32, 1, true),
    new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.rotation.x = Math.PI / 2; // the cone's tip (+y) up to +z, its wide end on the ground
  beam.position.z = 5.5;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.28, depthWrite: false }));
  pool.position.z = 0.05;
  pool.renderOrder = 2;
  g.add(beam, pool);
  return g;
}

function magnetModel(): THREE.Group {
  const g = new THREE.Group();
  const arm = new THREE.Group(); // built in the x–z plane, turned upright
  const red = new THREE.MeshLambertMaterial({ color: '#d9312b', emissive: '#3a0000' });
  const steel = new THREE.MeshLambertMaterial({ color: '#d7dde3' });
  const bend = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 10, 24, Math.PI), red);
  arm.add(bend);
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 12), red);
    leg.position.set(sx * 0.22, -0.11, 0);
    arm.add(leg);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.1, 12), steel);
    tip.position.set(sx * 0.22, -0.27, 0);
    arm.add(tip);
  }
  arm.rotation.x = Math.PI / 2; // y-up model → z-up world: the U opens downward onto the basket
  g.add(arm);
  return g;
}

/** A dark sphere wrapped in a spinning purple ring (Black Hole). */
function vortexModel(): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshBasicMaterial({ color: '#07030f' }));
  g.add(core);
  for (const [r, w, c] of [[0.28, 0.035, '#a35cff'], [0.4, 0.02, '#5b2bd6'], [0.52, 0.012, '#c69bff']] as const) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, w, 8, 48), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85 }));
    ring.rotation.x = (r - 0.28) * 0.9; // flat around the chains, each a little tilted
    g.add(ring);
  }
  return g;
}

/** Where the slope arrows go around a basket: a 2 m grid out to 10 m (circle 1), clear of the pole. */
const SLOPE_GRID: Vec2[] = (() => {
  const out: Vec2[] = [];
  for (let x = -10; x <= 10; x += 2) for (let y = -10; y <= 10; y += 2) if (Math.hypot(x, y) <= 10.5 && Math.hypot(x, y) > 1.5) out.push([x, y]);
  return out;
})();

/** A flat arrow 1 m long pointing along +x, a little off the ground. */
function arrowGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.45, -0.05); s.lineTo(0.15, -0.05); s.lineTo(0.15, -0.16); s.lineTo(0.45, 0); s.lineTo(0.15, 0.16); s.lineTo(0.15, 0.05); s.lineTo(-0.45, 0.05); s.closePath();
  return new THREE.ShapeGeometry(s);
}

/** Turned to `yaw` about the vertical, then tilted onto the ground at p (its normal, or the terrain's). */
function onSlope(p: Vec2, yaw: number, terrain: Terrain | null, normal?: Vec3): THREE.Quaternion {
  const n = normal ?? terrain?.normalAt(p[0], p[1]) ?? [0, 0, 1];
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n[0], n[1], n[2]));
  return tilt.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw));
}
