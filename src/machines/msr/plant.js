// msr/plant.js - reactor vessel, head, graphite core, control rods, and the one-element drill-down.
import * as THREE from 'three';
import { lathe, outline, createFlow } from '../../kit/util.js';
import { G, V, PHI, saltMaterial, paintSalt, saltColor, fuelParticle, mesh, cyl } from './common.js';

const ell = (cx, cy, a, b, t0, t1, n) => Array.from({ length: n + 1 }, (_, k) => {
  const t = t0 + ((t1 - t0) * k) / n;
  return [cx + a * Math.cos(t), cy + b * Math.sin(t)];
});

export function buildVessel(M, seg, levelPlane) {
  const g = new THREE.Group();
  const ri = G.ri;
  const ro = ri + G.wall;
  const outerB = ell(0, G.cylY0, ro, G.domeB, 0, -Math.PI / 2, 14); // (ro,cylY0) -> (0, botY)
  const innerB = ell(0, G.cylY0, ri, G.domeB - G.wall, -Math.PI / 2, 0, 14); // (0, ..) -> (ri,cylY0)
  const profile = [[ri, G.cylY1], [ro + 0.2, G.cylY1], [ro + 0.2, G.cylY1 - 0.25], [ro, G.cylY1 - 0.25], ...outerB, ...innerB, [ri, G.cylY1]];
  const shell = lathe(profile, M.make('steel', { color: 0x5d6975 }), seg);
  g.add(shell);
  // drain nozzle under the bottom
  g.add(cyl(0.5, 0.5, 0.5, M.make('steel', { color: 0x5d6975 }), 24, 0, G.botY - 0.1, 0));
  // nozzles: 4 outlets (high), 4 inlets, 2 processing stubs on the -x side
  const nozGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 20);
  nozGeo.rotateZ(Math.PI / 2);
  nozGeo.translate(ro + 0.25, 0, 0);
  const noz = new THREE.InstancedMesh(nozGeo, M.make('steel', { color: 0x5d6975 }), 10);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  const put = (phi, y) => {
    q.setFromAxisAngle(V(0, 1, 0), -phi);
    noz.setMatrixAt(n++, m4.compose(V(0, y, 0), q, V(1, 1, 1)));
  };
  for (let k = 0; k < 4; k++) {
    put(PHI[k] + 0.2, G.outY);
    put(PHI[k] - 0.2, G.inY);
  }
  put((3 * Math.PI) / 2, 7.6);
  put((3 * Math.PI) / 2, 5.4);
  g.add(noz);
  // salt body in the vessel outside the core (clipped at the live level)
  const salt = saltMaterial(M, 0.62);
  salt.clippingPlanes = [levelPlane];
  const rc = G.coreR + 0.05;
  const body = [...ell(0, G.cylY0, ri - 0.02, G.domeB - G.wall - 0.02, -Math.PI / 2, 0, 14), [ri - 0.02, G.saltTop], [0, G.saltTop], [0, G.coreY1], [rc, G.coreY1], [rc, G.coreY0], [0, G.coreY0]];
  const sb = lathe(body, salt, seg);
  sb.userData.fx = false;
  g.add(sb);
  return { object: g, salt };
}

export function buildHead(M, seg) {
  const g = new THREE.Group();
  const ri = G.ri;
  const ro = ri + G.wall;
  const out = ell(0, G.cylY1, ro, G.topY - G.cylY1, 0, Math.PI / 2, 14); // (ro,cylY1)->(0,topY)
  const inn = ell(0, G.cylY1, ri, G.topY - G.cylY1 - G.wall, Math.PI / 2, 0, 14);
  const prof = [[ro + 0.2, G.cylY1], [ro + 0.2, G.cylY1 + 0.2], [ro, G.cylY1 + 0.2], ...out.slice(1), ...inn, [ri, G.cylY1], [ro + 0.2, G.cylY1]];
  g.add(lathe(prof, M.make('steel', { color: 0x5d6975 }), seg));
  // flange bolts
  const bolt = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8);
  const bolts = new THREE.InstancedMesh(bolt, M.get('dark'), 40);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    bolts.setMatrixAt(i, m4.makeTranslation(Math.cos(a) * (ro + 0.1), G.cylY1 + 0.25, Math.sin(a) * (ro + 0.1)));
  }
  g.add(bolts);
  // rod drive housings and actuators
  for (let k = 0; k < 4; k++) {
    const x = Math.cos(PHI[k]) * G.rodHole * Math.SQRT2;
    const z = Math.sin(PHI[k]) * G.rodHole * Math.SQRT2;
    const hous = cyl(0.2, 0.2, G.driveTop - 9.3, M.get('stainless'), 16, x, (G.driveTop + 9.3) / 2, z);
    const act = cyl(0.32, 0.32, 0.8, M.get('dark'), 16, x, G.driveTop - 0.1, z);
    g.add(hous, act);
  }
  // instrument / off-gas stub
  g.add(cyl(0.25, 0.25, 0.9, M.get('stainless'), 14, 1.6, 10.3, 0.4));
  g.add(cyl(0.25, 0.25, 0.9, M.get('stainless'), 14, -1.4, 10.2, -1.2));
  return g;
}

