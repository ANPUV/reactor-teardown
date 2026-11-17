// msr/aux.js - freeze plug, drain tank, off-gas, chemical processing, turbine-generator, condenser, cooling tower, grid.
import * as THREE from 'three';
import { lathe, pipe, createFlow, createPlume, outline } from '../../kit/util.js';
import { G, V, L, PHI, saltColor, mesh, cyl, saltMaterial, paintSalt, smooth, bake, fuelParticle, coolantParticle, STEAM_COL, WATER_COL } from './common.js';

const tA = new THREE.Color();
const tB = new THREE.Color();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- freeze plug + drain line
export function buildPlug(M) {
  const g = new THREE.Group();
  const lineMat = M.make('steel', { color: 0x4f5b66, transparent: true, opacity: 0.45 });
  const yTop = G.botY - 0.05;
  const yBot = G.tankY + G.tankR + 0.05;
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, yTop - yBot, 24, 1, true), lineMat));
  g.children[0].position.y = (yTop + yBot) / 2;
  outline(g.children[0], { opacity: 0.5 });
  // cooling jacket (air duct) around the plug, with fins
  const jy = 3.15;
  const jacket = M.make('steel', { color: 0x2f6fb6 });
  g.add(cyl(1.0, 1.0, 0.7, jacket, 32, 0, jy, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const f = mesh(new THREE.BoxGeometry(0.6, 0.62, 0.07), jacket, Math.cos(a) * 1.25, jy, Math.sin(a) * 1.25);
    f.rotation.y = -a;
    g.add(f);
  }
  // the plug itself: frozen salt (cold, matte) or thawed salt (glowing), recoloured from plug temperature
  const plugMat = M.make('salt', { color: 0x5f7f9f, opacity: 1, transparent: false, roughness: 0.85, emissive: 0x000000 });
  plugMat.depthWrite = true;
  g.add(cyl(0.5, 0.5, 0.7, plugMat, 24, 0, jy, 0));
  // cooling fan on a duct to the side
  const duct = cyl(0.3, 0.3, 1.6, M.get('dark'), 16, 1.55, jy, 0);
  duct.rotation.z = Math.PI / 2;
  g.add(duct);
  const fan = new THREE.Group();
  fan.position.set(2.45, jy, 0);
  const fanDisc = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 20), M.get('dark'));
  fanDisc.rotation.z = Math.PI / 2;
  fan.add(fanDisc);
  const blade = mesh(new THREE.BoxGeometry(0.12, 0.8, 0.1), M.make('copper', { color: 0xb9743e }));
  fan.add(blade);
  g.add(fan);
  // salt running through the line
  const path = [[0, yTop, 0], [0, G.tankY + 0.2, 0]];
  const fl = createFlow([{ points: path, count: 18 }], { size: 0.6, opacity: 1, res: 40 });
  g.add(fl.object);
  const cc = new THREE.Color();
  let lastKey = '';
  function update(state, dt, run) {
    const hot = state.plugT >= 499;
    const key = Math.round(state.plugT / 3) + (hot ? 'h' : 'c');
    if (key !== lastKey) {
      lastKey = key;
      if (hot) {
        saltColor(state.plugT + 80, plugMat.color);
        plugMat.emissive.copy(plugMat.color);
        plugMat.emissiveIntensity = 0.5;
        plugMat.roughness = 0.4;
      } else {
        const t = smooth(400, 499, state.plugT);
        plugMat.color.set(0x5f7f9f).lerp(cc.set(0x8a6a5a), t * 0.6);
        plugMat.emissive.set(0x000000);
        plugMat.emissiveIntensity = 0;
        plugMat.roughness = 0.85;
      }
    }
    // fan runs while the plug is being held frozen
    if (state.drainMode === 'ready' || state.drainMode === 'freezing') fan.rotation.x += 14 * dt;
    // flow in the drain line
    let v = 0;
    if (state.drainMode === 'draining') v = -5.5 * Math.sqrt(Math.max(0, state.level)) - 0.5;
    else if (state.drainMode === 'filling') v = 3.2;
    fl.object.visible = v !== 0;
    fl.update(dt, v, () => fuelParticle(state.Tavg, tA));
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- drain tank
export function buildTank(M, seg) {
  const g = new THREE.Group();
  const R = G.tankR;
  const Lt = G.tankL;
  const wall = 0.1;
  const cap = 0.55;
  // lathe profile about the y axis, then laid along x
  const n = 10;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    outer.push([(R + wall) * Math.sin(a), -Lt / 2 - cap * Math.cos(a)]);
    inner.push([R * Math.sin(a), -Lt / 2 - (cap - wall) * Math.cos(a)]);
  }
  const top = (pts) => pts.map(([r, y]) => [r, -y]);
  const profile = [...outer, [R + wall, Lt / 2], ...top(outer).reverse().slice(0), ...top(inner), [R, Lt / 2], ...inner.reverse()];
  const shell = lathe(profile, M.make('steel', { color: 0x5d6975 }), seg);
  shell.rotation.z = Math.PI / 2;
  shell.position.set(0, G.tankY, 0);
  g.add(shell);
  // saddles
  for (const x of [-3.2, 3.2]) g.add(mesh(new THREE.BoxGeometry(0.5, G.tankY - 0.2, 2 * R * 0.9), M.get('concrete'), x, (G.tankY - 0.2) / 2 + 0.0, 0));
  // cooling thimbles (hanging tubes)
  const tg = new THREE.CylinderGeometry(0.055, 0.055, 1.7, 8);
  const thim = new THREE.InstancedMesh(tg, M.make('copper', { color: 0x2563eb }), 36);
  const m4 = new THREE.Matrix4();
  let c = 0;
  for (let i = 0; i < 12; i++) for (const z of [-0.55, 0, 0.55]) thim.setMatrixAt(c++, m4.makeTranslation(-4.4 + i * 0.8, G.tankY + R - 0.9, z));
  g.add(thim);
  // header over the thimbles
  g.add(cyl(0.08, 0.08, 9.2, M.get('stainless'), 8, 0, G.tankY + R + 0.25, 0)).children.at(-1).rotation.z = Math.PI / 2;
  // inlet nozzle from the drain line
  g.add(cyl(0.45, 0.45, 0.3, M.get('steel'), 18, 0, G.tankY + R + 0.12, 0));
  // salt in the tank: circular segment, rebuilt when the fill changes
  const saltMat = saltMaterial(M, 0.9);
  const saltMesh = new THREE.Mesh(new THREE.BufferGeometry(), saltMat);
  g.add(saltMesh);
  const ri = R - 0.03;
  let lastFill = -1;
  function rebuild(fill) {
    const h = clamp(fill, 0, 1) * 2 * ri * 0.96;
    saltMesh.visible = h > 0.01;
    if (!saltMesh.visible) return;
    const th = Math.acos(clamp(1 - h / ri, -1, 1));
    const shape = new THREE.Shape();
    const nSeg = 28;
    for (let i = 0; i <= nSeg; i++) {
      const a = -th + (2 * th * i) / nSeg;
      const x = ri * Math.sin(a);
      const y = -ri * Math.cos(a);
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Lt - 0.2, bevelEnabled: false, steps: 1 });
    geo.translate(0, 0, -(Lt - 0.2) / 2);
    geo.rotateY(Math.PI / 2);
    saltMesh.geometry.dispose();
    saltMesh.geometry = geo;
    saltMesh.position.set(0, G.tankY, 0);
  }
  function update(state, dt) {
    const f = Math.round(state.tankFill * 80) / 80;
    if (f !== lastFill) {
      lastFill = f;
      rebuild(f);
    }
    paintSalt(saltMat, state.tankT, 0.55);
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- off-gas system
export function buildOffgas(M, seg, detail) {
  const g = new THREE.Group();
  const mat = M.make('steel', { color: 0x7d8a96 });
  const ringR = 5.2;
  const ringY = 10.6;
  const t = mesh(new THREE.TorusGeometry(ringR, 0.16, 10, 72), mat, 0, ringY, 0);
  t.rotation.x = Math.PI / 2;
  g.add(t);
  const paths = [];
  for (let k = 0; k < 4; k++) {
    const p = [L(k, ringR, 0, ringY), L(k, ringR, 0, 8.2), L(k, 5.9, 0, 6.9), L(k, 6.3, 0, 6.9)];
    g.add(pipe(p, 0.14, mat, { segments: 10, radial: 8, tension: 0.1 }));
    paths.push({ points: [...p].reverse().map((q) => q.toArray()), count: 6 });
  }
  const main = [V(0, ringY, -ringR), V(0, ringY, -12), V(0, 8.0, -17), V(0, 3.2, -19.2), V(0, 1.2, -20)];
  g.add(pipe(main, 0.18, mat, { segments: 24, radial: 8 }));
  const bedMat = M.make('paint', { color: 0x6b7783 });
  for (const z of [-20.8, -23.4]) {
    const bed = cyl(0.95, 0.95, 6.5, bedMat, 28, 0, 1.15, z);
    bed.rotation.z = Math.PI / 2;
    g.add(bed);
  }
  g.add(pipe([V(-3, 1.15, -20.8), V(-3.6, 1.15, -22.1), V(-3, 1.15, -23.4)], 0.16, mat, { segments: 8, radial: 8 }));
  const stack = cyl(0.4, 0.5, 12, M.get('concrete'), 16, -6, 6, -22);
  g.add(stack);
  
  paths.push({ points: [...main, V(-3.5, 1.2, -20.8), V(-6, 3, -22), V(-6, 12.2, -22)].map((q) => q.toArray()), count: 22 });
  const fl = createFlow(paths, { size: 0.5, opacity: 1, res: 140, color: 0x6b7280 });
  g.add(fl.object);
  bedMat.userData.x = 1;
  const grey = new THREE.Color(0x6b7783);
  const mauve = new THREE.Color(0x7c3aed);
  let lastKey = '';
  function update(state, dt) {
    fl.update(dt, 3.0 * state.flowFrac * (0.4 + 0.6 * state.stripOn));
    const key = Math.round(state.stripOn * 4 + state.fissionPct / 10);
    if (key !== lastKey) {
      lastKey = key;
      bedMat.color.copy(grey).lerp(mauve, 0.35 * state.stripOn * clamp(state.fissionPct / 100, 0, 1) + 0.04);
    }
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- chemical processing + Pa-233 decay tank
export const CHEM = { x: -16, z: -12 };
export function buildChem(M, seg) {
  const g = new THREE.Group();
  const cell = new THREE.Group();
  cell.position.set(CHEM.x, 0, CHEM.z);
  g.add(cell);
  const x0 = 0;
  const st = M.make('steel', { color: 0x5d6975 });
  const pa = M.make('paint', { color: 0x6b7783 });
  // Pa-233 decay tank (vertical, domed)
  const R = 1.6;
  const prof = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([R * Math.sin(a), 0.3 + 0.6 - 0.6 * Math.cos(a)]);
  }
  prof.push([R, 6.3]);
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([R * Math.cos(a), 6.3 + 0.6 * Math.sin(a)]);
  }
  const tank = lathe(prof, st, seg);
  tank.position.set(x0, 0, 0);
  cell.add(tank);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.78;
    cell.add(cyl(0.18, 0.2, 0.4, M.get('steel'), 10, x0 + Math.cos(a) * 1.1, 0.2, Math.sin(a) * 1.1));
  }
  const saltMat = saltMaterial(M, 0.85);
  const col = cyl(R - 0.1, R - 0.1, 5.0, saltMat, 28, x0, 3.4, 0);
  cell.add(col);
  // Pa-233 inventory gauge: a frame with a green fill whose height follows the held-up inventory
  const frame = mesh(new THREE.BoxGeometry(0.34, 6.0, 0.14), M.get('dark'), x0, 3.4, R + 0.35);
  cell.add(frame);
  const fillMat = M.make('paint', { color: 0x059669, emissive: 0x059669, emissiveIntensity: 0.25 });
  const fill = mesh(new THREE.BoxGeometry(0.22, 1, 0.18), fillMat, x0, 1.0, R + 0.35);
  cell.add(fill);
  // fluorinator column and vacuum-distillation vessel
  cell.add(cyl(0.7, 0.7, 7.0, st, 24, x0, 3.5, 4.8));
  cell.add(cyl(0.7, 0.7, 0.5, st, 24, x0, 7.2, 4.8));
  cell.add(cyl(1.05, 1.05, 3.4, M.make('steel', { color: 0x6b7783 }), 24, x0, 1.7, -4.8));
  cell.add(mesh(new THREE.SphereGeometry(1.05, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.make('steel', { color: 0x6b7783 }), x0, 3.4, -4.8));
  // connecting lines inside the cell
  const pm = M.make('steel', { color: 0x7d8a96 });
  cell.add(pipe([V(x0, 6.9, R - 0.3), V(x0, 7.4, 3), V(x0, 7.2, 4.4)], 0.14, pm, { segments: 10, radial: 8 }));
  cell.add(pipe([V(x0, 1.6, 4.6), V(x0, 1.0, 2.5), V(x0, 1.0, R - 0.4)], 0.14, pm, { segments: 10, radial: 8 }));
  cell.add(pipe([V(x0, 1.4, -R + 0.4), V(x0, 1.2, -3.2), V(x0, 1.7, -4.2)], 0.14, pm, { segments: 10, radial: 8 }));
  fill.userData.keep = true;
  frame.userData.keep = true;
  bake(cell);
  let lastKey = '';
  function update(state, dt) {
    const f = clamp(state.paTankKg / 130, 0, 1);
    const key = Math.round(f * 60) + ':' + Math.round(state.Tavg / 4);
    if (key !== lastKey) {
      lastKey = key;
      fill.scale.y = Math.max(0.02, f * 5.8);
      fill.position.y = 0.5 + (f * 5.8) / 2;
      paintSalt(saltMat, state.Tavg - 20, 0.4);
    }
  }
  return { object: g, update };
}

export function buildSideStream(M) {
  const g_ = new THREE.Group();
  const R = 1.6;
  const tx = CHEM.x + R;
  const outP = [V(0, 7.6, -3.7), V(-0.2, 7.0, -8), V(-6, 5.9, -11), V(tx + 2.5, 5.0, CHEM.z + 0.3), V(tx, 4.8, CHEM.z)];
  const retP = [V(tx, 1.2, CHEM.z + 0.6), V(-9, 1.3, -10.6), V(-2.2, 2.9, -8.6), V(-0.6, 4.3, -5.6), V(0, 5.4, -3.7)];
  const hotMat = M.make('steel', { color: 0xc0653f, transparent: true, opacity: 0.4 });
  const coldMat = M.make('steel', { color: 0x6b8fb8, transparent: true, opacity: 0.4 });
  g_.add(pipe(outP, 0.2, hotMat, { segments: 24, radial: 10 }));
  g_.add(pipe(retP, 0.2, coldMat, { segments: 24, radial: 10 }));
  const fl = createFlow([{ points: outP.map((p) => p.toArray()), count: 10 }, { points: retP.map((p) => p.toArray()), count: 10 }], { size: 0.5, opacity: 1, res: 80 });
  g_.add(fl.object);
  const hc = new THREE.Color();
  const cc = new THREE.Color();
  function update(state, dt) {
    fl.update(dt, 0.45 * state.flowFrac, (pi) => (pi === 0 ? fuelParticle(state.Tout, hc) : fuelParticle(state.Tavg - 30, cc)));
  }
  return { object: g_, update };
}

// ---------------------------------------------------------------- turbine-generator
export function buildTurbine(M, seg, detail) {
  const g = new THREE.Group();
  const z = G.turbZ;
  const y = 3.9;
  const casing = M.make('paint', { color: 0x7d8a96 });
  const genMat = M.make('paint', { color: 0x4f6f8f });
  // casings are modelled with a window on the camera side so the blades show without using the global cut
  const cx = (r, len, x, mat, s = seg, open = false) => {
    const geo = open ? new THREE.CylinderGeometry(r, r, len, s, 1, false, Math.PI / 2, Math.PI * 1.5) : new THREE.CylinderGeometry(r, r, len, s);
    const m = mesh(geo, mat, x, y, z);
    m.rotation.z = Math.PI / 2;
    return m;
  };
  g.add(cx(1.45, 6, 13, genMat)); // generator
  g.add(cx(1.1, 3.6, 18.8, casing, seg, true)); // HP
  g.add(cx(1.9, 7.4, 25.5, casing, seg, true)); // LP
  g.add(cx(0.4, 0.8, 16.5, M.get('dark'))); // bearing housing
  // shaft and blades inside a rotating group
  const rotor = new THREE.Group();
  rotor.position.set(0, y, z);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 21, 14), M.get('stainless'));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 20;
  rotor.add(shaft);
  const bladeGeo = new THREE.BoxGeometry(0.1, 1, 0.22);
  const stages = [];
  for (let i = 0; i < 6; i++) stages.push([17.3 + i * 0.5, 0.45 + i * 0.07]);
  for (let i = 0; i < 7; i++) stages.push([22.2 + i * 0.85, 0.9 + i * 0.13]);
  const nB = Math.round(26 * Math.max(0.6, detail));
  const blades = new THREE.InstancedMesh(bladeGeo, M.make('stainless', { color: 0x6f7b86 }), stages.length * nB);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let c = 0;
  stages.forEach(([x, r]) => {
    for (let i = 0; i < nB; i++) {
      const a = (i / nB) * Math.PI * 2;
      q.setFromAxisAngle(V(1, 0, 0), a);
      m4.compose(V(x, Math.cos(a) * (r * 0.62), Math.sin(a) * (r * 0.62)), q, V(1, r * 0.75, 1));
      blades.setMatrixAt(c++, m4);
    }
    // disc
  });
  rotor.add(blades);
  const hubMat = M.get('stainless');
  stages.forEach(([x, r]) => {
    const d = mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.1, 16), hubMat, x, 0, 0);
    d.rotation.z = Math.PI / 2;
    rotor.add(d);
  });
  // asymmetric coupling flange so rotation reads
  // exposed coupling disc with bright wedges: the rotation reads from the default camera
  const tach = new THREE.Group();
  tach.position.set(16.5, 0, 0);
  const td = mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.18, 28), M.get('dark'));
  td.rotation.z = Math.PI / 2;
  tach.add(td);
  for (let i = 0; i < 2; i++) {
    const w = mesh(new THREE.BoxGeometry(0.22, 2.0, 0.34), M.make('paint', { color: 0xea580c }));
    w.rotation.x = (i * Math.PI) / 2;
    tach.add(w);
  }
  rotor.add(tach);
  const flange = mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), M.make('copper', { color: 0xb9743e }), 16.55, 0.55, 0);
  rotor.add(flange);
  const gr = mesh(new THREE.BoxGeometry(0.4, 0.2, 2.2), M.make('copper', { color: 0xb9743e }), 10.6, 0, 0);
  rotor.add(gr);
  rotor.userData.noBake = true;
  g.add(rotor);
  // steam inlet, crossover, supports
  g.add(cyl(0.34, 0.34, 0.8, M.get('steel'), 14, 17.5, y + 1.1 + 0.2, z));
  g.add(pipe([V(20.4, y + 1.0, z), V(21.6, y + 3.4, z), V(24.2, y + 3.4, z), V(25.0, y + 1.8, z)], 0.28, casing, { segments: 20, radial: 10 }));
  for (const x of [11, 15.4, 18.8, 22.5, 28.5]) g.add(mesh(new THREE.BoxGeometry(0.7, y - 1.0, 2.6), M.get('concrete'), x, (y - 1.0) / 2 + 0.0, z));
  bake(g);
  let omega = -1;
  function update(state, dt) {
    const target = 15 * state.turbineSpeed; // rad/s
    if (omega < 0) omega = target;
    omega += (target - omega) * (1 - Math.exp(-dt / 6));
    if (target === 0 && omega < 0.02) omega = 0;
    rotor.rotation.x += omega * dt;
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- condenser + circulating-water loop
export function buildCondenser(M, seg) {
  const g = new THREE.Group();
  const z = G.turbZ;
  const shell = mesh(new THREE.BoxGeometry(8, 1.9, 3.4), M.make('paint', { color: 0x6b7783 }), 25.5, 1.05, z);
  g.add(shell);
  outline(shell, { opacity: 0.4 });
  // water boxes at both ends and the tube bundle
  for (const x of [21.2, 29.8]) {
    const wb = mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.8, 24), M.get('steel'), x, 1.05, z);
    wb.rotation.z = Math.PI / 2;
    g.add(wb);
  }
  const tg = new THREE.CylinderGeometry(0.05, 0.05, 7.6, 8);
  tg.rotateZ(Math.PI / 2);
  const tubes = new THREE.InstancedMesh(tg, M.make('copper', { color: 0x2563eb }), 40);
  const m4 = new THREE.Matrix4();
  let c = 0;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) tubes.setMatrixAt(c++, m4.makeTranslation(25.5, 0.4 + i * 0.18, z - 1.2 + j * 0.6));
  g.add(tubes);
  // hotwell stub for the feedwater
  g.add(cyl(0.4, 0.4, 0.8, M.get('steel'), 14, 29, 0.3, z + 1.5));
  // circulating water: cold from the tower basin to the east box, warm back from the west box
  const tx = 36;
  const coldP = [V(tx - 5.0, 0.9, z + 1.4), V(31.8, 0.9, z + 0.6), V(30.6, 1.05, z)];
  const hotP = [V(20.5, 1.05, z), V(20.2, 0.7, z - 3.4), V(26, 0.7, z - 4.6), V(tx - 4.9, 0.7, z - 2.6)];
  const cwCold = M.make('steel', { color: 0x6b8fb8, transparent: true, opacity: 0.4 });
  const cwHot = M.make('steel', { color: 0xa0a8b0, transparent: true, opacity: 0.4 });
  g.add(pipe(coldP, 0.36, cwCold, { segments: 16, radial: 12 }));
  g.add(pipe(hotP, 0.36, cwHot, { segments: 24, radial: 12 }));
  g.add(cyl(0.6, 0.6, 1.2, M.get('steel'), 18, 32.5, 1.2, z + 0.8));
  const fl = createFlow([{ points: coldP.map((p) => p.toArray()), count: 12 }, { points: hotP.map((p) => p.toArray()), count: 18 }], { size: 0.65, opacity: 1, res: 80 });
  g.add(fl.object);
  bake(g);
  const cold = new THREE.Color(0x2563eb);
  const warm = new THREE.Color(0x0e7490);
  function update(state, dt) {
    const rej = clamp(state.rejectedMW / 1250, 0, 1.3);
    fl.update(dt, 2.2 * (0.25 + 0.75 * Math.min(1, rej * 1.2)), (pi) => (pi === 0 ? cold : warm));
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- cooling tower + plume
export const TOWER = { x: 36, z: G.turbZ, H: 17, base: 5.2, throat: 3.1, top: 3.5 };
export function buildTower(M, seg) {
  const g = new THREE.Group();
  const { x, z, H, base, throat, top } = TOWER;
  const prof = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const r = throat + (base - throat) * Math.pow(1 - t / 0.72, 2) * (t < 0.72 ? 1 : 0) + (top - throat) * Math.pow((t - 0.72) / 0.28, 2) * (t >= 0.72 ? 1 : 0);
    prof.push([r, t * H]);
  }
  const shell = lathe(prof, M.make('concrete', { color: 0x9aa3ab }), seg);
  shell.position.set(x, 0, z);
  g.add(shell);
  // basin and fill
  g.add(cyl(base + 0.7, base + 0.7, 0.5, M.make('concrete', { color: 0x8a939a }), seg, x, 0.25, z));
  g.add(cyl(base + 0.5, base + 0.5, 0.12, M.make('water', { color: 0x2563eb, opacity: 0.55 }), seg, x, 0.52, z));
  const fillMat = M.make('dark', { color: 0x3b444c });
  g.add(cyl(base - 0.9, base - 0.9, 1.1, fillMat, seg, x, 2.2, z));
  // distribution header
  g.add(cyl(0.3, 0.3, 4.2, M.get('steel'), 12, x, 2.6, z));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const arm = cyl(0.12, 0.12, base - 1.2, M.get('steel'), 8, x + Math.cos(a) * (base - 1.2) / 2, 4.7, z + Math.sin(a) * (base - 1.2) / 2);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = -a;
    g.add(arm);
  }
  g.add(cyl(0.3, 0.3, 4.2, M.get('steel'), 12, x, 2.6, z));
  const plume = createPlume({ radius: 0.9, height: 9, count: 420, size: 2.4 });
  plume.object.position.set(x, H + 0.5, z);
  g.add(plume.object);
  bake(g);
  function update(state, dt) {
    const rej = clamp(state.rejectedMW / 1250, 0, 1.2);
    plume.update(dt, rej);
  }
  return { object: g, update };
}

