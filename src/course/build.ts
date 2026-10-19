// OSM GeoJSON → CourseFile. Pure (no I/O) so it can run offline or in the browser.
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { LocalFrame, distToPolyline, pointInRings, polylineLength, ringCentroid, type Vec2 } from './geo';
import type { CourseFeature, CourseFile, CourseHole, Rings, SurfaceClass, TreeFeature } from './types';

type Props = Record<string, string | undefined>;

export interface BuildOptions {
  courseOsmId: string; // e.g. "way/29870415"
  holeRef: string;
  links?: string;
  osmTimestamp: string;
  /** Features farther than this from the routing line are dropped. */
  corridorM?: number;
  /** Extra margin around included features for the imagery / grid bounds. */
  marginM?: number;
  defaultTreeHeightM?: number;
  /** Radius for single-node trees. */
  treeNodeRadiusM?: number;
}

export function classifyTags(t: Props): SurfaceClass | null {
  switch (t.golf) {
    case 'tee': return 'tee';
    case 'fairway': return 'fairway';
    case 'green': return 'green';
    case 'rough': return 'rough';
    case 'bunker': return 'bunker';
    case 'water_hazard':
    case 'lateral_water_hazard': return 'water';
    case 'cartpath':
    case 'path': return 'path';
  }
  if (t.natural === 'water') return 'water';
  if (t.natural === 'wood' || t.natural === 'tree_row' || t.natural === 'tree' || t.landuse === 'forest') return 'trees';
  return null;
}

