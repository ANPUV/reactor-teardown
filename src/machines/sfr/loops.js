// sfr/loops.js - pumps, IHX, secondary sodium, steam generators, turbine-generator, heat rejection, grid.
import * as THREE from 'three';
import { lathe, pipe, createFlow, outline, glowTexture, rng } from '../../kit/util.js';
import { spec } from './spec.js';
import { G, polar, rad, radialDir } from './geo.js';

const S = spec.items;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const tan = (deg) => V(-Math.sin(rad(deg)), 0, Math.cos(rad(deg)));
/** point at polar radius r, azimuth deg, height y, shifted `off` metres along the tangent */
const P = (r, deg, y, off = 0) => polar(r, deg, y).addScaledVector(tan(deg), off);
const loopA = (k) => G.loopAng[k];
const ihxAng = (k, j) => G.loopAng[k] + (j ? G.ihxSplit : -G.ihxSplit);

export function primaryPaths() {
  return [0, 1, 2].map((k) => {
    const a = loopA(k);
    const ai = ihxAng(k, 1);
    const pc = (y) => polar(0.5, a + 60, y);
    const pts = [
      polar(G.pumpR, a, 3.9), polar(G.pumpR, a, 2.7), polar(3.0, a, 2.7), pc(3.2), pc(G.coreY0), pc(G.coreY1 + 0.1), pc(7.6), pc(9.6),
      polar(2.2, ai, 12.2), polar(3.5, ai, 13.1), polar(G.ihxR, ai, 12.6), polar(G.ihxR, ai, 9), polar(G.ihxR, ai, 5.2), polar(G.ihxR + 0.7, ai, 4.5), polar(G.pumpR, a, 4.4),
    ];
    const L = [0];
    for (let i = 1; i <= pts.length; i++) L.push(L[i - 1] + pts[i % pts.length].distanceTo(pts[i - 1]));
    const T = L[pts.length];
    return { pts, cuts: [L[4] / T, L[6] / T, L[10] / T, L[12] / T] };
  });
}

export function buildPumps(M, seg) {
  const root = new THREE.Group();
  const groups = [];
  const rots = [];
  const shaftMat = M.make('stainless', { color: 0x8f9ba5 });
  for (let k = 0; k < 3; k++) {
    const a = loopA(k);
    const c = polar(G.pumpR, a, 0);
    const g = new THREE.Group();
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.9, 28), M.make('paint', { color: 0x4f5c68 }));
    motor.position.set(c.x, 18.65, c.z);
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.3, 28), M.make('steel', { color: 0x56626d }));
    flange.position.set(c.x, G.roofTop + 0.15, c.z);
    const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 24), M.make('dark', { color: 0x39424b }));
    fw.position.set(c.x, 19.8, c.z);
    g.add(motor, flange, fw);
    outline(motor, { opacity: 0.5 });
    // rotating assembly: shaft with stripes + impeller
    const rot = new THREE.Group();
    rot.position.set(c.x, 0, c.z);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 13.4, 14), shaftMat);
    shaft.position.y = 4.9 + 6.7;
    rot.add(shaft);
    const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.5, 0.1), M.get('dark'), 6);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) keys.setMatrixAt(i, mm.makeTranslation(0.22, 6 + i * 2.2, 0));
    rot.add(keys);
    const imp = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.14, 24), M.make('copper', { color: 0xa66535 }));
    imp.position.y = 4.2;
    rot.add(imp);
    const vanes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.56, 0.4, 0.07), M.make('copper', { color: 0xa66535 }), 6);
    const qq = new THREE.Quaternion();
    for (let i = 0; i < 6; i++) vanes.setMatrixAt(i, mm.compose(V(0, 4.4, 0), qq.setFromAxisAngle(V(0, 1, 0), (i / 6) * Math.PI), V(1, 1, 1)));
    rot.add(vanes);
    g.add(rot);
    const cas = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.5, 28, 1, true), M.make('steel', { color: 0x66727d }));
    cas.position.set(c.x, 4.15, c.z);
    g.add(cas);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.45, 0.5, 28), M.make('steel', { color: 0x66727d }));
    cap.position.set(c.x, 3.15, c.z);
    g.add(cap);
    const dis = pipe([polar(G.pumpR, a, 3.0), polar(G.pumpR, a, 2.7), polar(4.4, a, 2.7), polar(3.0, a, 2.7)], 0.3, M.make('steel', { color: 0x66727d }), { segments: 20, radial: 12, tension: 0.1 });
    g.add(dis);
    root.add(g);
    groups.push(g);
    rots.push(rot);
  }
  const ang = [0, 0, 0];
  function update(state, dt) {
    for (let k = 0; k < 3; k++) {
      ang[k] += dt * 14 * state.flowFrac;
      rots[k].rotation.y = ang[k];
    }
  }
  return { object: root, groups, update };
}

