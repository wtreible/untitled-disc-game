// Live Esri World Imagery for one hole: fetch the covering tiles, stitch into one canvas.
// Tiles are never cached to disk (docs/03-data-sources.md). Over a few hundred meters Web
// Mercator → local frame is effectively affine, so the stitched canvas maps onto an axis-aligned
// rectangle in local meters.
import type { LocalFrame, Vec2 } from '../course/geo';

const TILE = 256;
const URL = (z: number, x: number, y: number) =>
  `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
export const ESRI_ATTRIBUTION = 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

export interface Imagery {
  canvas: HTMLCanvasElement;
  /** Local-frame rectangle the canvas covers: [[minX, minY], [maxX, maxY]]. */
  bounds: [Vec2, Vec2];
  zoom: number;
  failedTiles: number;
}

const lon2x = (lon: number, n: number) => ((lon + 180) / 360) * n;
const lat2y = (lat: number, n: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
const x2lon = (x: number, n: number) => (x / n) * 360 - 180;
const y2lat = (y: number, n: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // Esri sends Access-Control-Allow-Origin: *
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

/** z19 is the sharpest real imagery at TCC; z20+ is upsampled. Falls back if the canvas would be too big. */
export async function loadImagery(frame: LocalFrame, bounds: [Vec2, Vec2], maxZoom = 19, maxCanvas = 4096): Promise<Imagery> {
  const sw = frame.toLatLon(bounds[0][0], bounds[0][1]);
  const ne = frame.toLatLon(bounds[1][0], bounds[1][1]);
  let z = maxZoom;
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0, n = 0;
  for (; z > 10; z--) {
    n = 2 ** z;
    x0 = Math.floor(lon2x(sw.lon, n)); x1 = Math.floor(lon2x(ne.lon, n));
    y0 = Math.floor(lat2y(ne.lat, n)); y1 = Math.floor(lat2y(sw.lat, n));
    if ((x1 - x0 + 1) * TILE <= maxCanvas && (y1 - y0 + 1) * TILE <= maxCanvas) break;
  }
  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * TILE;
  canvas.height = (y1 - y0 + 1) * TILE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a5a3a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let failed = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      jobs.push(
        loadImage(URL(z, tx, ty))
          .then((img) => ctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE))
          .catch(() => { failed++; }),
      );
    }
  }
  await Promise.all(jobs);

  const min = frame.toLocal(y2lat(y1 + 1, n), x2lon(x0, n));
  const max = frame.toLocal(y2lat(y0, n), x2lon(x1 + 1, n));
  return { canvas, bounds: [min, max], zoom: z, failedTiles: failed };
}
