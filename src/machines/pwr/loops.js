// pwr/loops.js - primary loops (legs, steam generators, pumps, pressurizer) and the secondary side
// (steam lines, turbine-generator, condenser).
import * as THREE from 'three';
import { lathe, pipe, createFlow, outline, cylBetween, mergeStatic } from '../../kit/util.js';
import { G } from './plant.js';

export const PHI = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180);
export const SG_R = 11.5;
export const SG_T = -3.0;
export const RCP_T = 3.4;
export const SG = { base: 2.0, headY: 3.7, headR: 1.7, lowerTop: 13.5, coneTop: 15.8, upperR: 2.25, upperTop: 21.0, top: 23.0 };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const place = (m, o) => {
  if (o.position) m.position.copy(o.position);
  return m;
};
/** loop-local (r radial, t tangential, y) -> world */
export const L = (k, r, t, y) => V(r * Math.cos(PHI[k]) - t * Math.sin(PHI[k]), y, r * Math.sin(PHI[k]) + t * Math.cos(PHI[k]));
export const radial = (k) => [Math.cos(PHI[k]), 0, Math.sin(PHI[k])];

const noz = (r, side) => (side * 0.9 * r) / G.rpvRo; // tangential offset on the nozzle axis at radius r

export function hotPath(k) {
  return [L(k, 3.4, noz(3.4, -1), G.hotY), L(k, 6.0, -1.7, G.hotY), L(k, 8.6, -2.6, 8.3), L(k, 9.7, -3.0, 5.2), L(k, SG_R - SG.headR, SG_T, SG.headY)];
}
export function crossPath(k) {
  return [L(k, SG_R, SG_T + SG.headR, SG.headY), L(k, SG_R, SG_T + 3.2, 3.5), L(k, SG_R, RCP_T - 1.3, 3.3)];
}
export function coldPath(k) {
  return [L(k, SG_R - 1.05, RCP_T, 3.9), L(k, 8.6, 2.8, 4.8), L(k, 6.0, 1.6, 7.0), L(k, 4.2, 1.2, 9.0), L(k, 3.4, noz(3.4, 1), G.coldY)];
}

export function buildLegs(M, seg, detail) {
  const root = new THREE.Group();
  const hotMat = M.make('steel', { color: 0xc0653f, transparent: true, opacity: 0.55 });
  const coldMat = M.make('steel', { color: 0x4f86c0, transparent: true, opacity: 0.55 });
  const crossMat = M.make('steel', { color: 0x4f86c0, transparent: true, opacity: 0.55 });
  const groups = [];
  const flows = [];
  const hotC = new THREE.Color();
  const coldC = new THREE.Color();
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    const hot = pipe(hotPath(k), 0.46, hotMat, { segments: 36, radial: 12 });
    const cross = pipe(crossPath(k), 0.5, crossMat, { segments: 20, radial: 16 });
    const cold = pipe(coldPath(k), 0.44, coldMat, { segments: 36, radial: 12 });
    g.add(hot, cross, cold);
    // flanges where legs meet the RCP and the vessel nozzles
    for (const [p, m] of [[coldPath(k)[0], coldMat], [crossPath(k)[2], crossMat]]) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), m);
      f.position.copy(p);
      g.add(f);
    }
    mergeStatic(g);
    const fl = createFlow([{ points: hotPath(k).map((p) => p.toArray()), count: 26 }, { points: [...crossPath(k), ...coldPath(k)].map((p) => p.toArray()), count: 40 }], { size: 0.42, opacity: 0.95 });
    g.add(fl.object);
    flows.push(fl);
    groups.push(g);
    root.add(g);
  }
  function update(state, dt, M2) {
    M2.tempColor(state.Tout, 270, 340, hotC);
    M2.tempColor(state.Tin, 270, 340, coldC);
    hotMat.color.copy(hotC);
    coldMat.color.copy(coldC);
    crossMat.color.copy(coldC).lerp(hotC, 0.1);
    flows.forEach((f) => f.update(dt, 5.5 * state.flowFrac, (pi) => (pi === 0 ? hotC : coldC)));
  }
  return { object: root, groups, update };
}

