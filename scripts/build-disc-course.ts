// Offline pipeline for a disc golf course: Overpass (holes, tees, baskets, water, roads, buildings)
// + HSY 2024 land cover tree-height polygons (Helsinki region only) → public/courses/<out>.json.
//
//   npm run disc-course                      # defaults: Tali, Helsinki
//   npm run disc-course -- --course 40254405 --out tali [--refresh]
//   npm run disc-course -- --style simple --out tali-simple   # vector course, few designed trees
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
    /** 'simple': vector course with a few designed trees per hole (no HSY). */
    style: { type: 'string', default: 'forest' },
  },
});

const USER_AGENT = 'sat-golf/0.1 (hobby project; offline course builder)';

/** All features we need inside a lat/lon box (south, west, north, east). */
function overpassQuery(courseWayId: string, b: number[]): string {
  const bb = b.join(',');
  return `[out:json][timeout:180];
(
  way(${courseWayId});
  nwr["disc_golf"](${bb});
  nwr["natural"="water"](${bb});
  way["waterway"~"^(stream|ditch)$"](${bb});
  way["highway"](${bb});
  way["building"](${bb});
  nwr["leisure"="golf_course"](${bb});
  nwr["amenity"="parking"](${bb});
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

type Raw = { osm3s?: { timestamp_osm_base?: string }; elements: { type: string; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[] }[] };

const raw = await cached(`data/raw/disc-${args.course}.json`, async () => {
  // Step 1: the course outline, for a search box. Step 2: everything in that box + ~400 m,
  // since hole lines can run outside the mapped course polygon.
  console.log(`querying Overpass for course way ${args.course}…`);
  const outline = (await overpass(`[out:json][timeout:60];way(${args.course});out geom;`)) as Raw;
  const g = outline.elements[0]?.geometry;
  if (!g) throw new Error(`course way ${args.course} not found`);
  const la = g.map((p) => p.lat), lo = g.map((p) => p.lon);
  const box = [Math.min(...la) - 0.0036, Math.min(...lo) - 0.0072, Math.max(...la) + 0.0036, Math.max(...lo) + 0.0072];
  return overpass(overpassQuery(args.course!, box));
}) as Raw;

const osm = osmtogeojson(raw);

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
if (!args['no-hsy'] && !simple) {
  for (const l of HSY_LAYERS) {
    const fc = await cached<FeatureCollection>(`data/raw/hsy-${args.course}-${l.name}.json`, async () => {
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

const course = buildDiscCourse(osm, canopy, {
  courseOsmId: `way/${args.course}`,
  osmTimestamp: raw.osm3s?.timestamp_osm_base ?? 'unknown',
  trees: simple ? 'sparse' : 'canopy',
  attribution: [
    'Course data © OpenStreetMap contributors (ODbL)',
    ...(canopy.length ? ['Tree canopy: HSY land cover 2024 (Helsingin seudun ympäristöpalvelut, CC BY 4.0)'] : []),
  ],
});

const outPath = `public/courses/${args.out}.json`;
mkdirSync('public/courses', { recursive: true });
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