export function buildIHX(M, seg) {
  const root = new THREE.Group();
  const groups = [];
  const tubeMat = M.make('copper', { color: 0xb87333 });
  const tubes = [];
  const m = new THREE.Matrix4();
  for (let k = 0; k < 3; k++)
    for (let j = 0; j < 2; j++) {
      const a = ihxAng(k, j);
      const c = polar(G.ihxR, a, 0);
      const g = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(G.ihxRad, G.ihxRad, 13.1, 28, 1, true), M.make('stainless', { color: 0x8794a0 }));
      shell.position.set(c.x, 4.4 + 6.55, c.z);
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.9, 28), M.make('steel', { color: 0x5f6b76 }));
      head.position.set(c.x, 17.95, c.z);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.88, 20, 8, 0, 6.2832, 0, Math.PI / 2), M.make('steel', { color: 0x5f6b76 }));
      dome.position.set(c.x, 18.4, c.z);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.55, G.ihxRad, 0.5, 24), M.make('steel', { color: 0x5f6b76 }));
      foot.position.set(c.x, 4.15, c.z);
      g.add(shell, head, dome, foot);
      outline(head, { opacity: 0.5 });
      // inlet window (faces the reactor) and outlet window (faces away)
      const win = (y, face, color) => {
        const w = new THREE.Mesh(new THREE.CylinderGeometry(G.ihxRad + 0.03, G.ihxRad + 0.03, 0.9, 16, 1, true, 0, Math.PI * 0.9), M.make('dark', { color }));
        w.position.set(c.x, y, c.z);
        // thetaStart 0 is +z; rotate so the opening arc is centred on the wanted azimuth
        w.rotation.y = 0.05 * Math.PI - rad(face);
        return w;
      };
      g.add(win(13.1, a + 180 - 0, 0xdc2626), win(4.9, a, 0x2563eb));
      // secondary side: downcomer + tube bundle
      const dc = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 12.4, 12), M.get('steel'));
      dc.position.set(c.x, 4.9 + 6.2, c.z);
      g.add(dc);
      const tb = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 11.4, 6), tubeMat, 28);
      for (let i = 0; i < 28; i++) {
        const ring = i < 10 ? 0.28 : 0.47;
        const aa = i < 10 ? (i / 10) * 6.2832 : ((i - 10) / 18) * 6.2832;
        tb.setMatrixAt(i, m.makeTranslation(c.x + Math.cos(aa) * ring, 4.9 + 5.7 + 0.5, c.z + Math.sin(aa) * ring));
      }
      g.add(tb);
      root.add(g);
      groups.push(g);
    }
  const col = new THREE.Color();
  function update(state) {
    M.tempColor((state.secHot + state.secCold) / 2, 250, 600, col);
    tubeMat.color.copy(col).lerp(new THREE.Color(0xb87333), 0.35);
  }
  void tubes;
  return { object: root, groups, update };
}

export function secondaryRoutes(k) {
  const a = loopA(k);
  const ia = ihxAng(k, 0);
  const ib = ihxAng(k, 1);
  const R = G.sgR;
  const hotTrunk = [P(8, a, 20.6, 0.55), P(12.4, a, 20.6, 0.55), P(12.4, a, 13.2, 0.55), P(R - 1.5, a, 13.2, 0.55)];
  const hotA = [polar(G.ihxR, ia, 18.6), polar(G.ihxR, ia, 20.6), P(8, a, 20.6, 0.55)];
  const hotB = [polar(G.ihxR, ib, 18.6), polar(G.ihxR, ib, 20.6), P(8, a, 20.6, 0.55)];
  const coldTrunk = [P(R - 1.5, a, 2.4, -0.55), P(13.4, a, 2.4, -0.55), P(10.6, a, 2.4, -0.55), P(10.6, a, 17.9, -0.55), P(8, a, 17.9, -0.55)];
  const coldA = [P(8, a, 17.9, -0.55), polar(G.ihxR + 0.9, ia, 17.9), polar(G.ihxR + 0.2, ia, 17.9)];
  const coldB = [P(8, a, 17.9, -0.55), polar(G.ihxR + 0.9, ib, 17.9), polar(G.ihxR + 0.2, ib, 17.9)];
  return { hotTrunk, hotA, hotB, coldTrunk, coldA, coldB, pump: P(12.2, a, 2.4, -0.55) };
}

