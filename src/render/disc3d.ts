// 3D models for disc golf: basket (to standard dimensions), instanced trees, disc.
import * as THREE from 'three';
import type { Tree } from '../course/disc-types';
import { DISC_RADIUS } from '../disc/discs';
import { BASKET } from '../disc/flight';

export function basketModel(): THREE.Group {
  const g = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: '#b9bec4' });
  const yellow = new THREE.MeshLambertMaterial({ color: '#f2c230' });
  const B = BASKET;

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(B.poleR, B.poleR, B.bandTop + 0.05, 10), metal);
  pole.rotation.x = Math.PI / 2;
  pole.position.z = (B.bandTop + 0.05) / 2;
  g.add(pole);

  // Tray: open-topped cylinder wall plus a floor.
  const trayH = B.trayTop - B.trayBottom;
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(B.trayR, B.trayR * 0.92, trayH, 28, 1, true), new THREE.MeshLambertMaterial({ color: '#9aa1a8', side: THREE.DoubleSide }));
  tray.rotation.x = Math.PI / 2;
  tray.position.z = B.trayBottom + trayH / 2;
  g.add(tray);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(B.trayR * 0.92, 28), metal);
  floor.position.z = B.trayBottom + 0.01;
  g.add(floor);
  const trayBand = new THREE.Mesh(new THREE.TorusGeometry(B.trayR, 0.012, 6, 32), yellow);
  trayBand.position.z = B.trayTop;
  g.add(trayBand);

  // Top band and lid.
  const band = new THREE.Mesh(new THREE.CylinderGeometry(B.bandR, B.bandR, B.bandTop - B.chainTop, 28, 1, true), new THREE.MeshLambertMaterial({ color: '#f2c230', side: THREE.DoubleSide }));
  band.rotation.x = Math.PI / 2;
  band.position.z = (B.chainTop + B.bandTop) / 2;
  g.add(band);
  const lid = new THREE.Mesh(new THREE.CircleGeometry(B.bandR, 28), yellow);
  lid.position.z = B.bandTop;
  g.add(lid);

  // Chains: two rings of chains hanging from the band, gathered toward the pole at the bottom.
  const pts: number[] = [];
  const ring = (n: number, rTop: number, rBot: number, twist: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const steps = 6;
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps, t1 = (k + 1) / steps;
        const at = (t: number) => {
          // Sag outward a little mid-chain.
          const r = rTop + (rBot - rTop) * t + Math.sin(Math.PI * t) * 0.02;
          const ang = a + twist * t;
          return [Math.cos(ang) * r, Math.sin(ang) * r, B.chainTop - (B.chainTop - B.trayTop - 0.04) * t];
        };
        pts.push(...at(t0), ...at(t1));
      }
    }
  };
  ring(24, B.chainR, 0.06, 0.25);
  ring(12, B.chainR * 0.55, 0.04, -0.2);
  const chains = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: '#d7dbe0' }));
  g.add(chains);
  return g;
}

/** Instanced trunks + crowns. Crowns are ellipsoids matching the collision model. */
export function treeMeshes(trees: Tree[]): THREE.Group {
  const g = new THREE.Group();
  const n = trees.length;
  const trunkGeo = new THREE.CylinderGeometry(1, 1.2, 1, 7);
  trunkGeo.rotateX(Math.PI / 2);
  trunkGeo.translate(0, 0, 0.5);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#5b4632' }), n);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  trees.forEach((t, i) => {
    m.compose(new THREE.Vector3(t.x, t.y, 0), q, new THREE.Vector3(t.t, t.t, t.h * 0.9));
    trunks.setMatrixAt(i, m);
    const hz = Math.max(0.3, (t.h - t.b) / 2);
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (t.x * 7.13 + t.y * 3.7) % (Math.PI * 2));
    m.compose(new THREE.Vector3(t.x, t.y, t.b + hz), yaw, new THREE.Vector3(t.r, t.r, hz));
    crowns.setMatrixAt(i, m);
    // Conifers (low crown base) darker, broadleaf lighter; a little per-tree variation.
    const v = ((t.x * 12.9898 + t.y * 78.233) % 1 + 1) % 1;
    const conifer = t.b < t.h * 0.25;
    c.setHSL(conifer ? 0.36 : 0.27 + v * 0.04, 0.45 + v * 0.15, conifer ? 0.16 + v * 0.05 : 0.24 + v * 0.08);
    crowns.setColorAt(i, c);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  g.add(trunks, crowns);
  return g;
}

export function discMesh(color: string): THREE.Mesh {
  // Flattened, slightly domed disc.
  const geo = new THREE.CylinderGeometry(DISC_RADIUS * 0.92, DISC_RADIUS, 0.022, 28);
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
}
