// OSM + HSY canopy GeoJSON → DiscCourseFile. Pure (no I/O). See docs/08-level-editor-and-disc-golf.md.
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { LocalFrame, dist, distToPolyline, polylineLength, type Vec2 } from './geo';
import type { DiscCourseFile, DiscHole, Tree } from './disc-types';
import { encodeTrees } from './disc-types';
import type { CourseFeature, Rings } from './types';

type Props = Record<string, string | undefined>;

export interface CanopyLayer {
  /** Height class range in meters, e.g. [10, 15]; [20, 28] for "over 20 m". */
  range: [number, number];
  fc: FeatureCollection;
}

export interface DiscBuildOptions {
  courseOsmId: string; // "way/40254405" or "relation/18072611"
  osmTimestamp: string;
  attribution: string[];
  seed?: number;
  /** Playable corridor half-width around each hole line, added to the course polygon. */
  corridorM?: number;
  /**
   * 'canopy': plant a forest inside HSY canopy polygons (photo style): the real version.
   * 'recreation': the same real trees, thinned back from fairways, greens and tees (vector style).
   * 'osm': outside HSY's area: OSM's mapped trees where they stand, and its woods planted like
   * canopy (the canopy layers passed in are those woods).
   */
  trees?: 'canopy' | 'recreation' | 'osm';
  /**
   * A course mapped as a relation (type=disc_golf_course): its hole ways ("way/…") and name.
   * osmtogeojson drops such relations, so the caller reads them from the raw data.
   */
  holeIds?: string[];
  name?: string;
  margin?: number;
}

/** Tali Recreation's thinning: fairway half-width, green radius, and the gap kept beyond both. */
export const RECREATION = { fairwayHalf: 5, greenR: 6, clear: 3 };

const ROAD_HALF_WIDTH: Record<string, number> = {
  motorway: 12, motorway_link: 6, trunk: 10, trunk_link: 5, primary: 8, secondary: 7, tertiary: 6,
  residential: 4, unclassified: 4, service: 3, living_street: 3,
};

// Disc golf par estimate when OSM has no par tag (Tali has none). Rough PDGA-style length bands.
export function parFromLength(m: number): number {
  return m < 150 ? 3 : m < 240 ? 4 : 5;
}

function polygonsOf(g: Geometry): Position[][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function strip(pts: Vec2[], half: number): Rings[] {
  // Buffered polyline as quads per segment plus end circles; OR'ed together when rasterized.
  const out: Rings[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const L = dist(a, b) || 1;
    const nx = (-(b[1] - a[1]) / L) * half;
    const ny = ((b[0] - a[0]) / L) * half;
    out.push([[[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]]);
  }
  for (const p of pts) out.push([circle(p, half)]);
  return out;
}

function circle(c: Vec2, r: number, n = 16): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => [c[0] + r * Math.cos((i / n) * 2 * Math.PI), c[1] + r * Math.sin((i / n) * 2 * Math.PI)]);
}