/** Graphite core: 1412 instanced square elements, two zones, plus reflector, support plates, salt in the channels. */
export function buildCore(M, detail) {
  const g = new THREE.Group();
  const p = G.pitch;
  const cells = [];
  for (let i = -24; i < 24; i++)
    for (let j = -24; j < 24; j++) {
      const x = (i + 0.5) * p;
      const z = (j + 0.5) * p;
      cells.push({ x, z, r: Math.hypot(x, z) });
    }
  cells.sort((a, b) => a.r - b.r);
  const hole = (c) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) if (Math.abs(c.x - sx * G.rodHole) < 0.11 && Math.abs(c.z - sz * G.rodHole) < 0.11) return true;
    return false;
  };
  const pick = cells.slice(0, 1428).filter((c) => !hole(c));
  const fC = 0.933;
  const fO = 0.794; // 1 - fraction^2 = salt fraction 13 % / 37 %
  const geo = new THREE.BoxGeometry(1, G.coreH, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.75, side: THREE.DoubleSide });
  const els = new THREE.InstancedMesh(geo, mat, pick.length);
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const zoneOf = [];
  pick.forEach((c, i) => {
    const f = c.r < G.centralR ? fC : fO;
    zoneOf.push(c.r < G.centralR ? 0 : 1);
    m4.compose(V(c.x, G.coreMid, c.z), new THREE.Quaternion(), V(p * f, 1, p * f));
    els.setMatrixAt(i, m4);
    els.setColorAt(i, col.set(0x3a4046));
  });
  g.add(els);
  // support plates and reflector
  const plate = M.make('graphite', { color: 0x4a5258 });
  g.add(cyl(G.coreR + 0.05, G.coreR + 0.05, 0.1, plate, 48, 0, G.coreY0 - 0.05, 0));
  g.add(cyl(G.coreR + 0.05, G.coreR + 0.05, 0.1, plate, 48, 0, G.coreY1 + 0.05, 0));
  const refl = lathe([[G.coreR + 0.06, G.coreY0 - 0.1], [G.reflR, G.coreY0 - 0.1], [G.reflR, G.coreY1 + 0.1], [G.coreR + 0.06, G.coreY1 + 0.1], [G.coreR + 0.06, G.coreY0 - 0.1]], plate, 48);
  g.add(refl);
  // rod channel sleeves
  const sl = new THREE.CylinderGeometry(0.1, 0.1, G.coreH, 14, 1, true);
  const sleeves = new THREE.InstancedMesh(sl, M.get('stainless'), 4);
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].forEach(([sx, sz], i) => sleeves.setMatrixAt(i, m4.makeTranslation(sx * G.rodHole, G.coreMid, sz * G.rodHole)));
  g.add(sleeves);
  // salt in the channels (visible through the gaps): scaled by level
  const chan = saltMaterial(M, 0.95);
  const chanMesh = mesh(new THREE.CylinderGeometry(G.coreR, G.coreR, 1, 40, 1, false), chan, 0, G.coreMid, 0);
  chanMesh.scale.y = G.coreH;
  g.add(chanMesh);
  // salt circulation drawn along the default cut face so the upflow shows: up through the channels, down the gap around the core
  const dx = Math.cos(0.2618); // cut plane direction for cutAngle 345 deg (normal = (sin15, -cos15))
  const dz = Math.sin(0.2618);
  const nx = Math.sin(0.2618);
  const nz = -Math.cos(0.2618);
  const at = (s2, off) => [s2 * dx + off * nx, s2 * dz + off * nz];
  const paths = [];
  for (const s2 of [-1.7, -1.1, -0.5, 0.1, 0.7, 1.3, 1.9]) {
    const [x, z] = at(s2, 0.12);
    paths.push({ points: [[x, 4.6, z], [x, 6.6, z], [x, 8.6, z], [x * 1.05, 9.0, z * 1.05]], count: 5 });
  }
  for (const s2 of [-2.9, 2.9]) {
    const [x, z] = at(s2, 0.12);
    paths.push({ points: [[x, 8.4, z], [x, 6.4, z], [x, 4.4, z]], count: 7 });
  }
  const flow = createFlow(paths, { size: 0.7, opacity: 1, res: 120 });
  g.add(flow.object);
  const cIn = new THREE.Color();
  const cOut = new THREE.Color();
  const cm = new THREE.Color();
  let lastKey = '';
  function update(state, dt) {
    fuelParticle(state.Tin, cIn);
    fuelParticle(state.Tout, cOut);
    flow.update(dt, 2.2 * state.flowFrac, (pi, u) => (pi < 7 ? cm.copy(cIn).lerp(cOut, u) : cIn));
    const top = G.saltBot + (G.saltTop - G.saltBot) * state.level;
    const h = Math.max(0.001, Math.min(G.coreY1, top) - G.coreY0);
    chanMesh.scale.y = h;
    chanMesh.position.y = G.coreY0 + h / 2;
    chanMesh.visible = top > G.coreY0 + 0.01;
    paintSalt(chan, state.Tavg, 0.4 + 0.5 * Math.min(1, state.fissionPct / 100));
    const key = Math.round(state.Tgraphite / 6);
    if (key !== lastKey) {
      lastKey = key;
      const t = Math.min(1, Math.max(0, (state.Tgraphite - 450) / 300));
      for (let i = 0; i < pick.length; i++) {
        col.setRGB(0.2 + 0.13 * t, 0.22 + 0.04 * t, 0.25 - 0.04 * t);
        if (zoneOf[i] === 0) col.multiplyScalar(0.92);
        els.setColorAt(i, col);
      }
      els.instanceColor.needsUpdate = true;
    }
  }
  return { object: g, update, count: pick.length };
}