export function buildSecondary(M, seg) {
  const root = new THREE.Group();
  const hotMat = M.make('steel', { color: 0xdc2626, metalness: 0.4, roughness: 0.45 });
  const coldMat = M.make('steel', { color: 0x2563eb, metalness: 0.4, roughness: 0.45 });
  const paths = [];
  const rots = [];
  for (let k = 0; k < 3; k++) {
    const r = secondaryRoutes(k);
    root.add(pipe(r.hotTrunk, 0.34, hotMat, { segments: 50, radial: 12, tension: 0.12 }));
    root.add(pipe(r.hotA, 0.26, hotMat, { segments: 24, radial: 10, tension: 0.1 }));
    root.add(pipe(r.hotB, 0.26, hotMat, { segments: 24, radial: 10, tension: 0.1 }));
    root.add(pipe(r.coldTrunk, 0.34, coldMat, { segments: 50, radial: 12, tension: 0.1 }));
    root.add(pipe(r.coldA, 0.26, coldMat, { segments: 24, radial: 10, tension: 0.1 }));
    root.add(pipe(r.coldB, 0.26, coldMat, { segments: 24, radial: 10, tension: 0.1 }));
    // secondary pump: casing, motor, spinning coupling
    const pc = r.pump;
    const cas = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.1, 20), M.make('steel', { color: 0x66727d }));
    cas.position.copy(pc);
    const mot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.3, 20), M.make('paint', { color: 0x4f5c68 }));
    mot.position.set(pc.x, pc.y + 1.2, pc.z);
    const rot = new THREE.Group();
    rot.position.set(pc.x, pc.y + 0.62, pc.z);
    const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12), M.make('dark', { color: 0x39424b }));
    const key = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.1), M.make('copper', { color: 0xa66535 }));
    key.position.x = 0.22;
    rot.add(cp, key);
    root.add(cas, mot, rot);
    outline(mot, { opacity: 0.5 });
    rots.push(rot);
    const full = [...r.hotA, ...r.hotTrunk.slice(1)];
    paths.push({ points: full.map((v) => v.toArray()), count: 22 });
    paths.push({ points: [...r.coldTrunk, ...r.coldB.slice(1)].map((v) => v.toArray()), count: 22 });
  }
  const flow = createFlow(paths, { size: 0.55, opacity: 0.95 });
  root.add(flow.object);
  const hc = new THREE.Color();
  const cc = new THREE.Color();
  const ang = [0, 0, 0];
  function update(state, dt) {
    M.tempColor(state.secHot, 250, 600, hc);
    M.tempColor(state.secCold, 250, 600, cc);
    hotMat.color.copy(hc);
    coldMat.color.copy(cc);
    const f = Math.min(1.2, state.steamMW / S.thermal.v);
    flow.object.visible = f > 0.01 || true;
    flow.update(dt, 4.5 * Math.max(0.12, f > 0.02 ? 1 : 0.15), (pi) => (pi % 2 ? cc : hc));
    for (let k = 0; k < 3; k++) {
      ang[k] += dt * 12 * Math.max(0.1, f > 0.02 ? 1 : 0.1);
      rots[k].rotation.y = ang[k];
    }
  }
  return { object: root, update };
}

export function sgPos(k) {
  return polar(G.sgR, loopA(k), 0);
}

