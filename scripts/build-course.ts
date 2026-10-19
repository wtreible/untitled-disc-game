// Offline pipeline: Overpass → OSM JSON (cached in data/raw) → course.json in public/courses.
//
//   npm run course                       # defaults: The Country Club, Main #17
//   npm run course -- --course 29870415 --hole 17 --links Main --out tcc-main-17 [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import osmtogeojson from 'osmtogeojson';
import { buildHole } from '../src/course/build';

const { values: args } = parseArgs({
  options: {
    course: { type: 'string', default: '29870415' },
    hole: { type: 'string', default: '17' },
    links: { type: 'string', default: 'Main' },
    out: { type: 'string', default: 'tcc-main-17' },
    refresh: { type: 'boolean', default: false },
  },
});

// Second entry is a fallback mirror that hasn't been exercised yet (main endpoint answered first try).
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// Overpass rejects requests with no identifying User-Agent (406). See docs/03-data-sources.md.
const USER_AGENT = 'sat-golf/0.1 (hobby project; offline course builder)';

function query(courseWayId: string): string {
  return `[out:json][timeout:120];
way(${courseWayId})->.c;
.c map_to_area->.a;
(
  .c;
  way(area.a)["golf"];
  relation(area.a)["golf"];
  way(area.a)["natural"~"^(water|wood|tree_row|scrub)$"];
  relation(area.a)["natural"~"^(water|wood)$"];
  way(area.a)["landuse"="forest"];
  node(area.a)["natural"="tree"];
);
out body;
>;
out skel qt;`;
}

async function fetchOverpass(q: string): Promise<unknown> {
  let wait = 5000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q }),
      });
      if (res.ok) return await res.json();
      console.warn(`${url} → HTTP ${res.status}; retrying in ${wait / 1000}s`);
    } catch (e) {
      console.warn(`${url} → ${(e as Error).message}; retrying in ${wait / 1000}s`);
    }
    await new Promise((r) => setTimeout(r, wait));
    wait *= 2;
  }
  throw new Error('Overpass unavailable after retries');
}

const rawPath = `data/raw/course-${args.course}.json`;
let raw: { osm3s?: { timestamp_osm_base?: string } };
if (existsSync(rawPath) && !args.refresh) {
  console.log(`using cached ${rawPath} (pass --refresh to re-query)`);
  raw = JSON.parse(readFileSync(rawPath, 'utf8'));
} else {
  console.log(`querying Overpass for course way ${args.course}…`);
  raw = (await fetchOverpass(query(args.course))) as typeof raw;
  mkdirSync('data/raw', { recursive: true });
  writeFileSync(rawPath, JSON.stringify(raw));
}

const fc = osmtogeojson(raw);
const course = buildHole(fc, {
  courseOsmId: `way/${args.course}`,
  holeRef: args.hole!,
  links: args.links || undefined,
  osmTimestamp: raw.osm3s?.timestamp_osm_base ?? 'unknown',
});

const outPath = `public/courses/${args.out}.json`;
mkdirSync('public/courses', { recursive: true });
// Round local-frame meters to cm to keep the file small, but never the lat/lon origin.
writeFileSync(outPath, JSON.stringify(course, (k, v) => (typeof v === 'number' && k !== 'lat' && k !== 'lon' ? Math.round(v * 100) / 100 : v)));

const h = course.holes[0];
const counts: Record<string, number> = {};
for (const f of h.features) counts[f.class] = (counts[f.class] ?? 0) + 1;
console.log(`${course.name} #${h.ref}: par ${h.par}, ${Math.round(h.length_m)} m (${Math.round(h.length_m / 0.9144)} yd)`);
console.log(`features: ${JSON.stringify(counts)}, trees: ${h.trees.length}, boundary polygons: ${h.boundary.length}`);
console.log(`bounds: ${h.bounds.map((p) => p.map(Math.round).join(',')).join(' → ')}`);
console.log(`wrote ${outPath}`);