/** Four control rods (instanced), with shafts up to the drive housings. */
export function buildRods(M) {
  const g = new THREE.Group();
  const rg = new THREE.CylinderGeometry(0.07, 0.07, G.rodLen, 14);
  rg.translate(0, G.rodLen / 2, 0);
  const rods = new THREE.InstancedMesh(rg, M.get('absorber'), 4);
  const sg = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
  sg.translate(0, 0.5, 0);
  const shafts = new THREE.InstancedMesh(sg, M.get('stainless'), 4);
  g.add(rods, shafts);
  const m4 = new THREE.Matrix4();
  let last = -1;
  const pos = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [a * G.rodHole, b * G.rodHole]);
  function setPos(x) {
    if (Math.abs(x - last) < 1e-5) return;
    last = x;
    const tip = G.rodTip(x);
    pos.forEach(([px, pz], i) => {
      rods.setMatrixAt(i, m4.makeTranslation(px, tip, pz));
      const top = tip + G.rodLen;
      shafts.setMatrixAt(i, m4.compose(V(px, top, pz), new THREE.Quaternion(), V(1, Math.max(0.01, G.driveTop - 0.4 - top), 1)));
    });
    rods.instanceMatrix.needsUpdate = shafts.instanceMatrix.needsUpdate = true;
  }
  setPos(0.85);
  return { object: g, setPos };
}

/** One graphite element and its neighbours, magnified. Parked high above the plant, shown only when isolated. */
export function buildElementDrill(M) {
  const g = new THREE.Group();
  const K = 7; // magnification
  const p = G.pitch * K;
  const f = 0.933 * p;
  const len = 1.8;
  const graphite = M.make('graphite', { color: 0x464e55 });
  const hi = M.make('graphite', { color: 0x6a737b });
  const grooveSalt = saltMaterial(M, 0.95);
  paintSalt(grooveSalt, 704, 0.6);
  // 3 x 3 block, centre element highlighted. Each element has a shallow groove down each face.
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      const m = mesh(new THREE.BoxGeometry(f, len, f), i === 0 && j === 0 ? hi : graphite, i * p, 0, j * p);
      g.add(m);
      outline(m, { opacity: 0.5 });
    }
  // salt channels in the gaps between elements: 2 x 2 lanes of slabs
  const gap = p - f;
  for (const a of [-0.5, 0.5]) {
    const sx = mesh(new THREE.BoxGeometry(gap, len * 0.98, 3 * p), grooveSalt, a * p, 0, 0);
    const sz = mesh(new THREE.BoxGeometry(3 * p, len * 0.98, gap), grooveSalt, 0, 0, a * p);
    g.add(sx, sz);
  }
  g.userData.groove = grooveSalt;
  g.position.set(60, 4, 0);
  return { object: g, mat: grooveSalt };
}