export function buildSteamGens(M, seg) {
  const root = new THREE.Group();
  const groups = [];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const tubeSets = [];
  for (let k = 0; k < 3; k++) {
    const a = loopA(k);
    const c = sgPos(k);
    const g = new THREE.Group();
    const R = 1.4;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 13.4, 32, 1, true), M.make('paint', { color: 0x76828d }));
    body.position.set(c.x, 0.4 + 6.7, c.z);
    const topD = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 8, 0, 6.2832, 0, Math.PI / 2), M.make('paint', { color: 0x76828d }));
    topD.position.set(c.x, 13.8, c.z);
    const botD = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 8, 0, 6.2832, Math.PI / 2, Math.PI / 2), M.make('paint', { color: 0x76828d }));
    botD.position.set(c.x, 0.4, c.z);
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 16), M.get('steel'));
    stub.position.set(c.x, 15.0, c.z);
    g.add(body, topD, botD, stub);
    outline(topD, { opacity: 0.4 });
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.5, 20, 1, true), M.get('steel'));
    skirt.position.set(c.x, 0.25, c.z);
    g.add(skirt);
    // tube bundle in three segments: economiser, evaporator, superheater
    const nT = 36;
    const tubes = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.5 }), nT * 3);
    const segs = [[1.2, 4.6], [4.6, 9.4], [9.4, 13.0]];
    for (let s = 0; s < 3; s++)
      for (let i = 0; i < nT; i++) {
        const ring = 0.35 + 0.28 * (i % 3);
        const aa = (i / nT) * 6.2832 * 1.0 + i * 0.4;
        const [y0, y1] = segs[s];
        m.compose(V(c.x + Math.cos(aa) * ring, (y0 + y1) / 2, c.z + Math.sin(aa) * ring), new THREE.Quaternion(), V(1, y1 - y0 - 0.1, 1));
        tubes.setMatrixAt(s * nT + i, m);
      }
    g.add(tubes);
    tubeSets.push({ tubes, nT });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 12, 10), M.get('steel'));
    core.position.set(c.x, 7.2, c.z);
    g.add(core);
    root.add(g);
    groups.push(g);
  }
  // steam and feedwater pipework (stays put; the SG shells spread on explode)
  const steamMat = M.make('steel', { color: 0x8693a0 });
  const fwMat = M.make('steel', { color: 0x2563eb });
  const steamPaths = [];
  const fwPaths = [];
  const pipes = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const c = sgPos(k);
    const y = 17.0 + 0.6 * k;
    const pts = [V(c.x, 15.3, c.z), V(c.x, y, c.z), V(22, y, c.z), V(22, y, 0), V(22, 17.5, 0)];
    pipes.add(pipe(pts, 0.34, steamMat, { segments: 50, radial: 12, tension: 0.05 }));
    steamPaths.push({ points: [...pts, V(29.5, 17.5, 0)].map((v) => v.toArray()), count: 20 });
    const fx = P(G.sgR + 1.5, loopA(k), 1.2);
    const fp = [fx, V(22, 1.2, fx.z), V(22, 1.2, 0), V(30, 1.2, 0)];
    pipes.add(pipe([V(c.x, 1.2, c.z), ...fp], 0.3, fwMat, { segments: 40, radial: 10, tension: 0.05 }));
    fwPaths.push({ points: [...fp].reverse().map((v) => v.toArray()), count: 14 });
  }
  pipes.add(pipe([V(22, 17.5, 0), V(29.5, 17.5, 0), V(29.5, 6.0, 0)], 0.6, steamMat, { segments: 30, radial: 14, tension: 0.05 }));
  root.add(pipes);
  const sFlow = createFlow(steamPaths, { size: 0.5, color: 0x9aa7b1, opacity: 0.9 });
  const wFlow = createFlow(fwPaths, { size: 0.4, color: 0x2563eb, opacity: 0.9 });
  root.add(sFlow.object, wFlow.object);
  const steamC = new THREE.Color(0x8d99a4);
  const wc = new THREE.Color(0x2563eb);
  let last = '';
  function update(state, dt) {
    const f = Math.min(1.2, state.steamMW / S.thermal.v);
    const run = state.turbineOnline && f > 0.02 ? Math.max(f, 0.05) : 0;
    sFlow.object.visible = wFlow.object.visible = run > 0;
    sFlow.update(dt, 9 * run, () => steamC);
    wFlow.update(dt, 4 * run, () => wc);
    const key = Math.round(f * 30) + ':' + Math.round(state.Tout / 3);
    if (key !== last) {
      last = key;
      for (const { tubes, nT } of tubeSets)
        for (let s = 0; s < 3; s++) {
          const T = [200 + 100 * f, 300 + 140 * f, 300 + 190 * f][s];
          M.tempColor(T, 150, 520, col);
          if (s === 0) col.set(0x2563eb).lerp(new THREE.Color(0x9aa7b1), 0.15 * f);
          for (let i = 0; i < nT; i++) tubes.setColorAt(s * nT + i, col);
        }
      tubeSets.forEach(({ tubes }) => (tubes.instanceColor.needsUpdate = true));
    }
  }
  return { object: root, groups, update };
}

