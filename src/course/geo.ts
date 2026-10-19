// Local tangent frame: meters east (x) / north (y) of an origin. See docs/02-architecture.md.
// Equirectangular around the origin; error is negligible over a single hole.

export type Vec2 = [number, number];
export interface LatLon { lat: number; lon: number }

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

export class LocalFrame {
  private readonly mPerDegLon: number;

  constructor(readonly origin: LatLon) {
    this.mPerDegLon = M_PER_DEG_LON_EQ * Math.cos((origin.lat * Math.PI) / 180);
  }

  toLocal(lat: number, lon: number): Vec2 {
    return [(lon - this.origin.lon) * this.mPerDegLon, (lat - this.origin.lat) * M_PER_DEG_LAT];
  }

  toLatLon(x: number, y: number): LatLon {
    return { lat: this.origin.lat + y / M_PER_DEG_LAT, lon: this.origin.lon + x / this.mPerDegLon };
  }
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function polylineLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  return L;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToPolyline(p: Vec2, pts: Vec2[]): number {
  if (pts.length === 1) return dist(p, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/** Even-odd point-in-polygon over all rings (outer + holes). */
export function pointInRings(p: Vec2, rings: Vec2[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export function ringCentroid(ring: Vec2[]): Vec2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (a === 0) return ring[0];
  return [cx / (3 * a), cy / (3 * a)];
}
