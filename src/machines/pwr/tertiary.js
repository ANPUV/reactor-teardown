// pwr/tertiary.js - third circuit (circulating water + natural-draft cooling tower) and the generator output / grid.
import * as THREE from 'three';
import { lathe, pipe, createFlow, createPlume, outline, reducedMotion, mergeStatic } from '../../kit/util.js';
import { spec } from './spec.js';

const S = spec.items;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const TOWER = { x: 140, z: -130, h: S.towerHeight.v, rBase: S.towerBaseD.v / 2, rThroat: S.towerThroatD.v / 2, yThroat: 0.75 * S.towerHeight.v, basinR: S.towerBaseD.v / 2 - 3, headerY: 16 };
const rAt = (y) => {
  const k = (TOWER.rBase ** 2 - TOWER.rThroat ** 2) / TOWER.yThroat ** 2;
  return Math.sqrt(TOWER.rThroat ** 2 + k * (y - TOWER.yThroat) ** 2);
};
// unit vector from the tower centre towards the power block; the riser stands on that side
const DIR = (() => {
  const dx = 50 - 140;
  const dz = -10 + 130;
  const L = Math.hypot(dx, dz);
  return [dx / L, dz / L];
})();
export const riserAt = (r = 28) => V(TOWER.x + DIR[0] * r, 0, TOWER.z + DIR[1] * r);

export function buildTower(M, seg, detail) {
  const root = new THREE.Group();
  const T = TOWER;
  const prof = [];
  for (let i = 0; i <= 40; i++) {
    const y = (i / 40) * T.h;
    prof.push([rAt(y), y + 0.0]);
  }
  const shellMat = M.make('concrete', { color: 0xa2a9ae });
  const shell = lathe(prof, shellMat, Math.max(48, seg + 8));
  shell.position.set(T.x, 0, T.z);
  root.add(shell);
  // formwork lifts: thin ink rings so the pale shell reads on the white ground
  const ringPts = [];
  const N = 72;
  for (let k = 1; k <= 14; k++) {
    const y = (k / 15) * T.h;
    const r = rAt(y);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2;
      const a1 = ((i + 1) / N) * Math.PI * 2;
      ringPts.push(T.x + r * Math.cos(a0), y, T.z + r * Math.sin(a0), T.x + r * Math.cos(a1), y, T.z + r * Math.sin(a1));
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(ringPts, 3));
  root.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 })));
  // rim lines at base and top
  for (const y of [0.05, T.h]) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(T.x + rAt(y) * Math.cos(a), y, T.z + rAt(y) * Math.sin(a)));
    }
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 })));
  }
  // A-frame columns around the air inlet
  const colGeo = new THREE.CylinderGeometry(0.7, 0.7, 11, 8);
  const cols = new THREE.InstancedMesh(colGeo, M.make('concrete', { color: 0x8a939a }), 48);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    m4.compose(V(T.x + (T.rBase - 0.4) * Math.cos(a), 5.5, T.z + (T.rBase - 0.4) * Math.sin(a)), new THREE.Quaternion(), V(1, 1, 1));
    cols.setMatrixAt(i, m4);
  }
  root.add(cols);
  // cold-water basin
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(T.basinR, T.basinR, 1.6, 64), M.make('concrete', { color: 0x7d868d }));
  basin.position.set(T.x, 0.8, T.z);
  root.add(basin);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(T.basinR - 1, T.basinR - 1, 0.2, 64), M.make('water', { color: 0x2563eb, opacity: 0.6 }));
  water.position.set(T.x, 1.55, T.z);
  root.add(water);
  // fill (packing): two translucent decks with an ink grid
  const fillMat = M.make('water', { color: 0x4b6a8f, opacity: 0.22 });
  for (const y of [8, 10.5]) {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(T.basinR - 6, T.basinR - 6, 0.3, 64), fillMat);
    d.position.set(T.x, y, T.z);
    root.add(d);
  }
  const gl = [];
  for (let r = 6; r <= 50; r += 4)
    for (let i = 0; i < 64; i++) {
      const a0 = (i / 64) * Math.PI * 2;
      const a1 = ((i + 1) / 64) * Math.PI * 2;
      gl.push(T.x + r * Math.cos(a0), 10.8, T.z + r * Math.sin(a0), T.x + r * Math.cos(a1), 10.8, T.z + r * Math.sin(a1));
    }
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    gl.push(T.x + 6 * Math.cos(a), 10.8, T.z + 6 * Math.sin(a), T.x + 50 * Math.cos(a), 10.8, T.z + 50 * Math.sin(a));
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gl, 3));
  root.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })));
  // water distribution: riser, ring header and spokes
  const pm = M.make('steel', { color: 0xc0653f, transparent: true, opacity: 0.8 });
  const riserPos = riserAt(28);
  const riser = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, T.headerY - 1.5, 16), pm);
  riser.position.set(riserPos.x, 1.5 + (T.headerY - 1.5) / 2, riserPos.z);
  root.add(riser);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(28, 0.7, 10, 72), pm);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(T.x, T.headerY, T.z);
  root.add(ring);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const len = 44;
    const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, len, 8), pm);
    sp.rotation.z = Math.PI / 2;
    sp.rotation.y = -a;
    sp.position.set(T.x + (len / 2 - 2) * Math.cos(a), T.headerY, T.z + (len / 2 - 2) * Math.sin(a));
    root.add(sp);
  }
  // falling water (rain through the fill): one Points object
  const nRain = Math.round(380 + 320 * detail);
  const rp = new Float32Array(nRain * 3);
  const rph = new Float32Array(nRain);
  const rx0 = new Float32Array(nRain);
  const rz0 = new Float32Array(nRain);
  for (let i = 0; i < nRain; i++) {
    const a = i * 2.399963;
    const r = 6 + 44 * Math.sqrt((i + 0.5) / nRain);
    rx0[i] = T.x + r * Math.cos(a);
    rz0[i] = T.z + r * Math.sin(a);
    rph[i] = (i * 0.618034) % 1;
  }
  const rg2 = new THREE.BufferGeometry();
  rg2.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.Points(rg2, new THREE.PointsMaterial({ color: 0x2563eb, size: 0.55, transparent: true, opacity: 0.9, depthWrite: false }));
  rain.frustumCulled = false;
  rain.userData.fx = true;
  root.add(rain);
  // vapour plume from the throat top
  const plume = createPlume({ radius: 9, height: 62, count: Math.round(260 + 260 * detail), size: 22, wind: [5, -2] });
  plume.object.position.set(T.x, T.h, T.z);
  root.add(plume.object);
  mergeStatic(root);
  const still = reducedMotion();
  let phase = 0;
  function update(state, dt) {
    const rej = Math.max(0, state.steamMW - state.electricMW) / (S.thermal.v - S.electric.v);
    const f = Math.min(1.2, rej);
    phase += still ? 0 : dt * (0.25 + 0.75 * Math.min(1, f)) * 0.7;
    for (let i = 0; i < nRain; i++) {
      const u = (rph[i] + phase) % 1;
      rp[i * 3] = rx0[i];
      rp[i * 3 + 1] = 15.5 - u * 14;
      rp[i * 3 + 2] = rz0[i];
    }
    rg2.attributes.position.needsUpdate = true;
    rain.material.opacity = 0.15 + 0.75 * Math.min(1, f * 1.5);
    plume.update(dt, Math.min(1, Math.pow(f, 0.8)), 1);
  }
  return { object: root, update };
}

