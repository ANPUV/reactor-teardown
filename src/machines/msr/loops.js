// msr/loops.js - fuel-salt pumps, primary piping, heat exchangers, coolant-salt loop, steam generator.
import * as THREE from 'three';
import { lathe, pipe, createFlow, outline } from '../../kit/util.js';
import { G, V, L, PHI, saltColor, mesh, cyl, saltMaterial, paintSalt, bake, fuelParticle, coolantParticle, STEAM_COL, WATER_COL } from './common.js';

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();
const ID = new THREE.Quaternion();

// ---------------------------------------------------------------- pumps
export function buildPumps(M, seg) {
  const root = new THREE.Group();
  const groups = [];
  const spinners = [];
  const steel = M.make('steel', { color: 0x5d6975 });
  const motor = M.make('paint', { color: 0x3f4a55 });
  for (let k = 0; k < 4; k++) {
    const u = new THREE.Group();
    const c = L(k, G.pumpR, 0, 0);
    const at = (r, t, y) => L(k, r, t, y);
    // volute casing + discharge / suction stubs
    u.add(mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.1, 32), steel, c.x, 5.2, c.z));
    const bowl = mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.5, 32), steel, c.x, 6.5, c.z);
    u.add(bowl);
    u.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 24), steel, c.x, 7.4, c.z));
    // stator housing + motor
    u.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.9, 28), motor, c.x, 8.5, c.z));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rib = mesh(new THREE.BoxGeometry(0.08, 1.7, 0.16), motor, c.x + Math.cos(a) * 0.66, 8.5, c.z + Math.sin(a) * 0.66);
      rib.rotation.y = -a;
      u.add(rib);
    }
    u.add(mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.45, 24), M.get('dark'), c.x, 9.65, c.z));
    // rotating assembly: shaft, impeller, flywheel with a marker bar so spin is visible
    const spin = new THREE.Group();
    spin.position.set(c.x, 0, c.z);
    spin.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 5.2, 12), M.get('stainless'), 0, 7.0, 0));
    spin.add(mesh(new THREE.CylinderGeometry(0.62, 0.45, 0.35, 20), M.get('stainless'), 0, 5.15, 0));
    const vanes = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.1), M.get('stainless'));
    vanes.position.y = 5.2;
    spin.add(vanes);
    const fly = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.22, 24), M.get('stainless'), 0, 8.0, 0);
    spin.add(fly);
    const mark = mesh(new THREE.BoxGeometry(0.7, 0.26, 0.1), M.make('copper', { color: 0xb9743e }), 0, 8.0, 0);
    spin.add(mark);
    spin.userData.noBake = true;
    const fanDisc = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 20), M.get('dark'), 0, 10.0, 0);
    spin.add(fanDisc);
    for (let b = 0; b < 4; b++) {
      const bar = mesh(new THREE.BoxGeometry(1.5, 0.12, 0.26), M.make('paint', { color: 0xea580c }), 0, 10.1, 0);
      bar.rotation.y = (b * Math.PI) / 4 * 2 + 0.0;
      if (b < 2) spin.add(bar);
    }
    u.add(spin);
    spinners.push(spin);
    // salt in the pump bowl (free surface, off-gas stripping happens here)
    const bs = saltMaterial(M, 0.8);
    const bsm = mesh(new THREE.CylinderGeometry(0.86, 0.86, 1.1, 28), bs, c.x, 6.3, c.z);
    u.add(bsm);
    u.userData.bowlSalt = bs;
    // off-gas stub on the bowl top
    u.add(cyl(0.16, 0.16, 0.9, M.get('stainless'), 10, c.x, 7.65 + 0.5, c.z));
    groups.push(u);
    root.add(u);
    bake(u);
  }
  let lastKey = '';
  function update(state, dt, M2) {
    const w = 9 * state.flowFrac;
    for (const s of spinners) s.rotation.y += w * dt;
    const key = Math.round(state.Tout / 3);
    if (key !== lastKey) {
      lastKey = key;
      for (const u of groups) paintSalt(u.userData.bowlSalt, state.Tout, 0.5);
    }
  }
  return { object: root, groups, update };
}

// ---------------------------------------------------------------- primary piping
export const hotPath = (k) => [L(k, 3.9, -0.9, G.outY), L(k, 5.0, -1.4, 9.0), L(k, 5.9, -1.2, 7.4), L(k, 6.15, -0.55, 5.5)];
export const dischargePath = (k) => [L(k, 7.6, 0.3, 5.1), L(k, 8.8, 0.3, 6.5), L(k, 9.9, 0.1, 7.6)];
export const returnPath = (k) => [L(k, 9.9, 0.2, 3.0), L(k, 8.0, 1.5, 3.2), L(k, 5.8, 1.9, 5.4), L(k, 4.6, 1.6, 7.8), L(k, 3.9, 0.9, G.inY)];

