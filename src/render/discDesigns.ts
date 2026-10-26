// Disc designs: the stamp on the top of a player's disc, drawn in their color. The same drawing is
// the disc's texture in 3D and its preview on the menu.
import * as THREE from 'three';

export const DISC_DESIGNS: [string, string][] = [
  ['solid', 'Solid'], ['stripes', 'Stripes'], ['swirl', 'Swirl'], ['flame', 'Flames'],
  ['star', 'Star'], ['tiedye', 'Tie-dye'], ['bullseye', 'Bullseye'], ['galaxy', 'Galaxy'],
];
export const isDesign = (d: string | undefined): d is string => !!d && DISC_DESIGNS.some(([v]) => v === d);

/** The color a bit lighter (k > 0) or darker (k < 0). */
function shade(color: string, k: number): string {
  const c = new THREE.Color(color);
  return `#${(k > 0 ? c.lerp(new THREE.Color('#ffffff'), k) : c.lerp(new THREE.Color('#000000'), -k)).getHexString()}`;
}

/** The accents a design is drawn with: near-black on a light disc, near-white on a darker one. */
export const ACCENT_DARK = '#161616', ACCENT_LIGHT = '#f6f4ee';
/** How light a color looks (relative luminance, 0 black … 1 white). */
function luminance(color: string): number {
  const c = new THREE.Color(color);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // three keeps colors linear
}
export const accentFor = (color: string) => (luminance(color) > 0.35 ? ACCENT_DARK : ACCENT_LIGHT);

/** A disc's top, `size` px square: the design in `color`, round, on transparent. */
export function designCanvas(design: string, color: string, size = 128): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const R = size / 2;
  g.save();
  g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = color; g.fillRect(0, 0, size, size);
  // `light` is the design's accent (it reads against the disc), `dark` its outline and the rim.
  const light = accentFor(color), dark = light === ACCENT_DARK ? shade(color, -0.25) : shade(color, -0.35);
  switch (design) {
    case 'stripes':
      g.fillStyle = light;
      for (let x = -size; x < size * 2; x += size / 5) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + size / 10, 0); g.lineTo(x + size / 10 - size, size); g.lineTo(x - size, size); g.fill(); }
      break;
    case 'swirl':
      g.strokeStyle = light; g.lineWidth = size / 14;
      g.beginPath();
      for (let a = 0; a < Math.PI * 7; a += 0.05) { const r = (a / (Math.PI * 7)) * R * 0.95; g.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r); }
      g.stroke();
      break;
    case 'flame':
      for (const [col, k] of [['#ffb02e', 1], ['#ff5a1f', 0.7], ['#ffe066', 0.4]] as [string, number][]) {
        g.fillStyle = col;
        g.beginPath(); g.moveTo(R - R * 0.75 * k, R + R * 0.7);
        for (let i = 0; i <= 6; i++) { const x = R - R * 0.75 * k + (i / 6) * R * 1.5 * k; g.quadraticCurveTo(x - R * 0.12 * k, R - R * (0.2 + (i % 2) * 0.55) * k, x, R + R * 0.7 - (i % 2 ? R * 0.1 : 0)); }
        g.closePath(); g.fill();
        // Outlined in the accent, so warm flames still read on a yellow or orange disc.
        g.strokeStyle = light; g.lineWidth = size / 70; g.stroke();
      }
      break;
    case 'star': {
      g.fillStyle = light;
      g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? R * 0.28 : R * 0.68; g.lineTo(R + Math.cos(a) * r, R + Math.sin(a) * r); }
      g.closePath(); g.fill();
      g.strokeStyle = dark; g.lineWidth = size / 40; g.stroke();
      break;
    }
    case 'tiedye':
      for (let i = 0; i < 7; i++) {
        g.strokeStyle = `hsla(${(i * 52 + new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).h * 360) % 360}, 85%, 60%, 0.75)`;
        g.lineWidth = size / 9;
        g.beginPath(); g.arc(R + Math.cos(i) * R * 0.1, R + Math.sin(i) * R * 0.1, R * (0.15 + i * 0.13), i * 0.7, i * 0.7 + Math.PI * 1.4); g.stroke();
      }
      break;
    case 'bullseye':
      for (let i = 4; i >= 1; i--) { g.fillStyle = i % 2 ? light : color; g.beginPath(); g.arc(R, R, (R * i) / 4.4, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = dark; g.beginPath(); g.arc(R, R, R * 0.08, 0, Math.PI * 2); g.fill();
      break;
    case 'galaxy': {
      const grad = g.createRadialGradient(R, R, R * 0.1, R, R, R);
      grad.addColorStop(0, shade(color, 0.3)); grad.addColorStop(0.5, shade(color, -0.45)); grad.addColorStop(1, '#0b0b1e');
      g.fillStyle = grad; g.fillRect(0, 0, size, size);
      let seed = 3;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 40; i++) { g.globalAlpha = 0.4 + rnd() * 0.6; g.beginPath(); g.arc(rnd() * size, rnd() * size, rnd() * size / 70 + 0.5, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
      break;
    }
  }
  g.restore();
  // The rim.
  g.strokeStyle = dark; g.lineWidth = size / 22;
  g.beginPath(); g.arc(R, R, R - g.lineWidth / 2, 0, Math.PI * 2); g.stroke();
  return c;
}

/** The disc's materials (side, top, bottom: a CylinderGeometry's groups) for a design. */
export function designMaterials(design: string | undefined, color: string): THREE.MeshLambertMaterial | THREE.MeshLambertMaterial[] {
  if (!isDesign(design) || design === 'solid') return new THREE.MeshLambertMaterial({ color });
  const tex = new THREE.CanvasTexture(designCanvas(design, color));
  tex.colorSpace = THREE.SRGBColorSpace;
  const rim = new THREE.MeshLambertMaterial({ color: shade(color, -0.2) });
  return [rim, new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ color: shade(color, -0.3) })];
}
