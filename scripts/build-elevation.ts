// Offline pipeline for a real course's ground (docs/07-elevation-lidar.md): bare-earth elevation from
// the national lidar models → public/courses/<out>.height.bin (Uint16 cm above the lowest point, on a
// grid over the course bounds) + an `elevation` header and attribution in <out>.json.
//
//   npm run elevation -- --out greer              # picks the source from where the course is
//   npm run elevation -- --out skatas             # Sweden: LM_USER / LM_PASS (a Lantmäteriet login)
//
// Sources (all bare earth, no canopy):
//   3dep  USGS 3DEP (US): best of 1 m / 1/9″ / 5 m (Alaska), one exportImage call    public domain
//   cuzk  ČÚZK DMR 5G (Czechia): 2 m, exportImage                                     CC BY 4.0
//   nls   NLS Finland 2 m (the funet mirror's tiles, ETRS-TM35FIN)                    CC BY 4.0
//   bev   BEV ALS-DGM (Austria): 1 m, 50 km cloud-optimized tiles in EPSG:3035        CC BY 4.0
//   lm    Lantmäteriet Markhöjdmodell (Sweden): 1 m COGs via its STAC, SWEREF 99 TM   CC BY 4.0
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fromArrayBuffer, fromUrl, type GeoTIFFImage } from 'geotiff';
import proj4 from 'proj4';
import { LocalFrame, type LatLon } from '../src/course/geo';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string' },
    source: { type: 'string' },
    /** Grid cell (m). 2 m is plenty for fairways; the source's own resolution is sampled under it. */
    cell: { type: 'string', default: '2' },
  },
});
if (!args.out) throw new Error('--out <course id> (public/courses/<id>.json)');

const CRS: Record<string, string> = {
  'EPSG:3067': '+proj=utm +zone=35 +ellps=GRS80 +units=m +no_defs',
  'EPSG:3006': '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs',
  'EPSG:3035': '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m +no_defs',
};
const ATTRIBUTION: Record<string, string> = {
  '3dep': 'Elevation: USGS 3D Elevation Program',
  cuzk: 'Elevation: DMR 5G © ČÚZK (CC BY 4.0)',
  nls: 'Elevation: National Land Survey of Finland elevation model 2 m (CC BY 4.0)',
  bev: 'Elevation: ALS-DGM © BEV (CC BY 4.0)',
  lm: 'Elevation: Markhöjdmodell © Lantmäteriet (CC BY 4.0)',
};

/** A source raster: its values, and where a lat/lon falls on it (fractional pixel). */
interface Raster { data: Float32Array | Float64Array; width: number; height: number; pixel: (ll: LatLon) => [number, number]; nodata: number }

function pickSource(o: LatLon): string {
  if (o.lon < -50) return '3dep';
  if (o.lat > 59.5 && o.lon > 19) return 'nls';
  if (o.lat > 55 && o.lon < 24) return 'lm';
  if (o.lat > 48.5 && o.lon > 12 && o.lon < 19) return 'cuzk';
  if (o.lat > 46 && o.lat <= 49.2 && o.lon > 9.5 && o.lon < 17.2) return 'bev';
  throw new Error(`No elevation source for ${o.lat}, ${o.lon}: pass --source`);
}

/** ArcGIS ImageServer: one float GeoTIFF for a lat/lon box at about 1 m a pixel. */
async function exportImage(service: string, box: [number, number, number, number], mPerPx: [number, number]): Promise<Raster> {
  const [w, s, e, n] = box;
  const size = [Math.min(4000, Math.ceil(mPerPx[0])), Math.min(4000, Math.ceil(mPerPx[1]))];
  const q = new URLSearchParams({ bbox: `${w},${s},${e},${n}`, bboxSR: '4326', imageSR: '4326', size: size.join(','), format: 'tiff', pixelType: 'F32', interpolation: 'RSP_BilinearInterpolation', f: 'json' });
  const meta = await (await fetch(`${service}/exportImage?${q}`)).json() as { href: string; width: number; height: number; extent: { xmin: number; ymin: number; xmax: number; ymax: number } };
  if (!meta.href) throw new Error(`exportImage failed: ${JSON.stringify(meta).slice(0, 300)}`);
  const tif = await fromArrayBuffer(await (await fetch(meta.href)).arrayBuffer());
  const img = await tif.getImage();
  const [data] = await img.readRasters() as unknown as [Float32Array];
  const { xmin, ymin, xmax, ymax } = meta.extent;
  const W = img.getWidth(), H = img.getHeight();
  return { data, width: W, height: H, nodata: Number(img.getGDALNoData() ?? -3.4e38), pixel: ({ lat, lon }) => [((lon - xmin) / (xmax - xmin)) * W - 0.5, ((ymax - lat) / (ymax - ymin)) * H - 0.5] };
}

