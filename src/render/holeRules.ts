// What a hole's own rules look like on the course: a mando's post with its arrow sign (and an arrow
// on the ground on the side to pass, for the map), a drop zone's pad, an island green's edge.
import * as THREE from 'three';
import type { DiscHole } from '../course/disc-types';
import type { Vec2 } from '../course/geo';
import { groundAt } from './ground';

const RED = new THREE.MeshLambertMaterial({ color: '#d8262c', side: THREE.DoubleSide });
const WHITE = new THREE.MeshLambertMaterial({ color: '#f4f1ea' });

/** A flat arrow pointing along +x, `len` m long. */
function arrowShape(len: number, w: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  const h = len / 2, head = len * 0.4;
  s.moveTo(-h, -w * 0.3); s.lineTo(h - head, -w * 0.3); s.lineTo(h - head, -w * 0.6); s.lineTo(h, 0);
  s.lineTo(h - head, w * 0.6); s.lineTo(h - head, w * 0.3); s.lineTo(-h, w * 0.3); s.closePath();
  return new THREE.ShapeGeometry(s);
}

function dzTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#222'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#222'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('DZ', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function holeRuleMarkers(holes: DiscHole[]): THREE.Group {
  const g = new THREE.Group();
  let dz: THREE.CanvasTexture | null = null;
  for (const h of holes) {
    for (const m of h.mandos ?? []) {
      const z = groundAt(m.at[0], m.at[1]);
      // Post with a sign on top pointing the way round (toward the hole's line, away from `away`).
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 8).rotateX(Math.PI / 2), WHITE);
      post.position.set(m.at[0], m.at[1], z + 1.1);
      const toward = Math.atan2(-m.away[1], -m.away[0]);
      const sign = new THREE.Mesh(arrowShape(0.9, 0.5).rotateX(Math.PI / 2), RED);
      sign.position.set(m.at[0] - m.away[0] * 0.45, m.at[1] - m.away[1] * 0.45, z + 2.0);
      sign.rotation.z = toward;
      // On the ground, on the side to pass, pointing the way the hole plays.
      const side: Vec2 = [m.at[0] - m.away[0] * 2.2, m.at[1] - m.away[1] * 2.2];
      const mark = new THREE.Mesh(arrowShape(2.6, 1.2), new THREE.MeshBasicMaterial({ color: '#d8262c', transparent: true, opacity: 0.9, depthWrite: false }));
      mark.position.set(side[0], side[1], groundAt(side[0], side[1]) + 0.07);
      mark.rotation.z = Math.atan2(m.dir[1], m.dir[0]);
      mark.renderOrder = 4;
      g.add(post, sign, mark);
    }
    if (h.drop) {
      dz ??= dzTexture();
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: dz, transparent: true, depthWrite: false }));
      pad.position.set(h.drop[0], h.drop[1], groundAt(h.drop[0], h.drop[1]) + 0.06);
      pad.rotation.z = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]) - Math.PI / 2;
      pad.renderOrder = 4;
      g.add(pad);
    }
    if (h.island) {
      const pts = h.island.map(([x, y]) => new THREE.Vector3(x, y, groundAt(x, y) + 0.08));
      const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#f2c230', transparent: true, opacity: 0.85, depthWrite: false }));
      edge.renderOrder = 4;
      g.add(edge);
    }
  }
  return g;
}