// ---------------------------------------------------------------- generator output and grid
export function buildGrid(M, seg) {
  const g = new THREE.Group();
  const z = G.turbZ;
  const tf = M.make('paint', { color: 0x5f6c78 });
  g.add(mesh(new THREE.BoxGeometry(3.2, 3.0, 2.2), tf, 13, 1.5, z - 5.5));
  for (let i = -1; i <= 1; i++) g.add(cyl(0.12, 0.12, 0.8, M.get('stainless'), 8, 13 + i * 0.9, 3.4, z - 5.5));
  const cu = M.make('copper', { color: 0xb9743e });
  g.add(pipe([V(13, 5.4, z), V(13, 5.2, z - 2.8), V(13, 3.6, z - 5.0)], 0.16, cu, { segments: 12, radial: 8 }));
  // two lattice pylons carrying three conductors
  const steelP = M.make('steel', { color: 0x5d6975 });
  const pylon = (px, pz) => {
    const p = new THREE.Group();
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 12.5, 6), steelP);
      leg.position.set(sx * 0.55, 6.25, sz * 0.55);
      leg.rotation.set(-sz * 0.03, 0, sx * 0.03);
      p.add(leg);
    }
    for (let i = 0; i < 4; i++) {
      const y = 1.5 + i * 3.1;
      const b = mesh(new THREE.BoxGeometry(1.0, 0.08, 0.08), steelP, 0, y, 0.45);
      p.add(b);
    }
    for (const y of [9.5, 11.3]) p.add(mesh(new THREE.BoxGeometry(0.2, 0.18, 4.4), steelP, 0, y, 0));
    p.position.set(px, 0, pz);
    return p;
  };
  const pA = [22, z - 9];
  const pB = [32, z - 14];
  g.add(pylon(...pA), pylon(...pB));
  const lines = [];
  const arms = [-1.9, 0, 1.9];
  const yArm = [9.5, 11.3, 9.5];
  const wire = M.make('stainless', { color: 0x2c3138 });
  const flowPaths = [];
  arms.forEach((a, i) => {
    const s = V(13 + (i - 1) * 0.9, 3.8, z - 5.5);
    const p0 = V(pA[0] + 0.0, yArm[i], pA[1] + a);
    const p1 = V(pB[0], yArm[i], pB[1] + a);
    const l1 = [s, V((s.x + p0.x) / 2, (s.y + p0.y) / 2 - 0.2, (s.z + p0.z) / 2), p0];
    const l2 = [p0, V((p0.x + p1.x) / 2, (p0.y + p1.y) / 2 - 0.9, (p0.z + p1.z) / 2), p1];
    g.add(pipe(l1, 0.04, wire, { segments: 12, radial: 5 }));
    g.add(pipe(l2, 0.04, wire, { segments: 12, radial: 5 }));
    flowPaths.push({ points: [...l1, ...l2.slice(1)].map((q) => q.toArray()), count: 6 });
  });
  const fl = createFlow(flowPaths, { size: 0.34, opacity: 1, res: 100, color: M.COLORS.plasma });
  g.add(fl.object);
  bake(g);
  function update(state, dt) {
    const f = state.gridMW / 1000;
    fl.object.visible = f > 0.01;
    fl.update(dt, 14 * f);
  }
  return { object: g, update };
}