function steamGen(M, k, seg) {
  const g = new THREE.Group();
  const { headR: hr, headY, lowerTop, coneTop, upperR: ur, upperTop, top, base } = SG;
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = (i / 12) * (Math.PI / 2);
    prof.push([hr * Math.sin(t), headY - hr * Math.cos(t)]);
  }
  prof.push([hr, lowerTop], [ur, coneTop], [ur, upperTop]);
  for (let i = 1; i <= 12; i++) {
    const t = (i / 12) * (Math.PI / 2);
    prof.push([ur * Math.cos(t), upperTop + (top - upperTop) * Math.sin(t)]);
  }
  const shell = lathe(prof, M.make('paint', { color: 0x7b8893 }), seg);
  g.add(shell);
  // steam outlet nozzle and feedwater stub
  g.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 20), M.get('steel')), { position: V(0, top + 0.5, 0) }));
  const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.2, 16), M.get('steel'));
  fw.rotation.z = Math.PI / 2;
  fw.position.set(ur + 0.4, 18.6, 0);
  g.add(fw);
  // tubesheet, divider plate
  const ts = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 0.35, 40), M.get('stainless'));
  ts.position.y = 5.0;
  g.add(ts);
  const div = new THREE.Mesh(new THREE.BoxGeometry(2 * hr, 3.0, 0.1), M.get('stainless'));
  div.position.y = 3.5;
  div.rotation.y = Math.PI / 4;
  g.add(div);
  // nozzle stubs into the channel head
  const hot = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.7, 20), M.make('steel', { color: 0x66727d }));
  hot.rotation.z = Math.PI / 2;
  g.add(place(hot, { position: V(-hr + 0.05, headY, 0) }));
  const cold = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.7, 20), M.make('steel', { color: 0x66727d }));
  cold.rotation.x = Math.PI / 2;
  g.add(place(cold, { position: V(0, headY, hr - 0.05) }));
  // support legs to the floor
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    g.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, base + 0.1, 12), M.get('steel')), { position: V(Math.cos(a) * 1.25, base / 2, Math.sin(a) * 1.25) }));
  }
  return mergeStatic(g);
}

function tubeBundle(N) {
  // hot leg in the negative half of the plate normal n = (1,0,1)/sqrt2 (SG-local), cold leg mirrored.
  const n = new THREE.Vector2(Math.SQRT1_2, Math.SQRT1_2);
  const hotXZ = [];
  const golden = 2.399963;
  for (let i = 0, c = 0; c < N; i++) {
    const r = 1.5 * Math.sqrt((i + 0.5) / (N * 2.6));
    const th = i * golden;
    const p = new THREE.Vector2(Math.cos(th) * r, Math.sin(th) * r);
    const d = p.dot(n);
    if (d < -0.08) {
      hotXZ.push([p, d]);
      c++;
    }
    if (i > N * 20) break;
  }
  const pos = [];
  const par = [];
  const yTop0 = 13.0;
  const ySteps = 6;
  for (const [p, d] of hotXZ) {
    const q = p.clone().addScaledVector(n, -2 * d);
    const sep = p.distanceTo(q);
    const pts = [];
    for (let s = 0; s <= ySteps; s++) pts.push([p.x, 5.2 + ((yTop0 - 5.2) * s) / ySteps, p.y]);
    const c = p.clone().add(q).multiplyScalar(0.5);
    for (let s = 1; s < 12; s++) {
      const a = (s / 12) * Math.PI;
      const dir = p.clone().sub(c).multiplyScalar(Math.cos(a));
      pts.push([c.x + dir.x, yTop0 + (sep / 2) * Math.sin(a), c.y + dir.y]);
    }
    for (let s = ySteps; s >= 0; s--) pts.push([q.x, 5.2 + ((yTop0 - 5.2) * s) / ySteps, q.y]);
    for (let s = 0; s < pts.length - 1; s++) {
      pos.push(...pts[s], ...pts[s + 1]);
      par.push(s / (pts.length - 1), (s + 1) / (pts.length - 1));
    }
  }
  return { pos: new Float32Array(pos), par: new Float32Array(par), n: hotXZ.length };
}