// ------------------------------------------------------------------ turbine-generator
const TX = { hp: [27.5, 31.5, 1.1], lp1: [32.5, 38, 1.9], lp2: [39, 44.5, 1.9], gen: [45.5, 54, 1.95] };
export function buildTurbine(M, seg, detail) {
  const root = new THREE.Group();
  const rotor = new THREE.Group();
  rotor.position.set(0, G.TY, 0);
  root.add(rotor);
  const lowMat = M.make('paint', { color: 0x74818d });
  const upMat = M.make('steel', { color: 0x8794a0, transparent: true, opacity: 0.2 });
  upMat.depthWrite = false;
  const half = (x0, x1, r, lower, mat) => {
    const geo = new THREE.CylinderGeometry(r, r, x1 - x0, 40, 1, true, lower ? Math.PI : 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2, G.TY, 0);
    return mesh;
  };
  const sections = [
    { x0: TX.hp[0], x1: TX.hp[1], rc: TX.hp[2], r0: 0.45, r1: 0.85, st: 5 },
    { x0: TX.lp1[0], x1: TX.lp1[1], rc: TX.lp1[2], r0: 0.8, r1: 1.6, st: 5 },
    { x0: TX.lp2[0], x1: TX.lp2[1], rc: TX.lp2[2], r0: 0.8, r1: 1.6, st: 5 },
  ];
  const per = Math.round(18 + 12 * detail);
  const dgeo = new THREE.CylinderGeometry(0.4, 0.4, 0.16, 20);
  dgeo.rotateZ(Math.PI / 2);
  const discs = new THREE.InstancedMesh(dgeo, M.get('steel'), 15);
  let idisc = 0;
  const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 1, 0.06).translate(0, 0.5, 0), M.get('stainless'), sections.length * 5 * per);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let ib = 0;
  const hub = 0.35;
  for (const s of sections) {
    root.add(half(s.x0 - 0.15, s.x1 + 0.15, s.rc, true, lowMat), half(s.x0 - 0.15, s.x1 + 0.15, s.rc, false, upMat));
    for (const x of [s.x0 - 0.15, s.x1 + 0.15]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, s.rc, 36), lowMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(x, G.TY, 0);
      root.add(ring);
    }
    for (let i = 0; i < s.st; i++) {
      const x = s.x0 + ((s.x1 - s.x0) * (i + 0.5)) / s.st;
      const R = s.r0 + ((s.r1 - s.r0) * i) / (s.st - 1);
      discs.setMatrixAt(idisc++, m.makeTranslation(x, 0, 0));
      for (let b = 0; b < per; b++) {
        const a = (b / per) * Math.PI * 2 + i * 0.07;
        q.setFromAxisAngle(V(1, 0, 0), a);
        m.compose(V(x, Math.cos(a) * hub, Math.sin(a) * hub), q, V(1, R - hub, 1));
        blades.setMatrixAt(ib++, m);
      }
    }
  }
  rotor.add(blades, discs);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 31, 18), M.get('steel'));
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(42.5, 0, 0);
  rotor.add(shaft);
  // couplings with bolts, generator rotor with dark vents (visible rotation cues)
  const boltGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8);
  boltGeo.rotateZ(Math.PI / 2);
  const cx = [32.0, 38.5, 45.0, 54.8];
  const bolts = new THREE.InstancedMesh(boltGeo, M.get('dark'), cx.length * 8);
  const fgeo = new THREE.CylinderGeometry(0.7, 0.7, 0.28, 24);
  fgeo.rotateZ(Math.PI / 2);
  const fls = new THREE.InstancedMesh(fgeo, M.get('stainless'), cx.length);
  rotor.add(fls);
  cx.forEach((x, ci) => {
    fls.setMatrixAt(ci, m.makeTranslation(x, 0, 0));
    for (let b = 0; b < 8; b++) {
      const a = (b / 8) * Math.PI * 2;
      bolts.setMatrixAt(ci * 8 + b, m.makeTranslation(x, Math.cos(a) * 0.55, Math.sin(a) * 0.55));
    }
  });
  rotor.add(bolts);
  const grot = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 8, 28), M.make('copper', { color: 0xb87333 }));
  grot.rotation.z = Math.PI / 2;
  grot.position.set(49.75, 0, 0);
  rotor.add(grot);
  const vents = new THREE.InstancedMesh(new THREE.BoxGeometry(6.4, 0.08, 0.2), M.get('dark'), 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    q.setFromAxisAngle(V(1, 0, 0), a);
    vents.setMatrixAt(i, m.compose(V(49.75, Math.cos(a) * 0.95, Math.sin(a) * 0.95), q, V(1, 1, 1)));
  }
  rotor.add(vents);
  root.add(half(TX.gen[0], TX.gen[1], TX.gen[2], true, M.make('copper', { color: 0x9a5f33 })), half(TX.gen[0], TX.gen[1], TX.gen[2], false, M.make('steel', { color: 0x9a5f33, transparent: true, opacity: 0.18, depthWrite: false })));
  for (const x of [TX.gen[0], TX.gen[1]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, TX.gen[2], 36), M.make('copper', { color: 0x9a5f33 }));
    ring.rotation.y = Math.PI / 2;
    ring.position.set(x, G.TY, 0);
    root.add(ring);
  }
  const exc = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 2.4, 20), M.make('paint', { color: 0x5f6c78 }));
  exc.rotation.z = Math.PI / 2;
  exc.position.set(56, G.TY, 0);
  root.add(exc);
  // pedestal
  for (const [x0, x1] of [[26.5, 32.5], [44.5, 57.5]]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.6, 6.0), M.make('concrete', { color: 0x858e96 }));
    slab.position.set((x0 + x1) / 2, 3.0, 0);
    root.add(slab);
    outline(slab, { opacity: 0.5 });
  }
  const colsI = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 2.7, 0.8), M.make('concrete', { color: 0x858e96 }), 14);
  let ic = 0;
  for (const x of [27.5, 31.5, 38, 45.5, 50, 54, 57]) for (const z of [-2.5, 2.5]) colsI.setMatrixAt(ic++, m.makeTranslation(x, 1.35, z));
  root.add(colsI);
  // steam inlet to HP casing and crossover pipes to the LP sections
  const cs = M.make('steel', { color: 0x8693a0 });
  root.add(pipe([V(29.5, 5.7, 0), V(29.5, 6.2, 0)], 0.5, cs, { segments: 4, radial: 12 }));
  root.add(pipe([V(30.5, G.TY + 1.1, 0), V(30.5, G.TY + 3.3, 0), V(35.2, G.TY + 4.2, 0), V(35.2, G.TY + 1.9, 0)], 0.3, cs, { segments: 24, radial: 10, tension: 0.2 }));
  root.add(pipe([V(35.2, G.TY + 3.6, 0), V(41.8, G.TY + 4.2, 0), V(41.8, G.TY + 1.9, 0)], 0.3, cs, { segments: 24, radial: 10, tension: 0.2 }));
  let ang = 0;
  function update(state, dt) {
    ang += dt * 11 * state.turbineSpeed;
    rotor.rotation.x = ang;
  }
  return { object: root, update };
}

