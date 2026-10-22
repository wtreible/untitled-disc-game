// Driving range distance markers: every 100 ft a big sign on each side of the lane and a big number
// painted on the grass; every 50 ft between, a smaller number and an orange cone at each end of the
// line. The lines themselves are ground decals (src/course/range.ts). Seen from the tee and top-down.
import * as THREE from 'three';
import { FT, LANE_HALF, RANGE_MARKS, isMajor } from '../course/range';

const FONT = "'Barlow Condensed', 'Arial Narrow', 'Roboto Condensed', system-ui, sans-serif";

/** A canvas texture with "<n> FT", redrawn once the web font has loaded. */
function label(ft: number, w: number, h: number, style: { bg?: string; border?: string; color: string }): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    if (style.bg) {
      g.fillStyle = style.bg;
      g.fillRect(0, 0, w, h);
    }
    if (style.border) {
      g.strokeStyle = style.border;
      g.lineWidth = h * 0.07;
      g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    }
    g.fillStyle = style.color;
    g.textBaseline = 'middle';
    const big = `800 ${Math.round(h * 0.78)}px ${FONT}`, small = `700 ${Math.round(h * 0.3)}px ${FONT}`;
    g.font = big;
    const nw = g.measureText(String(ft)).width;
    g.font = small;
    const uw = g.measureText('FT').width;
    const x0 = (w - nw - uw - h * 0.08) / 2;
    g.font = big;
    g.fillText(String(ft), x0, h * 0.55);
    g.font = small;
    g.fillText('FT', x0 + nw + h * 0.08, h * 0.72);
    tex.needsUpdate = true;
  };
  draw();
  document.fonts?.ready.then(draw).catch(() => { /* keep the fallback font */ });
  return tex;
}

/** A flat number on the grass, reading from the tee (and up the screen top-down). */
function groundNumber(ft: number, width: number, x: number, y: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width / 2),
    new THREE.MeshBasicMaterial({ map: label(ft, 256, 128, { color: '#ffffff' }), transparent: true, opacity: 0.85, depthWrite: false }),
  );
  m.position.set(x, y, 0.03);
  m.renderOrder = -5;
  return m;
}

const post = new THREE.CylinderGeometry(0.07, 0.07, 1, 8).rotateX(Math.PI / 2).translate(0, 0, 0.5);
const postMat = new THREE.MeshLambertMaterial({ color: '#5b4632' });
const cone = new THREE.ConeGeometry(0.22, 0.55, 12).rotateX(Math.PI / 2).translate(0, 0, 0.275);
const coneMat = new THREE.MeshLambertMaterial({ color: '#ff7a1a' });

/** A sign board on two posts, facing the tee. */
function sign(ft: number, x: number, y: number): THREE.Group {
  const g = new THREE.Group();
  const w = 3.2, h = 1.6, z = 2.4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: label(ft, 256, 128, { bg: '#1f4a2e', border: '#f2c230', color: '#ffffff' }) }));
  face.rotation.x = Math.PI / 2; // stands up, facing −y (the tee)
  face.position.set(0, -0.02, z);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ color: '#2b2f2a' }));
  back.rotation.x = -Math.PI / 2;
  back.position.set(0, 0.02, z);
  g.add(face, back);
  for (const px of [-w * 0.35, w * 0.35]) {
    const p = new THREE.Mesh(post, postMat);
    p.scale.set(1, 1, z + h / 2 - 0.1);
    p.position.set(px, 0.05, 0);
    g.add(p);
  }
  g.position.set(x, y, 0);
  return g;
}

export function rangeMarkers(): THREE.Group {
  const g = new THREE.Group();
  for (const ft of RANGE_MARKS) {
    const y = ft * FT;
    if (isMajor(ft)) {
      for (const side of [-1, 1]) g.add(sign(ft, side * (LANE_HALF + 9), y));
      g.add(groundNumber(ft, 10, 0, y + 3.6));
    } else {
      g.add(groundNumber(ft, 5, 0, y + 1.9));
      for (const side of [-1, 1]) {
        const c = new THREE.Mesh(cone, coneMat);
        c.position.set(side * LANE_HALF, y, 0);
        g.add(c);
      }
    }
  }
  return g;
}