export function buildSteamGens(M, seg, detail) {
  const root = new THREE.Group();
  const sgs = [];
  const tb = tubeBundle(Math.round(180 + 140 * detail));
  const cols = new Float32Array(tb.pos.length);
  const col = new THREE.Color();
  const flows = [];
  const steamFlows = [];
  const tubeGeo = new THREE.BufferGeometry();
  tubeGeo.setAttribute('position', new THREE.BufferAttribute(tb.pos, 3));
  tubeGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const tubeMat = new THREE.LineBasicMaterial({ vertexColors: true });
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    g.add(steamGen(M, k, seg));
    const lines = new THREE.LineSegments(tubeGeo, tubeMat);
    lines.userData.fx = false;
    g.add(lines);
    g.position.copy(L(k, SG_R, SG_T, 0));
    // rotate so the divider plate faces the hot / cold nozzles: hot nozzle at -r-hat, cold at +t-hat
    g.rotation.y = -PHI[k];
    // particles along a representative tube
    const pa = [[-0.8, 5.2, -0.6], [-0.8, 13, -0.6], [0, 14.4, 0], [0.8, 13, 0.6], [0.8, 5.2, 0.6]];
    const fl = createFlow([{ points: pa, count: 14 }], { size: 0.36, opacity: 0.95 });
    g.add(fl.object);
    flows.push(fl);
    const sf = createFlow(Array.from({ length: 6 }, (_, q) => ({ points: [[Math.cos(q * 1.05) * 1.1, 14, Math.sin(q * 1.05) * 1.1], [Math.cos(q * 1.05) * 1.3, 17.5, Math.sin(q * 1.05) * 1.3], [Math.cos(q * 1.05) * 0.6, 21.5, Math.sin(q * 1.05) * 0.6]], count: 7 })), { size: 0.5, color: 0xcfd6dc, opacity: 0.8 });
    g.add(sf.object);
    steamFlows.push(sf);
    root.add(g);
    sgs.push(g);
  }
  let lastKey = '';
  const hc = new THREE.Color();
  const cc = new THREE.Color();
  const tmpC = new THREE.Color();
  const steamC = new THREE.Color(0x9aa7b1);
  function update(state, dt, M2) {
    const key = Math.round(state.Tin * 2) + ':' + Math.round(state.Tout * 2);
    if (key !== lastKey) {
      lastKey = key;
      for (let i = 0; i < tb.par.length; i++) {
        M2.tempColor(state.Tout - (state.Tout - state.Tin) * tb.par[i], 270, 340, col);
        cols[i * 3] = col.r;
        cols[i * 3 + 1] = col.g;
        cols[i * 3 + 2] = col.b;
      }
      tubeGeo.attributes.color.needsUpdate = true;
    }
    M2.tempColor(state.Tout, 270, 340, hc);
    M2.tempColor(state.Tin, 270, 340, cc);
    flows.forEach((f) => f.update(dt, 3.5 * state.flowFrac, (pi, u) => tmpC.copy(hc).lerp(cc, u)));
    steamFlows.forEach((f) => (f.object.visible = state.steamMW > 20, f.update(dt, 2 + 4 * Math.min(1.1, state.steamMW / 3411), () => steamC)));
  }
  return { object: root, groups: sgs, update, tubes: tb.n };
}

export function buildRCPs(M, seg) {
  const root = new THREE.Group();
  const groups = [];
  const rotors = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.Group();
    g.position.copy(L(k, SG_R, RCP_T, 0));
    const cas = new THREE.Mesh(new THREE.SphereGeometry(1.05, 28, 20), M.make('steel', { color: 0x66727d }));
    cas.position.y = 3.3;
    g.add(cas);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 1.4, 24, 1, true), M.get('steel'));
    stand.position.y = 4.65;
    g.add(stand);
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 4.0, 32), M.make('paint', { color: 0x6c7a86 }));
    motor.position.y = 7.35;
    g.add(motor);
    const rotor = new THREE.Group();
    rotor.position.y = 9.5;
    const fly = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.35, 32), M.get('stainless'));
    rotor.add(fly);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.14), M.get('dark'));
      sp.position.set(Math.cos(a) * 0.5, 0.24, Math.sin(a) * 0.5);
      sp.rotation.y = -a;
      rotor.add(sp);
    }
    mergeStatic(rotor);
    g.add(rotor);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.9, 20), M.get('steel'));
    cap.position.y = 10.1;
    g.add(cap);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      g.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 2.3, 10), M.get('steel')), { position: V(Math.cos(a) * 0.85, 1.15, Math.sin(a) * 0.85) }));
    }
    rotor.userData.keepSeparate = true;
    mergeStatic(g);
    root.add(g);
    groups.push(g);
    rotors.push(rotor);
  }
  let ang = 0;
  function update(state, dt) {
    ang += dt * 14 * state.flowFrac;
    for (const r of rotors) r.rotation.y = ang;
  }
  return { object: root, groups, update };
}