// ------------------------------------------------------------------ condenser, circulating water, cooling tower, plume
export const TOWER = { x: 41, z: -19, rb: 7, rt: 4.7, rn: 4.2, h: 20, hn: 14 };

/** Local plume (single Points object, soft grey, fades to the ground colour as it ages). */
function makePlume(n, origin) {
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const age = new Float32Array(n);
  const rnd = new Float32Array(n * 3);
  const rr = rng(77);
  for (let i = 0; i < n; i++) {
    age[i] = i / n;
    for (let j = 0; j < 3; j++) rnd[i * 3 + j] = rr() - 0.5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 5.5, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, map: glowTexture(), sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.fx = true;
  const base = new THREE.Color(0xaeb7c0);
  const white = new THREE.Color(0xffffff);
  const c = new THREE.Color();
  function update(dt, f) {
    const active = f < 0.01 ? 0 : Math.max(8, Math.ceil(n * Math.min(1, Math.pow(f, 0.8))));
    geo.setDrawRange(0, active);
    if (!active) return;
    const H = 6 + 4 * Math.min(1, f);
    for (let i = 0; i < active; i++) {
      age[i] += dt * 0.09 * (0.5 + 0.5 * Math.min(1, f));
      if (age[i] > 1) age[i] -= 1;
      const a = age[i];
      const sp = 1.5 + a * 9;
      pos[i * 3] = origin.x + a * 4 + rnd[i * 3] * sp;
      pos[i * 3 + 1] = origin.y + a * H + rnd[i * 3 + 1] * sp * 0.5;
      pos[i * 3 + 2] = origin.z + rnd[i * 3 + 2] * sp;
      c.copy(base).lerp(white, Math.min(1, a * a * 1.1));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  return { object: pts, update };
}

export function buildCooling(M, seg) {
  const root = new THREE.Group();
  const T = TOWER;
  const cond = new THREE.Mesh(new THREE.BoxGeometry(11.5, 2.2, 5.2), M.make('steel', { color: 0x6c7985 }));
  cond.position.set(38.75, 1.4, 0);
  root.add(cond);
  outline(cond, { opacity: 0.6 });
  const wb = (x) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.7, 5.4), M.make('paint', { color: 0x4d5a66 }));
    b.position.set(x, 1.4, 0);
    return b;
  };
  root.add(wb(32.4), wb(45.1));
  // hyperbolic tower
  const prof = [];
  const k1 = (T.rb * T.rb - T.rn * T.rn) / (T.hn * T.hn);
  const k2 = (T.rt * T.rt - T.rn * T.rn) / ((T.h - T.hn) * (T.h - T.hn));
  for (let i = 0; i <= 20; i++) {
    const y = (i / 20) * T.h;
    const d = y - T.hn;
    prof.push([Math.sqrt(T.rn * T.rn + (y < T.hn ? k1 : k2) * d * d), y]);
  }
  const shell = lathe([...prof.map(([r, y]) => [r + 0.12, y]), ...prof.map(([r, y]) => [r, y]).reverse()], M.make('concrete', { color: 0x9aa2a9 }), seg);
  shell.position.set(T.x, 2.0, T.z);
  root.add(shell);
  const topRing = new THREE.Mesh(new THREE.TorusGeometry(prof[20][0] + 0.06, 0.1, 6, seg), M.make('concrete', { color: 0x6f7881 }));
  topRing.rotation.x = Math.PI / 2;
  topRing.position.set(T.x, 2.0 + T.h, T.z);
  root.add(topRing);
  const cols = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.25, 2.0, 8), M.get('concrete'), 24);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * 6.2832;
    cols.setMatrixAt(i, m.makeTranslation(T.x + Math.cos(a) * (T.rb - 0.1), 1.0, T.z + Math.sin(a) * (T.rb - 0.1)));
  }
  root.add(cols);
  const basin = new THREE.Mesh(new THREE.CircleGeometry(T.rb, seg), M.make('water', { color: 0x2563eb, opacity: 0.55 }));
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(T.x, 0.3, T.z);
  root.add(basin);
  // circulating-water pipes
  const coldM = M.make('steel', { color: 0x2563eb });
  const warmM = M.make('steel', { color: 0xc2410c });
  const zc = T.z + T.rb;
  const cold = [V(37, 1.2, zc), V(37, 1.2, -6), V(37, 1.2, -2.6)];
  const warm = [V(42, 1.2, -2.6), V(42, 1.2, -6), V(42, 1.2, zc)];
  root.add(pipe(cold, 0.5, coldM, { segments: 20, radial: 14, tension: 0.05 }), pipe(warm, 0.5, warmM, { segments: 20, radial: 14, tension: 0.05 }));
  const cw = createFlow([{ points: cold.map((v) => v.toArray()), count: 16 }, { points: warm.map((v) => v.toArray()), count: 16 }], { size: 0.5, opacity: 0.95 });
  root.add(cw.object);
  const plume = makePlume(260, V(T.x, 2.0 + T.h, T.z));
  root.add(plume.object);
  const cC = new THREE.Color(0x2563eb);
  const wC = new THREE.Color(0xc2410c);
  const cur = new THREE.Color();
  const BASE = S.thermal.v - S.electric.v;
  function update(state, dt) {
    const f = Math.min(1.2, state.rejectedMW / BASE);
    cw.object.visible = f > 0.01;
    cw.update(dt, 2.5 * Math.min(1, f + 0.05), (pi) => (pi === 0 ? cC : cur.copy(cC).lerp(wC, Math.min(1, f))));
    warmM.color.copy(cC).lerp(wC, Math.min(1, f));
    plume.update(dt, f);
  }
  return { object: root, update };
}