/** Douglas–Peucker. HSY canopy polygons are pixel staircases; hole lines trace walking paths. Use minKeep = 2 for polylines. */
export function simplify(ring: Vec2[], tol: number, minKeep = 4): Vec2[] {
  if (ring.length < Math.max(3, minKeep + 1)) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    let best = -1, bestD = tol;
    const [a, b] = [ring[i0], ring[i1]];
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist(ring[i], a, b);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= minKeep ? out : ring;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  return distToPolyline(p, [a, b]);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Individual trees from canopy polygons: dart-throwing blue noise inside the canopy, spacing and
 * size from the height class. HSY says *where* canopy of a given height is, not where trunks are,
 * so trunk positions are plausible, not surveyed.
 */
export function plantTrees(
  canopy: { rings: Rings; range: [number, number] }[],
  bounds: [Vec2, Vec2],
  keepClear: { p: Vec2; r: number }[],
  seed: number,
  /** Fairway lanes: no trunks within `r` of the line; crowns reaching over it are limbed up to `lift` m. */
  lanes: { pts: Vec2[]; r: number; lift: number }[] = [],
): Tree[] {
  const rng = mulberry32(seed);
  const cell = 1;
  const cols = Math.ceil((bounds[1][0] - bounds[0][0]) / cell);
  const rows = Math.ceil((bounds[1][1] - bounds[0][1]) / cell);
  // Raster of class index + 1 (0 = no canopy). Taller classes overwrite shorter ones.
  const mask = new Uint8Array(cols * rows);
  const sorted = canopy.map((c, i) => ({ ...c, i })).sort((a, b) => a.range[0] - b.range[0]);
  for (const c of sorted) {
    rasterize(c.rings, bounds[0], cell, cols, rows, (k) => { mask[k] = c.i + 1; });
  }
  const spacing = (range: [number, number]) => (range[0] < 10 ? 3 : range[0] < 15 ? 4 : range[0] < 20 ? 5 : 6);

  const hashCell = 3;
  const buckets = new Map<number, Tree[]>();
  const key = (x: number, y: number) => Math.floor(x / hashCell) * 100003 + Math.floor(y / hashCell);
  const trees: Tree[] = [];
  const attempts = cols * rows * 1.5;
  for (let n = 0; n < attempts; n++) {
    const x = bounds[0][0] + rng() * (bounds[1][0] - bounds[0][0]);
    const y = bounds[0][1] + rng() * (bounds[1][1] - bounds[0][1]);
    const c = Math.floor((x - bounds[0][0]) / cell);
    const r = Math.floor((y - bounds[0][1]) / cell);
    const m = mask[r * cols + c];
    if (!m) continue;
    const range = canopy[m - 1].range;
    const s = spacing(range) * (0.85 + rng() * 0.3);
    if (keepClear.some((k) => Math.hypot(x - k.p[0], y - k.p[1]) < k.r)) continue;
    const laneD = lanes.length ? Math.min(...lanes.map((l) => distToPolyline([x, y], l.pts) - l.r)) : Infinity;
    if (laneD < 0) continue;
    let ok = true;
    for (let dx = -2; dx <= 2 && ok; dx++) {
      for (let dy = -2; dy <= 2 && ok; dy++) {
        for (const o of buckets.get(key(x + dx * hashCell, y + dy * hashCell)) ?? []) {
          if (Math.hypot(o.x - x, o.y - y) < (s + o.r / 0.55) / 2) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const h = range[0] + rng() * (range[1] - range[0]);
    const crownR = s * 0.55;
    // Young trees (< 10 m class) are bushy to the ground. Taller: a spruce/pine/birch mix, with
    // crowns starting at 25–55% of height.
    let b = range[0] < 10 ? 0.3 + rng() * 1.2 : h * (0.25 + rng() * 0.3);
    // Limbed up over fairways, as maintained courses are.
    if (laneD < crownR) b = Math.max(b, Math.min(h - 1, lanes[0]?.lift ?? 0));
    const tree: Tree = { x, y, h, r: crownR, b, t: 0.06 + 0.012 * h };
    trees.push(tree);
    const k = key(x, y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(tree);
  }
  return trees;
}

function rasterize(rings: Rings, min: Vec2, cell: number, cols: number, rows: number, visit: (k: number) => void): void {
  let minY = Infinity, maxY = -Infinity;
  for (const p of rings[0]) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const r0 = Math.max(0, Math.floor((minY - min[1]) / cell));
  const r1 = Math.min(rows - 1, Math.ceil((maxY - min[1]) / cell));
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = min[1] + (r + 0.5) * cell;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - min[0]) / cell - 0.5));
      const c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - min[0]) / cell - 0.5));
      for (let c = c0; c <= c1; c++) visit(r * cols + c);
    }
  }
}

/**
 * OSM natural=tree points as trees. Height and crown from the tags when mapped (height,
 * diameter_crown, circumference), else a plausible park tree; broadleaf crowns start higher than
 * conifers'. Random parts come from `seed`, so a rebuild plants the same trees.
 */
export function mappedTrees(feats: Feature<Geometry, Props>[], P: (p: Position) => Vec2, seed: number): Tree[] {
  const rng = mulberry32(seed ^ 0x5eed);
  const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n > 0 ? n : null; };
  return feats.filter((f) => f.properties.natural === 'tree' && f.geometry.type === 'Point').map((f) => {
    const t = f.properties;
    const [x, y] = P((f.geometry as { coordinates: Position }).coordinates);
    const conifer = t.leaf_type === 'needleleaved';
    const h = Math.min(35, num(t.height) ?? 8 + rng() * 8);
    const crown = num(t.diameter_crown);
    const r = Math.min(12, crown ? crown / 2 : h * (conifer ? 0.25 : 0.45) * (0.8 + rng() * 0.4));
    // Trunk from the circumference (m) when mapped.
    const girth = num(t.circumference);
    return { x, y, h, r, b: conifer ? 0.5 + rng() * 1.5 : h * (0.25 + rng() * 0.15), t: girth ? Math.min(1, girth / (2 * Math.PI)) : 0.08 + 0.014 * h };
  });
}

