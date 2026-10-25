// Flat "vector" course: ground drawn from the course polygons, one merged mesh per surface, plus
// 2D tree symbols with the same positions and crown radii as the 3D trees.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DiscCourseFile, Tree } from '../course/disc-types';
import type { Rings, SurfaceClass } from '../course/types';

export const VECTOR_COLORS = {
  outside: '#3c4a37',
  rough: '#6f9a4f',
  fairway: '#8cc063',
  path: '#c9b98f',
  water: '#4f8fcf',
  ob: '#8a8a82',
  tee: '#d8d2c4',
  crown: '#2f6a2f',
  crownEdge: '#1f4720',
  trunk: '#5b4632',
  shadow: '#000000',
};

function shapeOf(rings: Rings): THREE.Shape {
  const s = new THREE.Shape(rings[0].map(([x, y]) => new THREE.Vector2(x, y)));
  for (const hole of rings.slice(1)) s.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
  return s;
}

function merged(polys: Rings[]): THREE.BufferGeometry | null {
  const geos = polys.filter((r) => r[0]?.length >= 3).map((r) => new THREE.ShapeGeometry(shapeOf(r)));
  if (geos.length === 0) return null;
  const g = mergeGeometries(geos);
  geos.forEach((x) => x.dispose());
  return g;
}

/**
 * The same ground layers painted into a canvas over `b` (north up), for a course with real ground:
 * the scene drapes it over the hills like a photo. About `ppm` pixels a meter.
 */
export function vectorCanvas(course: DiscCourseFile, b: [[number, number], [number, number]], ppm: number): HTMLCanvasElement {
  const colors: Record<string, string> = { ...VECTOR_COLORS, ...(course.palette ?? {}) };
  const w = b[1][0] - b[0][0], h = b[1][1] - b[0][1];
  const k = Math.min(ppm, 4096 / w, 4096 / h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colors.outside;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const layers: [string, Rings[]][] = [['rough', course.boundary], ['path', byClass(course, 'path')], ['fairway', byClass(course, 'fairway')], ['water', byClass(course, 'water')], ['ob', course.ob], ['tee', byClass(course, 'tee')]];
  for (const [name, polys] of layers) {
    ctx.fillStyle = colors[name];
    for (const rings of polys) {
      ctx.beginPath();
      for (const ring of rings) ring.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo']((x - b[0][0]) * k, (b[1][1] - y) * k));
      ctx.fill('evenodd');
    }
  }
  return canvas;
}

/**
 * Ground layers in paint order. They're coplanar, so depth writes are off and renderOrder decides
 * stacking; everything 3D draws over them. Works for both cameras.
 */
export function vectorGround(course: DiscCourseFile): THREE.Group {
  const g = new THREE.Group();
  const colors: Record<string, string> = { ...VECTOR_COLORS, ...(course.palette ?? {}) };
  const [min, max] = course.bounds;
  const pad = 400;
  const layers: [string, Rings[]][] = [
    ['outside', [[[[min[0] - pad, min[1] - pad], [max[0] + pad, min[1] - pad], [max[0] + pad, max[1] + pad], [min[0] - pad, max[1] + pad]]]]],
    ['rough', course.boundary],
    ['path', byClass(course, 'path')],
    ['fairway', byClass(course, 'fairway')],
    ['water', byClass(course, 'water')],
    ['ob', course.ob],
    ['tee', byClass(course, 'tee')],
  ];
  const paint = (name: string, color: string, polys: Rings[], order: number) => {
    const geo = merged(polys);
    if (!geo) return;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthWrite: false }));
    m.renderOrder = order;
    m.name = name;
    g.add(m);
  };
  layers.forEach(([name, polys], i) => paint(name, colors[name], polys, -20 + i));
  (course.decals ?? []).forEach((d, i) => paint(`decal/${i}`, d.color, d.rings, -20 + layers.length + i));
  if (course.stars) g.add(groundStars(course, pad));
  return g;
}

/** Stars scattered over the void around the course; the road layers paint over them. */
function groundStars(course: DiscCourseFile, pad: number): THREE.Points {
  const [min, max] = course.bounds;
  const n = course.stars!;
  const pos = new Float32Array(n * 3);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    pos[i * 3] = min[0] - pad + rnd() * (max[0] - min[0] + 2 * pad);
    pos[i * 3 + 1] = min[1] - pad + rnd() * (max[1] - min[1] + 2 * pad);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 2, sizeAttenuation: false, depthWrite: false, transparent: true, opacity: 0.8 }));
  p.renderOrder = -19.5;
  return p;
}

function byClass(course: DiscCourseFile, c: SurfaceClass): Rings[] {
  return course.features.filter((f) => f.class === c).map((f) => f.rings);
}

/** Top-down tree symbols: soft shadow, crown disc with an edge ring, trunk dot. Sized in meters. */
export function treeSymbols(trees: Tree[], z: number): THREE.Group {
  const g = new THREE.Group();
  const make = (fn: (t: Tree) => THREE.BufferGeometry, color: string, order: number, opacity = 1) => {
    if (trees.length === 0) return;
    const geo = mergeGeometries(trees.map(fn));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
    m.renderOrder = order;
    m.position.z = z;
    g.add(m);
  };
  const circle = (x: number, y: number, r: number) => new THREE.CircleGeometry(r, 32).translate(x, y, 0);
  make((t) => circle(t.x + t.r * 0.25, t.y - t.r * 0.25, t.r), VECTOR_COLORS.shadow, 5, 0.22);
  make((t) => circle(t.x, t.y, t.r), VECTOR_COLORS.crownEdge, 6);
  make((t) => circle(t.x, t.y, Math.max(0.3, t.r - 0.3)), VECTOR_COLORS.crown, 7);
  make((t) => circle(t.x, t.y, Math.max(0.25, t.t * 1.6)), VECTOR_COLORS.trunk, 8);
  return g;
}