export function buildPressurizer(M, seg, hotCurve0) {
  const root = new THREE.Group();
  const base = V(10.8, 0, 0);
  const g = new THREE.Group();
  g.position.copy(base);
  root.add(g);
  const r = 1.15;
  const y0 = 6.0;
  const cylLen = 10.5;
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * (Math.PI / 2);
    prof.push([r * Math.sin(t), y0 + r - r * Math.cos(t)]);
  }
  prof.push([r, y0 + r + cylLen]);
  for (let i = 1; i <= 10; i++) {
    const t = (i / 10) * (Math.PI / 2);
    prof.push([r * Math.cos(t), y0 + r + cylLen + r * Math.sin(t)]);
  }
  const vessel = lathe(prof, M.make('paint', { color: 0x7b8893 }), 40);
  g.add(vessel);
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, y0 + 0.2, 32, 1, true), M.make('steel', { color: 0x66727d }));
  skirt.position.y = (y0 + 0.2) / 2 - 0.1;
  g.add(skirt);
  // water and steam volumes
  const wat = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.06, r - 0.06, 1, 28), M.get('water'));
  wat.userData.fx = true;
  g.add(wat);
  const stm = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.06, r - 0.06, 1, 28), M.make('glass', { color: 0xdbe6ee, opacity: 0.35 }));
  stm.userData.fx = true;
  g.add(stm);
  // immersion heaters (glow with heater duty)
  const heaterMat = M.glow(0xe4572e, 0.0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const hmesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.0, 8), heaterMat);
    hmesh.position.set(Math.cos(a) * 0.6, y0 + 0.9, Math.sin(a) * 0.6);
    hmesh.userData.fx = true;
    g.add(hmesh);
  }
  // spray head + relief stub
  g.add(place(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 14), M.get('steel')), { position: V(0, y0 + 2 * r + cylLen + 0.35, 0) }));
  // surge line to hot leg 0
  const target = hotCurve0.getPointAt(0.3);
  const p0 = V(0, y0 - 0.15, 0).add(base);
  const pts = [p0, V(base.x - 0.9, 4.9, base.z + 0.2), V(base.x - 3.4, 6.2, 1.3), V(0.5 * (base.x + target.x) - 0.6, 8.1, 0.5 * (base.z + target.z) + 0.5), target];
  const surge = pipe(pts, 0.26, M.make('steel', { color: 0x9a6a54 }), { segments: 40, radial: 12 });
  surge.position.sub(base);
  g.add(surge);
  mergeStatic(g);
  const waterTop = (lvl) => y0 + r * 0.2 + ((lvl / 100) * (2 * r + cylLen - 0.4));
  function update(state) {
    const lvl = state.pzrLevel;
    const yw = waterTop(lvl);
    const yb = y0 + 0.12;
    wat.scale.y = Math.max(0.05, yw - yb);
    wat.position.y = yb + wat.scale.y / 2;
    const yt = y0 + 2 * r + cylLen - 0.12;
    stm.scale.y = Math.max(0.05, yt - yw);
    stm.position.y = yw + stm.scale.y / 2;
    heaterMat.opacity = Math.max(0, Math.min(0.9, (15.5 - state.pressure) * 1.2 + 0.1));
  }
  return { object: root, update, group: g, base };
}

// ------------------------------------------------------------------ secondary side
const TX0 = 31;
const TY = 6.5;
export function buildSteamLines(M, seg) {
  const root = new THREE.Group();
  const steamMat = M.make('steel', { color: 0x8a97a3, transparent: true, opacity: 0.55 });
  const fwMat = M.make('steel', { color: 0x4f86c0, transparent: true, opacity: 0.55 });
  const lines = [];
  const top = (k) => L(k, SG_R, SG_T, 24.2);
  const mids = [
    [V(13, 27, 3)],
    [V(4, 27.2, 9), V(14, 27, 3)],
    [V(0, 27.2, -9), V(12, 27, -5)],
    [V(11, 27, -5)],
  ];
  const H = V(16.5, 27, 0);
  for (let k = 0; k < 4; k++) {
    const t = top(k);
    root.add(pipe([t, V(t.x, 27, t.z), ...mids[k], H], 0.38, steamMat, { segments: 40, radial: 12, tension: 0.15 }));
  }
  const main = [H, V(22.5, 27, 0), V(31.5, 27, 0), V(33.2, 26, 0), V(33.5, 14, 0), V(33.5, 7.9, 0)];
  const mainPipe = pipe(main, 0.7, steamMat, { segments: 60, radial: 18, tension: 0.1 });
  root.add(mainPipe);
  // feedwater from condenser hotwell to the containment penetration and on to the steam generators
  const fwPts = [V(40, 0.7, -5.0), V(34, 1.4, -5.5), V(28, 3, -5.5), V(23.4, 3, -5.5), V(19.5, 3, -5.5)];
  const fwPipe = pipe(fwPts, 0.45, fwMat, { segments: 40, radial: 14, tension: 0.1 });
  root.add(fwPipe);
  const steamFlow = createFlow([{ points: main.map((p) => p.toArray()), count: 40 }], { size: 0.5, color: 0xdfe6ea, opacity: 0.85 });
  const fwFlow = createFlow([{ points: [...fwPts].reverse().map((p) => p.toArray()), count: 18 }], { size: 0.45, color: 0x2b7fd9, opacity: 0.9 });
  root.add(steamFlow.object, fwFlow.object);
  const sc = new THREE.Color(0xdfe6ea);
  const wc = new THREE.Color(0x2b7fd9);
  function update(state, dt) {
    const f = Math.min(1.2, state.steamMW / 3411);
    steamFlow.object.visible = f > 0.02;
    steamFlow.update(dt, 14 * f, () => sc);
    fwFlow.update(dt, 5 * f, () => wc);
  }
  return { object: root, update };
}

