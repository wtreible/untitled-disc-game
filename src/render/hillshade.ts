// Hillshade for a course with real ground: the slopes facing away from a north-west sun darkened, so
// the hills read on an unlit photo (or the drawn course) from above and at eye level. Multiplied over
// the ground: flat ground and slopes facing the light are left as they are.
import type { HeightmapTerrain } from '../game/terrain';

/** Sun azimuth (clockwise from north) and altitude, the cartographic convention. */
const AZIMUTH = (315 * Math.PI) / 180, ALTITUDE = (45 * Math.PI) / 180;
/** How much darker a slope gets per unit of light it loses, and the darkest it gets. */
const STRENGTH = 1.8, FLOOR = 0.5;

/** One pixel per terrain cell, north up; pixel centers on the cells. */
export function hillshadeCanvas(t: HeightmapTerrain): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = t.cols;
  canvas.height = t.rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(t.cols, t.rows);
  const L = [Math.sin(AZIMUTH) * Math.cos(ALTITUDE), Math.cos(AZIMUTH) * Math.cos(ALTITUDE), Math.sin(ALTITUDE)];
  const flat = L[2];
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const n = t.normalAt(t.min[0] + c * t.cell, t.min[1] + r * t.cell);
      const lit = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
      const v = Math.round(255 * Math.max(FLOOR, Math.min(1, 1 - STRENGTH * (flat - lit))));
      const o = ((t.rows - 1 - r) * t.cols + c) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The area the hillshade canvas covers (half a cell past the outer cells). */
export function hillshadeBounds(t: HeightmapTerrain): [[number, number], [number, number]] {
  const h = t.cell / 2;
  return [[t.min[0] - h, t.min[1] - h], [t.min[0] + (t.cols - 1) * t.cell + h, t.min[1] + (t.rows - 1) * t.cell + h]];
}