function polygonsOf(g: Geometry): Position[][][] {
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function parseHeight(v: string | undefined, fallback: number): number {
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function circle(c: Vec2, r: number, n = 12): Vec2[] {
  return Array.from({ length: n }, (_, i): Vec2 => {
    const a = (i / n) * 2 * Math.PI;
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  });
}

/** Tree rows are lines in OSM; approximate the buffered line as a chain of circles. */
function bufferLine(pts: Vec2[], r: number): Rings[] {
  return pts.map((p) => [circle(p, r)]);
}

export function buildHole(fc: FeatureCollection, opts: BuildOptions): CourseFile {
  const corridor = opts.corridorM ?? 80;
  const margin = opts.marginM ?? 40;
  const treeH = opts.defaultTreeHeightM ?? 15;
  const treeR = opts.treeNodeRadiusM ?? 5;
  const feats = fc.features as Feature<Geometry, Props>[];

  const holeFeat = feats.find(
    (f) =>
      f.properties.golf === 'hole' &&
      f.properties.ref === opts.holeRef &&
      (opts.links === undefined || f.properties['golf:links'] === opts.links) &&
      f.geometry.type === 'LineString',
  );
  if (!holeFeat || holeFeat.geometry.type !== 'LineString') {
    throw new Error(`No golf=hole way with ref=${opts.holeRef}${opts.links ? ` and golf:links=${opts.links}` : ''}`);
  }
  const holeLL = holeFeat.geometry.coordinates;
  const course = feats.find((f) => f.id === opts.courseOsmId);
  if (!course) throw new Error(`Course boundary ${opts.courseOsmId} not in input`);

  // The green is the green polygon the hole line ends in (or nearest to its end).
  const [endLon, endLat] = holeLL[holeLL.length - 1];
  const provisional = new LocalFrame({ lat: endLat, lon: endLon });
  const greens = feats.filter((f) => f.properties.golf === 'green').flatMap((f) =>
    polygonsOf(f.geometry).map((poly) => ({ f, rings: poly.map((r) => r.map(([lo, la]) => provisional.toLocal(la, lo))) })),
  );
  if (greens.length === 0) throw new Error('No greens mapped');
  const scoreGreen = (g: (typeof greens)[number]) =>
    pointInRings([0, 0], g.rings) ? -1 : Math.min(...g.rings[0].map((p) => Math.hypot(p[0], p[1])));
  const green = greens.reduce((a, b) => (scoreGreen(b) < scoreGreen(a) ? b : a));
  const gc = ringCentroid(green.rings[0]);
  const origin = provisional.toLatLon(gc[0], gc[1]);
  const frame = new LocalFrame(origin);
  const toLocalRings = (poly: Position[][]): Rings => poly.map((r) => r.map(([lo, la]) => frame.toLocal(la, lo)));

  const routing: Vec2[] = holeLL.map(([lo, la]) => frame.toLocal(la, lo));
  const tee = routing[0];
  const pin = snapInside(routing[routing.length - 1], toLocalRings(polygonsOf(green.f.geometry)[0]));

  const near = (rings: Rings) => rings[0].some((p) => distToPolyline(p, routing) < corridor) || routing.some((p) => pointInRings(p, rings));

  const features: CourseFeature[] = [];
  const trees: TreeFeature[] = [];
  for (const f of feats) {
    const cls = classifyTags(f.properties);
    if (!cls || cls === 'oob') continue;
    const id = String(f.id);
    if (cls === 'trees') {
      const h = parseHeight(f.properties.height, treeH);
      if (f.geometry.type === 'Point') {
        const [lo, la] = f.geometry.coordinates;
        const c = frame.toLocal(la, lo);
        if (distToPolyline(c, routing) < corridor) trees.push({ osm_id: id, rings: [circle(c, treeR)], height_m: h });
      } else if (f.geometry.type === 'LineString') {
        const pts = f.geometry.coordinates.map(([lo, la]) => frame.toLocal(la, lo));
        if (pts.some((p) => distToPolyline(p, routing) < corridor)) {
          for (const rings of bufferLine(densify(pts, treeR), treeR)) trees.push({ osm_id: id, rings, height_m: h });
        }
      } else {
        for (const poly of polygonsOf(f.geometry)) {
          const rings = toLocalRings(poly);
          if (near(rings)) trees.push({ osm_id: id, rings, height_m: h });
        }
      }
      continue;
    }
    if (cls === 'path' && f.geometry.type === 'LineString') {
      // Cart paths are mapped as lines; give them ~3 m of width.
      const pts = f.geometry.coordinates.map(([lo, la]) => frame.toLocal(la, lo));
      if (pts.some((p) => distToPolyline(p, routing) < corridor)) {
        for (const rings of bufferLine(densify(pts, 1), 1.5)) features.push({ class: cls, osm_id: id, rings });
      }
      continue;
    }
    for (const poly of polygonsOf(f.geometry)) {
      const rings = toLocalRings(poly);
      if (near(rings)) features.push({ class: cls, osm_id: id, rings });
    }
  }

  const boundary = polygonsOf(course.geometry).map(toLocalRings);

  // Bounds: routing + all included feature vertices, plus margin; capped to the corridor so a
  // huge wood polygon doesn't blow up the imagery bbox.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (p: Vec2) => {
    if (distToPolyline(p, routing) > corridor + margin) return;
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  };
  routing.forEach(grow);
  for (const f of [...features, ...trees]) f.rings[0].forEach(grow);
  const bounds: [Vec2, Vec2] = [[minX - margin, minY - margin], [maxX + margin, maxY + margin]];

  const hole: CourseHole = {
    ref: opts.holeRef,
    par: parseInt(holeFeat.properties.par ?? '4', 10),
    tee, pin, routing,
    length_m: polylineLength(routing),
    features, trees, boundary, bounds,
  };

  return {
    name: course.properties.name ?? 'Unknown course',
    links: opts.links,
    source: {
      osm_timestamp: opts.osmTimestamp,
      course_osm_id: opts.courseOsmId,
      attribution: '© OpenStreetMap contributors (ODbL)',
    },
    origin,
    imagery_offset_m: [0, 0],
    holes: [hole],
  };
}

/** Move p inside the polygon if it isn't already (toward the centroid), so the cup is on the green. */
function snapInside(p: Vec2, rings: Rings): Vec2 {
  if (pointInRings(p, rings)) return p;
  const c = ringCentroid(rings[0]);
  const lerp = (t: number): Vec2 => [p[0] + (c[0] - p[0]) * t, p[1] + (c[1] - p[1]) * t];
  for (let t = 0.1; t <= 1; t += 0.1) {
    // Step a little past the edge so the cup isn't on the fringe.
    if (pointInRings(lerp(t), rings)) return lerp(Math.min(1, t + 0.15));
  }
  return c;
}

function densify(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
