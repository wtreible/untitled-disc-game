// "Class render" view (D6): redraw the hole from surface classes instead of the photo.
import type { Vec2 } from '../course/geo';
import { SURFACE_CLASSES, type SurfaceClass } from '../course/types';
import type { SurfaceGrid } from '../game/surfaces';

export const CLASS_COLORS: Record<SurfaceClass, [number, number, number]> = {
  oob: [58, 58, 54],
  rough: [78, 122, 58],
  trees: [40, 82, 40],
  path: [185, 178, 163],
  fairway: [108, 172, 76],
  tee: [120, 190, 86],
  green: [134, 210, 102],
  bunker: [233, 220, 174],
  water: [61, 127, 196],
};

/** One pixel per grid cell. Row 0 of the canvas is maxY (north-up image). */
export function classCanvas(grid: SurfaceGrid, holeDir: Vec2, alpha = 255): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.cols;
  canvas.height = grid.rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(grid.cols, grid.rows);
  const d = img.data;
  for (let r = 0; r < grid.rows; r++) {
    const y = grid.min[1] + (r + 0.5) * grid.cell;
    const outRow = grid.rows - 1 - r;
    for (let c = 0; c < grid.cols; c++) {
      const x = grid.min[0] + (c + 0.5) * grid.cell;
      const i = r * grid.cols + c;
      const cls = SURFACE_CLASSES[grid.cls[i]];
      let [R, G, B] = CLASS_COLORS[cls];
      let shade = 1;
      // Cheap procedural detail: mowing stripes across the hole, sand grain, tree canopy noise.
      const along = x * holeDir[0] + y * holeDir[1];
      if (cls === 'fairway' || cls === 'tee') shade = Math.floor(along / 8) % 2 === 0 ? 1.06 : 0.95;
      else if (cls === 'green') shade = Math.floor(along / 3) % 2 === 0 ? 1.03 : 0.98;
      else if (cls === 'bunker') shade = 0.94 + hash(c, r) * 0.1;
      else if (cls === 'trees' || grid.canopy[i] > 0) { shade = 0.75 + hash(c >> 2, r >> 2) * 0.3; [R, G, B] = CLASS_COLORS.trees; }
      else if (cls === 'rough') shade = 0.95 + hash(c >> 1, r >> 1) * 0.08;
      else if (cls === 'water') shade = 0.97 + Math.sin(along * 0.8) * 0.03;
      const o = (outRow * grid.cols + c) * 4;
      d[o] = Math.min(255, R * shade);
      d[o + 1] = Math.min(255, G * shade);
      d[o + 2] = Math.min(255, B * shade);
      d[o + 3] = cls === 'oob' && alpha < 255 ? 0 : alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