export function buildDiscCourse(osm: FeatureCollection, canopyLayers: CanopyLayer[], opts: DiscBuildOptions): DiscCourseFile {
  const feats = osm.features as Feature<Geometry, Props>[];
  // A course way is the playing area too; a relation has only its holes.
  const course = feats.find((f) => f.id === opts.courseOsmId);
  if (!course && !opts.holeIds) throw new Error(`Course ${opts.courseOsmId} not in input`);
  const holeSet = opts.holeIds ? new Set(opts.holeIds) : null;
  const corridor = opts.corridorM ?? 35;
  const margin = opts.margin ?? 40;

  const holeFeats = feats
    .filter((f) => f.properties.disc_golf === 'hole' && f.properties.ref && f.geometry.type === 'LineString' && (!holeSet || holeSet.has(String(f.id))))
    .sort((a, b) => parseInt(a.properties.ref!, 10) - parseInt(b.properties.ref!, 10));
  if (holeFeats.length === 0) throw new Error('No disc_golf=hole ways with a ref');

  // Course-wide frame centered on the hole lines.
  let sLat = 0, sLon = 0, n = 0;
  for (const h of holeFeats) for (const [lo, la] of (h.geometry as { coordinates: Position[] }).coordinates) { sLat += la; sLon += lo; n++; }
  const frame = new LocalFrame({ lat: sLat / n, lon: sLon / n });
  const P = ([lo, la]: Position): Vec2 => frame.toLocal(la, lo);
  const toRings = (poly: Position[][]): Rings => poly.map((r) => r.map(P));

  const points = (kind: string): Vec2[] =>
    feats.filter((f) => f.properties.disc_golf === kind).map((f) => {
      if (f.geometry.type === 'Point') return P(f.geometry.coordinates);
      const ring = polygonsOf(f.geometry)[0]?.[0] ?? (f.geometry.type === 'LineString' ? f.geometry.coordinates : []);
      const ps = ring.map(P);
      return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
    });
  const tees = points('tee');
  const baskets = points('basket');
  const nearest = (p: Vec2, set: Vec2[]) => set.reduce<{ p: Vec2 | null; d: number }>((b, q) => (dist(p, q) < b.d ? { p: q, d: dist(p, q) } : b), { p: null, d: Infinity });

  const holes: DiscHole[] = holeFeats.map((f) => {
    const routing = (f.geometry as { coordinates: Position[] }).coordinates.map(P);
    const warnings: string[] = [];
    const t = nearest(routing[0], tees);
    const b = nearest(routing[routing.length - 1], baskets);
    const tee = t.d < 8 ? t.p! : routing[0];
    const pin = b.d < 8 ? b.p! : routing[routing.length - 1];
    if (t.d >= 8) warnings.push(`no tee mapped at line start (nearest ${Math.round(t.d)} m); using line start`);
    if (b.d >= 8) warnings.push(`no basket mapped at line end (nearest ${Math.round(b.d)} m); using line end`);
    const length = polylineLength(routing);
    const parTag = parseInt(f.properties.par ?? '', 10);
    return {
      ref: f.properties.ref!, routing, tee, pin, length_m: length, warnings,
      par: Number.isFinite(parTag) ? parTag : parFromLength(length),
      par_source: Number.isFinite(parTag) ? 'osm' : 'length',
    };
  });

  // Bounds: all hole lines + corridor + margin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const h of holes) for (const p of h.routing) {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]); maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  }
  const pad = corridor + margin;
  const bounds: [Vec2, Vec2] = [[minX - pad, minY - pad], [maxX + pad, maxY + pad]];
  const inBounds = (p: Vec2) => p[0] >= bounds[0][0] && p[0] <= bounds[1][0] && p[1] >= bounds[0][1] && p[1] <= bounds[1][1];
  const touches = (rings: Rings) => rings[0].some(inBounds);

  const boundary: Rings[] = course ? polygonsOf(course.geometry).map(toRings) : [];
  for (const h of holes) boundary.push(...strip(h.routing, corridor));

  const features: CourseFeature[] = [];
  const ob: Rings[] = [];
  for (const f of feats) {
    const t = f.properties;
    const id = String(f.id);
    if (t.natural === 'water' || t.landuse === 'basin' || t.landuse === 'reservoir') {
      for (const poly of polygonsOf(f.geometry)) { const r = toRings(poly); if (touches(r)) features.push({ class: 'water', osm_id: id, rings: r }); }
    } else if ((t.waterway === 'stream' || t.waterway === 'ditch') && f.geometry.type === 'LineString') {
      const pts = f.geometry.coordinates.map(P);
      if (pts.some(inBounds)) for (const r of strip(pts, 1)) features.push({ class: 'water', osm_id: id, rings: r });
    } else if (t.highway && f.geometry.type === 'LineString') {
      const pts = f.geometry.coordinates.map(P);
      if (!pts.some(inBounds)) continue;
      const half = ROAD_HALF_WIDTH[t.highway];
      if (half) ob.push(...strip(pts, half));
      else if (['footway', 'path', 'cycleway', 'track', 'bridleway', 'steps'].includes(t.highway)) {
        for (const r of strip(pts, 1.2)) features.push({ class: 'path', osm_id: id, rings: r });
      }
    } else if (t.building || t.leisure === 'golf_course' || t.amenity === 'parking') {
      for (const poly of polygonsOf(f.geometry)) { const r = toRings(poly); if (touches(r)) ob.push(r); }
    }
  }
  // Tee pads: 1.5 × 3 m, long axis along the first leg.
  for (const h of holes) {
    const [a, b] = [h.routing[0], h.routing[1] ?? h.pin];
    const L = dist(a, b) || 1;
    const u: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const v: Vec2 = [-u[1], u[0]];
    const c = h.tee;
    const corner = (su: number, sv: number): Vec2 => [c[0] + u[0] * su + v[0] * sv, c[1] + u[1] * su + v[1] * sv];
    features.push({ class: 'tee', osm_id: `tee/${h.ref}`, rings: [[corner(-1, -0.75), corner(2, -0.75), corner(2, 0.75), corner(-1, 0.75)]] });
  }

  const canopy: { rings: Rings; height_m: number; range: [number, number] }[] = [];
  for (const layer of canopyLayers) {
    for (const f of layer.fc.features) {
      for (const poly of polygonsOf(f.geometry)) {
        const rings = toRings(poly).map((r) => simplify(r, 0.6));
        if (touches(rings)) canopy.push({ rings, height_m: layer.range[1], range: layer.range });
      }
    }
  }
  const recreation = opts.trees === 'recreation';
  // The real forest: trees planted in the HSY canopy. HSY can't tell an overhanging crown from a
  // trunk, so keep a lane along each hole line.
  const keepClear = holes.flatMap((h) => [{ p: h.tee, r: 3 }, { p: h.pin, r: 2 }]);
  const lanes = holes.map((h) => ({ pts: h.routing, r: 3, lift: 3.5 }));
  let trees = plantTrees(canopy, bounds, keepClear, opts.seed ?? 1, lanes);
  if (opts.trees === 'osm') {
    // Mapped trees stand where they're mapped; planted woods give way to them.
    const mapped = mappedTrees(feats, P, opts.seed ?? 1).filter((t) => inBounds([t.x, t.y]));
    for (const t of mapped) {
      // Limbed up over the hole lines, as for planted trees.
      if (holes.some((h) => distToPolyline([t.x, t.y], h.routing) < t.r)) t.b = Math.max(t.b, Math.min(t.h - 1, 3.5));
    }
    trees = [...trees.filter((t) => mapped.every((m) => Math.hypot(m.x - t.x, m.y - t.y) > (m.r + t.r) * 0.6)), ...mapped];
  }
  if (recreation) {
    // The easy version: mown fairways, drawn and used for lies, and the same real trees thinned
    // back so no crown comes within RECREATION.clear of a fairway, a green or a tee.
    const { fairwayHalf, greenR, clear } = RECREATION;
    for (const h of holes) for (const r of strip(h.routing, fairwayHalf)) features.push({ class: 'fairway', osm_id: `fairway/${h.ref}`, rings: r });
    trees = trees.filter((t) => holes.every((h) =>
      distToPolyline([t.x, t.y], h.routing) - t.r >= fairwayHalf + clear &&
      dist([t.x, t.y], h.pin) - t.r >= greenR + clear &&
      dist([t.x, t.y], h.tee) - t.r >= clear + 2));
  }

  return {
    sport: 'disc',
    style: recreation ? 'vector' : 'photo',
    branch_density: 0.11,
    name: opts.name ?? course?.properties.name ?? 'Disc golf course',
    source: { osm_timestamp: opts.osmTimestamp, course_osm_id: opts.courseOsmId, attribution: opts.attribution },
    origin: frame.origin,
    imagery_offset_m: [0, 0],
    bounds,
    boundary,
    features,
    // Recreation: lies come from the drawn ground, not the canopy (whose edges the thinning moved).
    canopy: recreation ? [] : canopy.map(({ rings, height_m }) => ({ rings, height_m })),
    ob,
    trees: encodeTrees(trees),
    holes,
  };
}