/** A window of a (cloud-optimized) GeoTIFF in a projected CRS, read by range requests. */
async function cogWindow(url: string, crs: string, box: [number, number, number, number], headers: Record<string, string> = {}): Promise<Raster & { covers: (ll: LatLon) => boolean }> {
  const tif = await fromUrl(url, { headers, allowFullFile: false } as never);
  const img: GeoTIFFImage = await tif.getImage();
  const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution(); // ry < 0 (north up)
  const fwd = proj4('EPSG:4326', CRS[crs]);
  const corners = [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]].map((c) => fwd.forward(c));
  const px = corners.map(([x]) => (x - ox) / rx), py = corners.map(([, y]) => (y - oy) / ry);
  const x0 = Math.max(0, Math.floor(Math.min(...px)) - 2), x1 = Math.min(img.getWidth(), Math.ceil(Math.max(...px)) + 2);
  const y0 = Math.max(0, Math.floor(Math.min(...py)) - 2), y1 = Math.min(img.getHeight(), Math.ceil(Math.max(...py)) + 2);
  if (x1 <= x0 || y1 <= y0) throw new Error(`${url} doesn't cover the course`);
  const [data] = await img.readRasters({ window: [x0, y0, x1, y1] }) as unknown as [Float32Array];
  const pixel = ({ lat, lon }: LatLon): [number, number] => { const [x, y] = fwd.forward([lon, lat]); return [(x - ox) / rx - x0 - 0.5, (y - oy) / ry - y0 - 0.5]; };
  const W = x1 - x0, H = y1 - y0;
  return { data, width: W, height: H, nodata: Number(img.getGDALNoData() ?? -9999), pixel, covers: (ll) => { const [i, j] = pixel(ll); return i >= 0 && j >= 0 && i <= W - 1 && j <= H - 1; } };
}

/** NLS Finland: the funet mirror's VRT lists every 6 km tile and where it sits on the 2 m grid. */
async function nlsTiles(box: [number, number, number, number]): Promise<string[]> {
  const base = 'https://mirrors.nic.funet.fi/index/geodata/mml/dem2m/';
  const vrt = await (await fetch(`${base}dem2m_direct.vrt`)).text();
  const gt = vrt.match(/<GeoTransform>([^<]+)<\/GeoTransform>/)![1].split(',').map(Number);
  const fwd = proj4('EPSG:4326', CRS['EPSG:3067']);
  const xy = [[box[0], box[1]], [box[0], box[3]], [box[2], box[1]], [box[2], box[3]]].map((c) => fwd.forward(c));
  const [cx0, cx1] = [Math.min(...xy.map((p) => (p[0] - gt[0]) / gt[1])), Math.max(...xy.map((p) => (p[0] - gt[0]) / gt[1]))];
  const [cy0, cy1] = [Math.min(...xy.map((p) => (p[1] - gt[3]) / gt[5])), Math.max(...xy.map((p) => (p[1] - gt[3]) / gt[5]))];
  const out: string[] = [];
  for (const m of vrt.matchAll(/<SourceFilename[^>]*>([^<]+)<\/SourceFilename>[\s\S]*?<DstRect xOff="(\d+)" yOff="(\d+)" xSize="(\d+)" ySize="(\d+)"/g)) {
    const [x, y, w, h] = [m[2], m[3], m[4], m[5]].map(Number);
    if (x < cx1 && x + w > cx0 && y < cy1 && y + h > cy0) out.push(base + m[1]);
  }
  return out;
}

/** BEV: the 50 km EPSG:3035 tile under the course, newest edition first. */
async function bevTile(o: LatLon): Promise<string> {
  const [x, y] = proj4('EPSG:4326', CRS['EPSG:3035']).forward([o.lon, o.lat]);
  const name = `ALS_DTM_CRS3035RES50000mN${Math.floor(y / 50000) * 50000}E${Math.floor(x / 50000) * 50000}.tif`;
  for (const d of ['20250915', '20240915', '20230915', '20220915', '20210401']) {
    const url = `https://data.bev.gv.at/download/ALS/DTM/${d}/${name}`;
    if ((await fetch(url, { method: 'HEAD' })).ok) return url;
  }
  throw new Error(`No BEV tile ${name}`);
}

/** Lantmäteriet: the STAC lists the 1 m COGs; downloading them needs a (free) login. */
async function lmTiles(box: [number, number, number, number]): Promise<string[]> {
  const q = new URLSearchParams({ collections: 'dtm-cog', bbox: box.join(','), limit: '20' });
  const r = await (await fetch(`https://api.lantmateriet.se/stac-hojd/v1/search?${q}`)).json() as { features: { assets: { data: { href: string } } }[] };
  return r.features.map((f) => f.assets.data.href);
}

function bilinear(r: Raster, [fx, fy]: [number, number]): number {
  const x = Math.max(0, Math.min(r.width - 1.001, fx)), y = Math.max(0, Math.min(r.height - 1.001, fy));
  const i = Math.floor(x), j = Math.floor(y), tx = x - i, ty = y - j;
  const v = (a: number, b: number) => r.data[b * r.width + a];
  const vals = [v(i, j), v(i + 1, j), v(i, j + 1), v(i + 1, j + 1)];
  if (vals.some((z) => !(z > -1000) || z === r.nodata)) {
    const ok = vals.filter((z) => z > -1000 && z !== r.nodata);
    return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : NaN;
  }
  return (vals[0] * (1 - tx) + vals[1] * tx) * (1 - ty) + (vals[2] * (1 - tx) + vals[3] * tx) * ty;
}

