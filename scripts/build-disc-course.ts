// Offline pipeline for a disc golf course: Overpass (holes, tees, baskets, water, roads, buildings,
// mapped trees and woods) + HSY 2024 land cover tree-height polygons (Helsinki region only)
// → public/courses/<out>.json. Outside Helsinki, --trees osm plants OSM's own trees and woods.
//
//   npm run disc-course                      # defaults: Tali, Helsinki
//   npm run disc-course -- --course 40254405 --out tali [--refresh]
//   npm run disc-course -- --style simple --out tali-simple   # Tali Recreation: vector, thinned real trees
//   npm run disc-course -- --course relation/18072611 --out oak-grove --trees osm --broadleaf Oak   # Oak Grove Gold, Stockton CA
//   npm run disc-course -- --course relation/14137393 --out bechovice --trees osm --broadleaf Oak,CommonTree,Birch --name "DiscGolfPark Běchovice"   # Prague
//   (Skatås, Kincaid, Julkujärvi, Blue Lake: see the README)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { FeatureCollection } from 'geojson';
import osmtogeojson from 'osmtogeojson';
import { buildDiscCourse, type CanopyLayer } from '../src/course/disc-build';
import { decodeTrees } from '../src/course/disc-types';

const { values: args } = parseArgs({
  options: {
    course: { type: 'string', default: '40254405' },
    out: { type: 'string', default: 'tali' },
    refresh: { type: 'boolean', default: false },
    'no-hsy': { type: 'boolean', default: false },
    /** 'simple': Tali Recreation, a vector course with the real trees thinned back from fairways and greens. */
    style: { type: 'string', default: 'forest' },
    /** 'hsy' (Helsinki region) or 'osm': OSM's mapped trees, and its woods planted as canopy. */
    trees: { type: 'string', default: 'hsy' },
    /** Tree models, as comma-separated name prefixes (e.g. Birch,CommonTree); default CommonTree / Pine. */
    broadleaf: { type: 'string' },
    conifer: { type: 'string' },
    /** Course name, when the OSM one is a layout's ("Main 18 - long tees"). */
    name: { type: 'string' },
    /** Hole numbers for lines mapped without one: way:ref pairs, comma-separated (996506301:4). */
    'hole-ref': { type: 'string' },
    /**
     * A hole OSM doesn't have, made up: REF:lat,lon;lat,lon[;…][:PAR], tee first, basket last.
     * Repeatable. Its line, tee and basket are added to the OSM data before the build.
     */
    'add-hole': { type: 'string', multiple: true },
    /** Hole lines (way ids, comma-separated) to keep though they lie outside the course area. */
    'with-hole': { type: 'string' },
  },
});

const USER_AGENT = 'untitled-disc-game/0.1 (hobby project; offline course builder)';

/** A course is a closed way (its id) or a relation of hole ways ("relation/<id>"). */
const rel = args.course!.match(/^relation\/(\d+)$/)?.[1];
const courseSel = rel ? `relation(${rel})` : `way(${args.course})`;
const cacheId = rel ? `r${rel}` : args.course;

/** All features we need inside a lat/lon box (south, west, north, east). */
function overpassQuery(b: number[]): string {
  const bb = b.join(',');
  return `[out:json][timeout:180];
(
  ${courseSel};
  ${rel ? `${courseSel};way(r);` : ''}
  nwr["disc_golf"](${bb});
  nwr["natural"="water"](${bb});
  way["waterway"~"^(stream|ditch)$"](${bb});
  way["highway"](${bb});
  way["building"](${bb});
  nwr["leisure"="golf_course"](${bb});
  nwr["amenity"="parking"](${bb});
  node["natural"="tree"](${bb});
  nwr["natural"="wood"](${bb});
  nwr["landuse"="forest"](${bb});
);
out body;
>;
out skel qt;`;
}