// ------------------------------------------------------------------ generator output and grid
export function buildGrid(M, seg) {
  const root = new THREE.Group();
  const tr = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.5, 3.2), M.make('paint', { color: 0x5f6c78 }));
  tr.position.set(60, 1.75, -5);
  root.add(tr);
  outline(tr, { opacity: 0.6 });
  const bush = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 0.7, 10), M.make('dark', { color: 0xc2410c }), 3);
  for (let i = -1; i <= 1; i++) bush.setMatrixAt(i + 1, new THREE.Matrix4().makeTranslation(60 + i * 0.9, 3.85, -5));
  root.add(bush);
  const wireM = new THREE.LineBasicMaterial({ color: 0x14202b });
  const pyl = [-12, -20, -28];
  const mkPylon = (z) => {
    const g = new THREE.Group();
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.55, 11, 4), M.make('steel', { color: 0x56626d }));
    leg.rotation.y = Math.PI / 4;
    leg.position.set(60, 5.5, z);
    g.add(leg);
    for (const [y, w] of [[10.2, 5], [8.0, 4]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.18), M.make('steel', { color: 0x56626d }));
      arm.position.set(60, y, z);
      g.add(arm);
    }
    return g;
  };
  pyl.forEach((z) => root.add(mkPylon(z)));
  // three conductors (xo offsets) sagging between pylons
  const seg2 = [];
  for (const xo of [-2.2, 0, 2.2]) {
    const y = xo === 0 ? 10.4 : 8.2;
    const pts = [60 + xo, 60 + xo];
    void pts;
    for (let i = 0; i < pyl.length - 1; i++) {
      let prev = null;
      for (let t = 0; t <= 1.0001; t += 0.125) {
        const z = pyl[i] + (pyl[i + 1] - pyl[i]) * t;
        const yy = y - 1.4 * 4 * t * (1 - t);
        const p = [60 + xo, yy, z];
        if (prev) seg2.push(...prev, ...p);
        prev = p;
      }
    }
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(seg2, 3));
  root.add(new THREE.LineSegments(lg, wireM));
  // bus from the generator terminal to the transformer, then the line itself
  const busM = M.make('copper', { color: 0xb87333 });
  root.add(pipe([V(54.2, G.TY, 0), V(60, G.TY, 0), V(60, 4.4, -4.2)], 0.22, busM, { segments: 20, radial: 8, tension: 0.05 }));
  const path = [V(54.2, G.TY, 0), V(60, G.TY, 0), V(60, 4.4, -4.2), V(60, 4.2, -5), V(60, 10.4, -12), V(60, 9.8, -16), V(60, 10.4, -20), V(60, 9.8, -24), V(60, 10.4, -28)];
  const N = 40;
  const pulses = createFlow([{ points: path.map((v) => v.toArray()), count: N }], { size: 0.55, color: 0x7c3aed, opacity: 1 });
  root.add(pulses.object);
  const pc = new THREE.Color(0x7c3aed);
  function update(state, dt) {
    const f = Math.min(1.1, state.electricMW / S.electric.v);
    const k = f < 0.01 ? 0 : Math.max(3, Math.ceil(N * f));
    pulses.object.geometry.setDrawRange(0, k);
    pulses.update(dt, 7 * (k ? 1 : 0), () => pc);
  }
  return { object: root, update };
}