const path = `public/courses/${args.out}.json`;
const course = JSON.parse(readFileSync(path, 'utf8'));
const frame = new LocalFrame(course.origin);
const [[bx0, by0], [bx1, by1]] = course.bounds as [[number, number], [number, number]];
const cell = parseFloat(args.cell!);
const cols = Math.ceil((bx1 - bx0) / cell) + 1, rows = Math.ceil((by1 - by0) / cell) + 1;
const pad = 20; // m of margin, so bilinear sampling at the edges has data
const sw = frame.toLatLon(bx0 - pad, by0 - pad), ne = frame.toLatLon(bx1 + pad, by1 + pad);
const box: [number, number, number, number] = [sw.lon, sw.lat, ne.lon, ne.lat];
const source = args.source ?? pickSource(course.origin);
console.log(`${args.out}: ${source}, ${cols}×${rows} at ${cell} m`);

let rasters: (Raster & { covers?: (ll: LatLon) => boolean })[];
const span: [number, number] = [bx1 - bx0 + 2 * pad, by1 - by0 + 2 * pad];
if (source === '3dep') rasters = [await exportImage('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer', box, span)];
else if (source === 'cuzk') rasters = [await exportImage('https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g_wm/ImageServer', box, [span[0] / 2, span[1] / 2])];
else if (source === 'nls') rasters = await Promise.all((await nlsTiles(box)).map((u) => cogWindow(u, 'EPSG:3067', box)));
else if (source === 'bev') rasters = [await cogWindow(await bevTile(course.origin), 'EPSG:3035', box)];
else if (source === 'lm') {
  const { LM_USER, LM_PASS } = process.env;
  if (!LM_USER || !LM_PASS) throw new Error('Lantmäteriet needs LM_USER and LM_PASS (a free Geotorget login)');
  const auth = { Authorization: `Basic ${Buffer.from(`${LM_USER}:${LM_PASS}`).toString('base64')}` };
  rasters = await Promise.all((await lmTiles(box)).map((u) => cogWindow(u, 'EPSG:3006', box, auth)));
} else throw new Error(`Unknown source ${source}`);

// Sample each cell (2×2 under it, so a finer source is averaged rather than aliased).
const h = new Float32Array(cols * rows);
let missing = 0;
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    let sum = 0, n = 0;
    for (const [dx, dy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const ll = frame.toLatLon(bx0 + (c + dx) * cell, by0 + (r + dy) * cell);
      const src = rasters.find((q) => !q.covers || q.covers(ll)) ?? rasters[0];
      const z = bilinear(src, src.pixel(ll));
      if (Number.isFinite(z)) { sum += z; n++; }
    }
    h[r * cols + c] = n ? sum / n : NaN;
    if (!n) missing++;
  }
}
// Gaps (outside the survey): the nearest known height along the row, then the column.
if (missing) {
  console.warn(`${missing} cells without data: filled from neighbours`);
  for (let pass = 0; pass < 4 && h.some((z) => Number.isNaN(z)); pass++) {
    for (let i = 0; i < h.length; i++) {
      if (!Number.isNaN(h[i])) continue;
      const nb = [i - 1, i + 1, i - cols, i + cols].filter((k) => k >= 0 && k < h.length && !Number.isNaN(h[k]));
      if (nb.length) h[i] = nb.reduce((a, k) => a + h[k], 0) / nb.length;
    }
  }
  if (h.some((z) => Number.isNaN(z))) throw new Error('Too much of the course has no elevation data');
}
// Light 3×3 smoothing: lidar noise reads as bumps underfoot.
const s = new Float32Array(h.length);
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) { sum += h[rr * cols + cc]; n++; }
    }
    s[r * cols + c] = sum / n;
  }
}
let lo = Infinity, hi = -Infinity;
for (const z of s) { lo = Math.min(lo, z); hi = Math.max(hi, z); }
if (hi - lo > 655) throw new Error(`Relief ${hi - lo} m is more than Uint16 centimeters hold`);
const cm = new Uint16Array(s.length);
for (let i = 0; i < s.length; i++) cm[i] = Math.round((s[i] - lo) * 100);
writeFileSync(`public/courses/${args.out}.height.bin`, Buffer.from(cm.buffer));

course.elevation = { file: `${args.out}.height.bin`, min: [bx0, by0], cell, cols, rows, base: Math.round(lo * 100) / 100, source };
const attr: string[] = course.source.attribution.filter((a: string) => !a.startsWith('Elevation:'));
course.source.attribution = [...attr, ATTRIBUTION[source]];
writeFileSync(path, JSON.stringify(course));
console.log(`${args.out}: ${(hi - lo).toFixed(1)} m of relief (lowest ${lo.toFixed(1)} m above sea level), ${(cm.byteLength / 1024).toFixed(0)} KB`);