export function buildTurbine(M, seg, detail) {
  const root = new THREE.Group();
  const cas = M.make('paint', { color: 0x7d8a96, transparent: true, opacity: 0.38 });
  const rotor = new THREE.Group();
  rotor.position.set(0, TY, 0);
  root.add(rotor);
  const casing = (x0, x1, r, mat = cas, open = true) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, x1 - x0, 40, 1, open), mat);
    m.rotation.z = Math.PI / 2;
    m.position.set((x0 + x1) / 2, TY, 0);
    return m;
  };
  const sections = [
    { n: 'HP', x0: 31.2, x1: 36.6, r0: 0.95, r1: 1.25, st: 6, rc: 1.45 },
    { n: 'LP1', x0: 37.6, x1: 43.6, r0: 1.35, r1: 2.0, st: 6, rc: 2.35 },
    { n: 'LP2', x0: 44.6, x1: 50.6, r0: 1.35, r1: 2.0, st: 6, rc: 2.35 },
  ];
  const bladeGeo = new THREE.BoxGeometry(0.28, 1, 0.07);
  bladeGeo.translate(0, 0.5, 0);
  let nb = 0;
  const per = Math.round(24 + 14 * detail);
  sections.forEach((s) => (nb += s.st * per));
  const blades = new THREE.InstancedMesh(bladeGeo, M.get('stainless'), nb);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ib = 0;
  const hub = 0.4;
  for (const s of sections) {
    root.add(casing(s.x0 - 0.2, s.x1 + 0.2, s.rc));
    const caps = [s.x0 - 0.2, s.x1 + 0.2].map((x) => {
      const c = new THREE.Mesh(new THREE.CircleGeometry(s.rc, 36), cas);
      c.rotation.y = Math.PI / 2;
      c.position.set(x, TY, 0);
      return c;
    });
    root.add(...caps);
    for (let i = 0; i < s.st; i++) {
      const x = s.x0 + ((s.x1 - s.x0) * (i + 0.5)) / s.st;
      const R = s.r0 + ((s.r1 - s.r0) * i) / (s.st - 1);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(hub + 0.1, hub + 0.1, 0.2, 20), M.get('steel'));
      disc.rotation.z = Math.PI / 2;
      disc.position.set(x, 0, 0);
      rotor.add(disc);
      for (let b = 0; b < per; b++) {
        const a = (b / per) * Math.PI * 2 + i * 0.07;
        q.setFromAxisAngle(V(1, 0, 0), a);
        q.multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0));
        m.compose(V(x, Math.sin(a) * 0 + 0, 0), q, V(1, R - hub, 1));
        // blade grows along local +y; rotate about x by a so it points radially, offset by hub
        const pos = V(x, 0, 0).add(V(0, Math.cos(a) * hub, Math.sin(a) * hub));
        m.compose(pos, q, V(1, R - hub, 1));
        blades.setMatrixAt(ib++, m);
      }
    }
  }
  rotor.add(blades);
  // shaft + couplings with bolts (visible spin cue)
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 36, 20), M.get('steel'));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(TX0 + 17.8, 0, 0);
  rotor.add(shaft);
  const boltGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);
  boltGeo.rotateZ(Math.PI / 2);
  const bolts = new THREE.InstancedMesh(boltGeo, M.get('dark'), 8 * 5);
  [37.0, 44.0, 51.1, 62.5, 66.4].forEach((x, ci) => {
    const fl = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.3, 24), M.get('stainless'));
    fl.rotation.z = Math.PI / 2;
    fl.position.set(x, 0, 0);
    rotor.add(fl);
    for (let b = 0; b < 8; b++) {
      const a = (b / 8) * Math.PI * 2;
      m.makeTranslation(x, Math.cos(a) * 0.58, Math.sin(a) * 0.58);
      bolts.setMatrixAt(ci * 8 + b, m);
    }
  });
  rotor.add(bolts);
  // generator and exciter
  root.add(casing(51.5, 62.0, 2.1, cas, false));
  const grot = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 10, 28), M.make('copper', { color: 0xb9743e }));
  grot.rotation.z = Math.PI / 2;
  grot.position.set(56.75, 0, 0);
  rotor.add(grot);
  const stator = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 9.4, 28, 1, true), M.make('copper', { color: 0xa66535 }));
  stator.rotation.z = Math.PI / 2;
  stator.position.set(56.75, TY, 0);
  root.add(stator);
  root.add(casing(63.0, 66.4, 1.0, cas, false));
  // pedestal slab and columns
  for (const [x0, x1] of [[30.4, 37.6], [51.0, 67.6]]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.7, 6.4), M.make('concrete', { color: 0x959da4 }));
    slab.position.set((x0 + x1) / 2, 3.65, 0);
    root.add(slab);
  }
  for (const x of [31.5, 36.5, 52.5, 57, 61.5, 66]) for (const z of [-2.8, 2.8]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.3, 0.9), M.make('concrete', { color: 0x959da4 }));
    c.position.set(x, 1.65, z);
    root.add(c);
  }
  // crossover pipes HP -> LP1, LP1 -> LP2 (steam arcs above)
  const cs = M.make('steel', { color: 0x8a97a3 });
  root.add(pipe([V(35.0, TY + 1.3, 0), V(35.0, TY + 3.4, 0), V(40.6, TY + 4.2, 0), V(40.6, TY + 2.35, 0)], 0.32, cs, { segments: 24, radial: 10, tension: 0.2 }));
  root.add(pipe([V(40.6, TY + 3.7, 0), V(47.6, TY + 4.2, 0), V(47.6, TY + 2.35, 0)], 0.3, cs, { segments: 24, radial: 10, tension: 0.2 }));
  let ang = 0;
  function update(state, dt) {
    ang += dt * (0.25 + 11 * state.turbineSpeed);
    rotor.rotation.x = ang;
  }
  mergeStatic(rotor);
  rotor.userData.keepSeparate = true;
  mergeStatic(root);
  return { object: root, update, rotor };
}