export function buildPiping(M, seg, detail) {
  const root = new THREE.Group();
  const hotMat = M.make('steel', { color: 0xc0653f, transparent: true, opacity: 0.38 });
  const coldMat = M.make('steel', { color: 0x6b8fb8, transparent: true, opacity: 0.38 });
  const groups = [];
  const flows = [];
  const cH = new THREE.Color();
  const cC = new THREE.Color();
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    g.add(pipe(hotPath(k), 0.4, hotMat, { segments: 30, radial: 14 }));
    g.add(pipe(dischargePath(k), 0.38, hotMat, { segments: 20, radial: 14 }));
    g.add(pipe(returnPath(k), 0.38, coldMat, { segments: 40, radial: 14 }));
    const n = Math.round(30 * Math.max(0.6, detail));
    const fl = createFlow(
      [
        { points: [...hotPath(k), ...dischargePath(k)].map((p) => p.toArray()), count: n },
        { points: returnPath(k).map((p) => p.toArray()), count: n },
      ],
      { size: 0.75, opacity: 1, res: 120 }
    );
    g.add(fl.object);
    flows.push(fl);
    groups.push(g);
    root.add(g);
  }
  function update(state, dt, M2) {
    M2.tempColor(state.Tout, 470, 720, cH);
    M2.tempColor(state.Tin, 470, 720, cC);
    hotMat.color.copy(cH);
    coldMat.color.copy(cC);
    const v = 7.5 * state.flowFrac;
    const hot = fuelParticle(state.Tout, tmpA).clone();
    const cold = fuelParticle(state.Tin, tmpB).clone();
    for (const f of flows) f.update(dt, v, (pi) => (pi === 0 ? hot : cold));
  }
  return { object: root, groups, update };
}

// ---------------------------------------------------------------- primary heat exchangers
export function buildHX(M, seg, detail) {
  const root = new THREE.Group();
  const groups = [];
  const shellMat = M.make('steel', { color: 0x5d6975 });
  const tubeMat = M.make('copper', { color: 0x7d8a96 });
  const R = 0.95;
  const y0 = 2.2;
  const y1 = 8.4;
  const prof = [];
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.sin(t), y0 + 0.5 - 0.5 * Math.cos(t)]);
  }
  prof.push([R, y1 - 0.5]);
  for (let i = 1; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.cos(t), y1 - 0.5 + 0.5 * Math.sin(t)]);
  }
  const nT = detail >= 0.9 ? 61 : 37;
  const tubeGeo = new THREE.CylinderGeometry(0.045, 0.045, y1 - y0 - 1.2, 8);
  const tubePos = [];
  for (let i = 0, c = 0; c < nT; i++) {
    const r = 0.1 + 0.68 * Math.sqrt(i / nT);
    const a = i * 2.39996;
    tubePos.push([Math.cos(a) * r, Math.sin(a) * r]);
    c++;
  }
  const m4 = new THREE.Matrix4();
  const tubesAll = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    const c = L(k, G.hxR, 0, 0);
    const shell = lathe(prof, shellMat, 36);
    shell.position.set(c.x, 0, c.z);
    g.add(shell);
    const tubes = new THREE.InstancedMesh(tubeGeo, tubeMat, nT);
    tubePos.forEach(([x, z], i) => tubes.setMatrixAt(i, m4.makeTranslation(c.x + x, (y0 + y1) / 2, c.z + z)));
    g.add(tubes);
    tubesAll.push(tubes);
    // tube sheets
    for (const y of [y0 + 0.6, y1 - 0.6]) g.add(mesh(new THREE.CylinderGeometry(R, R, 0.12, 32), M.get('stainless'), c.x, y, c.z));
    // primary (shell side) nozzles; secondary stubs top and bottom
    const nz = (r, y) => {
      const p = L(k, r, 0, y);
      const m = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.8, 18), shellMat, p.x, p.y, p.z);
      m.rotation.set(0, -PHI[k], Math.PI / 2);
      g.add(m);
    };
    nz(G.hxR - 0.9, 7.6);
    nz(G.hxR - 0.9, 3.0);
    g.add(cyl(0.38, 0.38, 0.8, shellMat, 18, c.x, y1 + 0.55, c.z));
    g.add(cyl(0.38, 0.38, 0.8, shellMat, 18, c.x, y0 - 0.15, c.z));
    // support skirt
    g.add(cyl(R * 0.9, R * 0.9, 0.5, M.get('dark'), 24, c.x, y0 - 0.25 + 0.1, c.z));
    groups.push(g);
    root.add(g);
    bake(g);
  }
  const cs = new THREE.Color();
  const cm = new THREE.Color();
  let lastKey = '';
  function update(state, dt, M2) {
    const key = Math.round(state.Tavg / 3) + ':' + Math.round(state.coolantOut / 3);
    if (key === lastKey) return;
    lastKey = key;
    M2.tempColor(state.Tavg, 470, 720, cs);
    shellMat.color.copy(cs).lerp(cm.set(0x5d6975), 0.45);
    M2.tempColor(state.coolantOut, 400, 680, tubeMat.color);
  }
  return { object: root, groups, update };
}