/** Circulating-water loop: pump house, cold pipe basin -> condenser, warm pipe condenser -> tower riser. */
export function buildCirculating(M, seg) {
  const root = new THREE.Group();
  const T = TOWER;
  const ph = new THREE.Mesh(new THREE.BoxGeometry(11, 4.5, 7), M.make('concrete', { color: 0x959da4 }));
  ph.position.set(58, 2.25, -22);
  root.add(ph);
  outline(ph, { opacity: 0.5 });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.4, 7.6), M.make('steel', { color: 0x5b6b78 }));
  roof.position.set(58, 4.7, -22);
  root.add(roof);
  for (let i = 0; i < 3; i++) {
    const mt = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3, 16), M.make('paint', { color: 0x4f5d69 }));
    mt.position.set(55 + i * 3, 6.4, -22);
    root.add(mt);
  }
  const coldMat = M.make('steel', { color: 0x2563eb, transparent: true, opacity: 0.6 });
  const warmMat = M.make('steel', { color: 0xc0653f, transparent: true, opacity: 0.6 });
  const bp = riserAt(54);
  const basinPt = V(bp.x, 1.4, bp.z);
  const cold = [basinPt, V(100, 1.4, -78), V(80, 1.4, -52), V(64, 1.4, -26), V(48, 1.4, -14), V(38, 1.5, -7), V(36.4, 1.7, -1.5)];
  const rb = riserAt(28);
  const riserBase = V(rb.x, 1.5, rb.z);
  const warm = [V(50.6, 1.7, -1.5), V(56, 1.6, -10), V(85, 1.6, -48), V(110, 1.6, -85), V(122, 1.6, -105), riserBase];
  root.add(pipe(cold, 0.9, coldMat, { segments: 48, radial: 12, tension: 0.15 }));
  root.add(pipe(warm, 0.9, warmMat, { segments: 48, radial: 12, tension: 0.15 }));
  const flowCold = createFlow([{ points: cold.map((p) => p.toArray()), count: 36 }], { size: 0.9, opacity: 0.95 });
  const flowWarm = createFlow([{ points: [...warm, V(riserBase.x, T.headerY, riserBase.z)].map((p) => p.toArray()), count: 36 }], { size: 0.9, opacity: 0.95 });
  mergeStatic(root);
  root.add(flowCold.object, flowWarm.object);
  const cc = new THREE.Color(0x2563eb);
  const wc = new THREE.Color(0xdc2626);
  function update(state, dt) {
    const rej = Math.max(0, state.steamMW - state.electricMW) / (S.thermal.v - S.electric.v);
    const sp = 6 * Math.min(1.1, 0.12 + rej);
    flowCold.update(dt, sp, () => cc);
    flowWarm.update(dt, sp, () => wc);
  }
  return { object: root, update };
}

