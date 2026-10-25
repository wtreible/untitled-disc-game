import { readFileSync, readdirSync } from 'node:fs';
import osmtogeojson from 'osmtogeojson';
for (const f of readdirSync('data/raw').filter((n) => n.startsWith('disc-'))) {
  const fc = osmtogeojson(JSON.parse(readFileSync(`data/raw/${f}`, 'utf8')));
  const n = (k: string) => fc.features.filter((x) => (x.properties as Record<string, string>)?.disc_golf === k).length;
  console.log(f.padEnd(24), 'holes', n('hole'), 'tees', n('tee'), 'baskets', n('basket'));
}