// ---------------------------------------------------------------- secondary (coolant-salt) loop
export function buildCoolant(M, seg, detail) {
  const g = new THREE.Group();
  const hotMat = M.make('steel', { color: 0xc98a5a, transparent: true, opacity: 0.3 });
  const coldMat = M.make('steel', { color: 0x7fa2c6, transparent: true, opacity: 0.3 });
  const R = G.ringR;
  const tor = (y, mat) => {
    const t = mesh(new THREE.TorusGeometry(R, 0.26, 12, 96), mat, 0, y, 0);
    t.rotation.x = Math.PI / 2;
    return t;
  };
  g.add(tor(G.ringHotY, hotMat), tor(G.ringColdY, coldMat));
  for (let k = 0; k < 4; k++) {
    const a = L(k, G.hxR, 0, 9.2);
    g.add(pipe([a, L(k, G.hxR + 0.9, 0, 9.4), L(k, R, 0, G.ringHotY)], 0.32, hotMat, { segments: 10, radial: 12 }));
    const b = L(k, G.hxR, 0, 2.0);
    g.add(pipe([L(k, R, 0, G.ringColdY), L(k, G.hxR + 0.9, 0, 2.2), b], 0.32, coldMat, { segments: 10, radial: 12 }));
  }
  // legs to SG
  const sgx = G.sgX;
  const hotLeg = [V(R, G.ringHotY, 0), V(17, 10.6, 0), V(sgx - 1.7 - 0.4, 10.8, 0)];
  const coldLeg = [V(sgx - 1.7 - 0.4, 2.0, 0), V(18, 2.4, 0), V(R, G.ringColdY, 0)];
  g.add(pipe(hotLeg, 0.4, hotMat, { segments: 16, radial: 14 }));
  g.add(pipe(coldLeg, 0.4, coldMat, { segments: 16, radial: 14 }));
  // coolant-salt pump on the cold leg
  g.add(cyl(0.7, 0.7, 1.2, M.get('steel'), 24, 16.2, 2.9, 0));
  g.add(cyl(0.5, 0.5, 2.0, M.make('paint', { color: 0x3f4a55 }), 22, 16.2, 4.4, 0));
  const spin = new THREE.Group();
  spin.position.set(16.2, 0, 0);
  spin.add(mesh(new THREE.BoxGeometry(1.6, 0.14, 0.3), M.make('paint', { color: 0xea580c }), 0, 5.55, 0));
  spin.add(mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.15, 18), M.get('stainless'), 0, 5.45, 0));
  spin.userData.noBake = true;
  g.add(spin);
  // flows: hot arcs from the far HX units towards phi = 0 and on to the SG; cold the other way
  const arc = (a0, a1, y, n = 8) => Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [Math.cos(a) * (R - 0.0), y, Math.sin(a) * R];
  });
  const rad = (d) => (d * Math.PI) / 180;
  const hotPts = (side) => [...arc(rad(side * 150), 0, G.ringHotY, 10), [17, 10.6, 0], [sgx - 2.1, 10.8, 0]];
  const coldPts = (side) => [[sgx - 2.1, 2.0, 0], [18, 2.4, 0], ...arc(0, rad(side * 150), G.ringColdY, 10)];
  const nn = Math.round(36 * Math.max(0.6, detail));
  const fl = createFlow([{ points: hotPts(1), count: nn }, { points: hotPts(-1), count: nn }, { points: coldPts(1), count: nn }, { points: coldPts(-1), count: nn }], { size: 0.75, opacity: 1, res: 160 });
  g.add(fl.object);
  bake(g);
  const cH = new THREE.Color();
  const cC = new THREE.Color();
  const pH = new THREE.Color();
  const pC = new THREE.Color();
  function update(state, dt, M2) {
    M2.tempColor(state.coolantOut, 400, 680, cH);
    M2.tempColor(state.coolantIn, 400, 680, cC);
    hotMat.color.copy(cH).lerp(tmpA.set(0xb0b8c0), 0.3);
    coldMat.color.copy(cC).lerp(tmpA.set(0xb0b8c0), 0.3);
    const sf = Math.min(1.2, 0.35 + 0.65 * (state.steamMW / 2250));
    coolantParticle(state.coolantOut, pH);
    coolantParticle(state.coolantIn, pC);
    fl.update(dt, 5.5 * sf, (pi) => (pi < 2 ? pH : pC));
    spin.rotation.y += 7 * sf * dt;
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- steam generator (coolant salt -> supercritical steam)
export function buildSG(M, seg, detail) {
  const g = new THREE.Group();
  const x = G.sgX;
  const R = 1.7;
  const y0 = 0.7;
  const y1 = 12.2;
  const prof = [];
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.sin(t), y0 + 0.7 - 0.7 * Math.cos(t)]);
  }
  prof.push([R, y1 - 0.7]);
  for (let i = 1; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    prof.push([R * Math.cos(t), y1 - 0.7 + 0.7 * Math.sin(t)]);
  }
  const shell = lathe(prof, M.make('paint', { color: 0x7b8893 }), seg);
  shell.position.set(x, 0, 0);
  g.add(shell);
  // tube bundle in three height zones, coloured feedwater -> steam
  const nT = detail >= 0.9 ? 80 : 48;
  const zoneH = (y1 - y0 - 2.2) / 3;
  const tg = new THREE.CylinderGeometry(0.05, 0.05, zoneH * 0.96, 8);
  const mats = [0, 1, 2].map(() => M.make('copper', { color: 0x8794a0 }));
  const m4 = new THREE.Matrix4();
  mats.forEach((m, z) => {
    const im = new THREE.InstancedMesh(tg, m, nT);
    for (let i = 0; i < nT; i++) {
      const r = 0.12 + 1.2 * Math.sqrt(i / nT);
      const a = i * 2.39996;
      im.setMatrixAt(i, m4.makeTranslation(x + Math.cos(a) * r, y0 + 1.1 + zoneH * (z + 0.5), Math.sin(a) * r));
    }
    g.add(im);
  });
  // nozzles: coolant in (top), coolant out (bottom), steam out (top), feedwater in (bottom)
  const st = M.get('steel');
  const sideNoz = (y, z0 = 0) => {
    const m = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 18), st, x - R - 0.1, y, z0);
    m.rotation.z = Math.PI / 2;
    g.add(m);
  };
  sideNoz(10.8);
  sideNoz(2.0);
  g.add(cyl(0.5, 0.5, 1.3, st, 20, x, y1 + 0.5, 0));
  const fw = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 16), st, x, 1.0, -R - 0.15);
  fw.rotation.x = Math.PI / 2;
  g.add(fw);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    g.add(cyl(0.22, 0.26, y0 + 0.1, M.get('steel'), 10, x + Math.cos(a) * 1.15, (y0 + 0.1) / 2, Math.sin(a) * 1.15));
  }
  // steam line to the turbine and feedwater back
  const steamPath = [V(x, y1 + 1.0, 0), V(x, 13.2, -4), V(x - 2, 9.5, -11), V(x - 3.5, 5.4, G.turbZ)];
  const steamMat = M.make('steel', { color: 0xa9b3bd, transparent: true, opacity: 0.4 });
  g.add(pipe(steamPath, 0.34, steamMat, { segments: 24, radial: 12 }));
  const fwPath = [V(x + 7, 0.9, G.turbZ + 1.5), V(x + 7, 0.9, -7), V(x + 1.0, 1.0, -R - 2.5), V(x, 1.0, -R - 0.5)];
  const fwMat = M.make('steel', { color: 0x6b8fb8, transparent: true, opacity: 0.4 });
  g.add(pipe(fwPath, 0.3, fwMat, { segments: 20, radial: 12 }));
  const fl = createFlow([{ points: steamPath.map((p) => p.toArray()), count: 30 }, { points: fwPath.map((p) => p.toArray()), count: 24 }], { size: 0.7, opacity: 1, res: 100 });
  g.add(fl.object);
  bake(g);
  const cs = STEAM_COL;
  const cw = WATER_COL;
  const zc = new THREE.Color();
  let lastKey = '';
  function update(state, dt, M2) {
    const sf = Math.min(1.2, state.steamMW / 2250);
    fl.update(dt, 7 * sf, (pi) => (pi === 0 ? cs : cw));
    const key = Math.round(state.steamTemp / 4) + ':' + Math.round(sf * 20);
    if (key !== lastKey) {
      lastKey = key;
      const hotK = Math.min(1, Math.max(0, sf * 1.2));
      mats.forEach((m, z) => {
        M2.tempColor(180 + (state.steamTemp - 180) * ((z + 1) / 3) * (0.3 + 0.7 * hotK), 200, 640, m.color);
      });
    }
  }
  return { object: g, update };
}