/** Generator output: step-up transformer, a short line on pylons, orange pulses along the wires ~ MWe. */
export function buildGrid(M, seg) {
  const root = new THREE.Group();
  const steel = M.make('steel', { color: 0x5b6b78 });
  const tr = new THREE.Mesh(new THREE.BoxGeometry(7, 6, 5), M.make('paint', { color: 0x6c7a86 }));
  tr.position.set(58, 3, 10);
  root.add(tr);
  outline(tr, { opacity: 0.5 });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.2, 10), M.make('stainless', { color: 0xdedede }));
    b.position.set(56 + i * 2, 7.6, 10);
    root.add(b);
    outline(b, { opacity: 0.6 });
  }
  // generator leads: stator casing -> transformer bushings
  const lead = M.make('copper', { color: 0xa66535 });
  for (let i = 0; i < 3; i++) root.add(pipe([V(55 + i * 1.5, 8.6, 0.5), V(55.5 + i, 11.5, 4), V(56 + i * 2, 9.6, 10)], 0.28, lead, { segments: 16, radial: 8, tension: 0.3 }));
  // pylons
  const pyl = (z) => {
    const g = new THREE.Group();
    const legGeo = new THREE.CylinderGeometry(0.25, 0.7, 26, 6);
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
      const l = new THREE.Mesh(legGeo, steel);
      l.position.set(dx * 0.7, 13, dz * 0.7);
      l.rotation.set(dz * 0.02, 0, -dx * 0.02);
      g.add(l);
    }
    const arm = new THREE.Mesh(new THREE.BoxGeometry(11, 0.4, 0.5), steel);
    arm.position.y = 24;
    g.add(arm);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 3, 0.6), steel);
    top.position.y = 27;
    g.add(top);
    g.position.set(58, 0, z);
    return g;
  };
  const zs = [22, 38, 54];
  zs.forEach((z) => root.add(pyl(z)));
  const wires = [];
  for (let w = 0; w < 3; w++) {
    const x = 58 - 4.5 + w * 4.5;
    const pts = [V(56 + w * 2, 9.6, 10)];
    pts.push(V(x, 24, zs[0]));
    for (let i = 0; i < zs.length - 1; i++) pts.push(V(x, 21.5, (zs[i] + zs[i + 1]) / 2), V(x, 24, zs[i + 1]));
    wires.push(pts);
    root.add(pipe(pts, 0.12, M.make('dark', { color: 0x1a1a1a }), { segments: 80, radial: 4, tension: 0.2 }));
  }
  const flow = createFlow(wires.map((p) => ({ points: p.map((q) => q.toArray()), count: 22 })), { size: 1.1, opacity: 1 });
  flow.object.material.color.set(0xff4500);
  mergeStatic(root);
  root.add(flow.object);
  const mark = new THREE.Color(0xff4500);
  const still = reducedMotion();
  function update(state, dt) {
    const f = state.electricMW / S.electric.v;
    flow.object.visible = f > 0.01 && !still;
    flow.update(dt, 22 * Math.min(1.1, f), () => mark);
  }
  return { object: root, update };
}