export function buildCondenser(M, seg) {
  const root = new THREE.Group();
  const shellMat = M.make('steel', { color: 0x7d8a96, transparent: true, opacity: 0.38 });
  shellMat.depthWrite = false;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(14, 3.0, 8.4), shellMat);
  shell.position.set(43.5, 1.9 + 0.0 - 0.0, 0);
  shell.position.y = 1.6;
  root.add(shell);
  outline(shell, { opacity: 0.55 });
  // hotwell
  const hw = new THREE.Mesh(new THREE.BoxGeometry(14, 0.5, 8.4), M.make('steel', { color: 0x5b6d7c }));
  hw.position.set(43.5, 0.25, 0);
  root.add(hw);
  // tube bundle
  const pos = [];
  for (let iy = 0; iy < 8; iy++) for (let iz = 0; iz < 26; iz++) {
    const y = 1.0 + iy * 0.28;
    const z = -3.6 + iz * 0.29;
    pos.push(37.4, y, z, 49.6, y, z);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const tubes = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x2b7fd9, transparent: true, opacity: 0.85 }));
  root.add(tubes);
  // water boxes + cooling-water pipes
  for (const x of [36.4, 50.6]) {
    const wb = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.9, 32, 1, false, 0, Math.PI), M.make('steel', { color: 0x4f86c0 }));
    wb.rotation.set(0, 0, Math.PI / 2);
    wb.position.set(x, 1.7, 0);
    wb.scale.set(1, 1, 1.6);
    root.add(wb);
  }
  // neck from the LP exhausts down to the shell
  for (const x of [40.6, 47.6]) {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 1.9, 24, 1, true), M.make('paint', { color: 0x7d8a96 }));
    neck.position.set(x, 3.95 - 0.35, 0);
    root.add(neck);
  }
  return { object: mergeStatic(root) };
}