async function fetchRetry(url: string, init: RequestInit, what: string): Promise<Response> {
  let wait = 5000;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      console.warn(`${what}: HTTP ${res.status}; retrying in ${wait / 1000}s`);
    } catch (e) {
      console.warn(`${what}: ${(e as Error).message}; retrying in ${wait / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw new Error(`${what}: unavailable after retries`);
}

async function cached<T>(path: string, load: () => Promise<T>): Promise<T> {
  if (existsSync(path) && !args.refresh) {
    console.log(`using cached ${path}`);
    return JSON.parse(readFileSync(path, 'utf8'));
  }
  const v = await load();
  mkdirSync('data/raw', { recursive: true });
  writeFileSync(path, JSON.stringify(v));
  return v;
}

const overpass = async (q: string) => (await fetchRetry('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ data: q }),
}, 'Overpass')).json();

type Raw = {
  osm3s?: { timestamp_osm_base?: string };
  elements: { type: string; id: number; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string>; members?: { type: string; ref: number }[] }[];
};

const raw = await cached(`data/raw/disc-${cacheId}.json`, async () => {
  // Step 1: the course outline (a relation: its hole lines), for a search box. Step 2: everything
  // in that box + ~400 m, since hole lines can run outside the mapped course polygon.
  console.log(`querying Overpass for course ${args.course}…`);
  const outline = (await overpass(`[out:json][timeout:60];${rel ? `${courseSel};way(r);` : `${courseSel};`}out geom;`)) as Raw;
  const g = outline.elements.flatMap((e) => e.geometry ?? []);
  if (!g.length) throw new Error(`course ${args.course} not found`);
  const la = g.map((p) => p.lat), lo = g.map((p) => p.lon);
  const box = [Math.min(...la) - 0.0036, Math.min(...lo) - 0.0072, Math.max(...la) + 0.0036, Math.max(...lo) + 0.0072];
  return overpass(overpassQuery(box));
}) as Raw;

const osm = osmtogeojson(raw);
for (const spec of args['add-hole'] ?? []) {
  const [ref, line, par] = spec.split(':');
  const pts = (line ?? '').split(';').map((q) => q.split(',').map(Number)).map(([lat, lon]) => [lon, lat]);
  if (!ref || pts.length < 2 || pts.some((q) => q.some((v) => !Number.isFinite(v)))) throw new Error(`--add-hole ${spec}: want REF:lat,lon;lat,lon[:PAR]`);
  const point = (id: string, at: number[], kind: string) => ({ type: 'Feature' as const, id, properties: { disc_golf: kind }, geometry: { type: 'Point' as const, coordinates: at } });
  osm.features.push(
    { type: 'Feature', id: `way/added-${ref}`, properties: { disc_golf: 'hole', ref, ...(par ? { par } : {}) }, geometry: { type: 'LineString', coordinates: pts } },
    point(`node/added-${ref}-tee`, pts[0], 'tee'), point(`node/added-${ref}-basket`, pts[pts.length - 1], 'basket'),
  );
}

// HSY land cover 2024, tree canopy by height class. Open WFS, no key. Attribution required.
const HSY_LAYERS: { name: string; range: [number, number] }[] = [
  { name: 'puusto_2_10m', range: [2, 10] },
  { name: 'puusto_10_15m', range: [10, 15] },
  { name: 'puusto_15_20m', range: [15, 20] },
  { name: 'puusto_yli20m', range: [20, 27] },
];
const lats = raw.elements.filter((e) => e.type === 'node').map((e) => e.lat!);
const lons = raw.elements.filter((e) => e.type === 'node').map((e) => e.lon!);
const bbox = [Math.min(...lats) - 0.001, Math.min(...lons) - 0.002, Math.max(...lats) + 0.001, Math.max(...lons) + 0.002];

const canopy: CanopyLayer[] = [];
const simple = args.style === 'simple';
const osmTrees = args.trees === 'osm';
if (osmTrees) {
  // OSM woods as one canopy class: no heights mapped, so a mixed park-woodland range.
  const woods = osm.features.filter((f) => (f.properties?.natural === 'wood' || f.properties?.landuse === 'forest') && /Polygon/.test(f.geometry.type));
  canopy.push({ range: [8, 16], fc: { type: 'FeatureCollection', features: woods } });
} else if (!args['no-hsy']) {
  for (const l of HSY_LAYERS) {
    const fc = await cached<FeatureCollection>(`data/raw/hsy-${cacheId}-${l.name}.json`, async () => {
      console.log(`fetching HSY ${l.name}…`);
      const url = 'https://kartta.hsy.fi/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature'
        + `&typeNames=asuminen_ja_maankaytto:maanpeite_${l.name}_2024&outputFormat=application/json&srsName=EPSG:4326`
        + `&bbox=${bbox.join(',')},urn:ogc:def:crs:EPSG::4326`;
      return (await fetchRetry(url, { headers: { 'User-Agent': USER_AGENT } }, `HSY ${l.name}`)).json();
    });
    // EPSG:4326 in WFS 2.0 can come back lat,lon. Normalize to GeoJSON lon,lat.
    canopy.push({ range: l.range, fc: normalizeAxisOrder(fc) });
  }
}

function normalizeAxisOrder(fc: FeatureCollection): FeatureCollection {
  const first = (fc.features[0]?.geometry as { coordinates: number[][][] } | undefined)?.coordinates?.[0]?.[0];
  if (!first) return fc;
  // Helsinki: lat ≈ 60, lon ≈ 25. If the first number looks like a latitude, swap.
  if (Math.abs(first[0] - 60) < Math.abs(first[1] - 60)) {
    const swap = (c: unknown): unknown => (typeof (c as number[])[0] === 'number' ? [(c as number[])[1], (c as number[])[0]] : (c as unknown[]).map(swap));
    for (const f of fc.features) (f.geometry as { coordinates: unknown }).coordinates = swap((f.geometry as { coordinates: unknown }).coordinates);
  }
  return fc;
}

const relation = rel ? raw.elements.find((e) => e.type === 'relation' && String(e.id) === rel) : undefined;
const course = buildDiscCourse(osm, canopy, {
  courseOsmId: rel ? `relation/${rel}` : `way/${args.course}`,
  osmTimestamp: raw.osm3s?.timestamp_osm_base ?? 'unknown',
  trees: osmTrees ? 'osm' : simple ? 'recreation' : 'canopy',
  holeIds: relation?.members?.filter((m) => m.type === 'way').map((m) => `way/${m.ref}`),
  extraHoleIds: args['with-hole']?.split(',').map((w) => `way/${w.trim()}`),
  holeRefs: args['hole-ref'] ? Object.fromEntries(args['hole-ref'].split(',').map((p) => { const [w, r] = p.split(':'); return [`way/${w.trim()}`, r.trim()]; })) : undefined,
  name: args.name ?? relation?.tags?.name,
  attribution: [
    osmTrees ? 'Course data and trees © OpenStreetMap contributors (ODbL)' : 'Course data © OpenStreetMap contributors (ODbL)',
    ...(canopy.length && !osmTrees ? ['Tree canopy: HSY land cover 2024 (Helsingin seudun ympäristöpalvelut, CC BY 4.0)'] : []),
  ],
});

if (args.broadleaf || args.conifer) {
  const list = (v: string | undefined, d: string) => (v ?? d).split(',').map((x) => x.trim()).filter(Boolean);
  course.tree_models = { broadleaf: list(args.broadleaf, 'CommonTree'), conifer: list(args.conifer, 'Pine') };
}

const outPath = `public/courses/${args.out}.json`;
mkdirSync('public/courses', { recursive: true });
// Its heightmap was laid over the old bounds: it has to be built again.
const hadElevation = existsSync(outPath) && !!JSON.parse(readFileSync(outPath, 'utf8')).elevation;
// Round local meters to cm, but never the lat/lon origin.
writeFileSync(outPath, JSON.stringify(course, (k, v) => {
  if (k === 'trees') return (v as number[]).map((n) => Math.round(n * 100) / 100);
  return typeof v === 'number' && k !== 'lat' && k !== 'lon' ? Math.round(v * 100) / 100 : v;
}));

const trees = decodeTrees(course.trees);
console.log(`${course.name}: ${course.holes.length} holes, ${trees.length} trees, ${course.canopy.length} canopy polygons, ${course.features.length} features, ${course.ob.length} OB polygons`);
for (const h of course.holes) {
  console.log(`  #${h.ref.padStart(2)} par ${h.par} (${h.par_source}) ${Math.round(h.length_m)} m${h.warnings.length ? '  ⚠ ' + h.warnings.join('; ') : ''}`);
}
console.log(`bounds ${course.bounds.map((p) => p.map(Math.round).join(',')).join(' → ')}`);
console.log(`wrote ${outPath}`);
if (hadElevation) console.log(`Rebuilt without its ground: run \`npm run elevation -- --out ${args.out}\` again`);
