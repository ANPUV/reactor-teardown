// sfr/reactor.js - pit, vessels, sodium pool, core, blanket, rods, plug, fuel drill-down.
import * as THREE from 'three';
import { lathe, outline, createFlow, pipe } from '../../kit/util.js';
import { spec } from './spec.js';
import { G, LAT, polar, rad } from './geo.js';

const S = spec.items;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GREEN = new THREE.Color(0x059669); // identity colour: breeding
const ZONE_COL = [0, 0x6a8cad, 0x86996a, 0xb38a58];

const ellipse = (cx, cy, a, b, t0, t1, n) => Array.from({ length: n + 1 }, (_, k) => {
  const t = t0 + ((t1 - t0) * k) / n;
  return [cx + a * Math.cos(t), cy + b * Math.sin(t)];
});

export function buildPit(M, seg) {
  const g = new THREE.Group();
  const wall = lathe([[G.pitRi, 0], [G.pitRo, 0], [G.pitRo, G.vesTop], [G.pitRi, G.vesTop], [G.pitRi, 0]], M.make('concrete', { color: 0x9aa2a9 }), seg);
  g.add(wall);
  const slab = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.5, 1.2, seg), M.make('concrete', { color: 0x858e96 }));
  slab.position.y = -0.6;
  g.add(slab);
  outline(slab, { opacity: 0.5 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(G.pitRi, seg), M.make('concrete', { color: 0x8f989f }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  g.add(floor);
  for (const y of [8]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(G.pitRo + 0.01, 0.07, 6, seg), M.make('concrete', { color: 0x7b848c }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  return g;
}

export function buildVessel(M, seg) {
  const g = new THREE.Group();
  const shellMat = (c) => M.make('steel', { color: c });
  const vessel = (ro, ri, bot, top, mat) => {
    const dish = 1.3;
    const outer = ellipse(0, bot + dish, ro, dish, -Math.PI / 2, 0, 14);
    const inner = ellipse(0, bot + dish + 0.05, ri, dish, 0, -Math.PI / 2, 14);
    return lathe([[ri, top], [ro, top], ...outer.slice().reverse(), ...inner.slice().reverse(), [ri, top]], mat, seg);
  };
  g.add(vessel(G.vesRo, G.vesRi, G.vesBot, G.vesTop, shellMat(0x7f8b96)));
  g.add(vessel(G.guardR + 0.07, G.guardR, G.guardBot, G.guardTop, shellMat(0x4d5963)));
  // top flange where the roof bears on the vessel
  const fl = new THREE.Mesh(new THREE.CylinderGeometry(G.guardR + 0.35, G.guardR + 0.35, 0.3, seg, 1, true), M.make('steel', { color: 0x5c6872 }));
  fl.position.y = G.vesTop - 0.15;
  g.add(fl);
  outline(fl, { opacity: 0.5 });
  // separation shell between hot and cold pool
  g.add(lathe([[G.shellR - 0.05, G.asm0], [G.shellR + 0.05, G.asm0], [G.shellR + 0.05, G.shellTop], [G.shellR - 0.05, G.shellTop], [G.shellR - 0.05, G.asm0]], M.make('stainless', { color: 0x8a96a1 }), seg));
  // core support cylinder holding the diagrid up from the vessel floor (the pressure plenum is inside it)
  const sk = new THREE.Mesh(new THREE.CylinderGeometry(G.shellR, G.shellR + 0.15, G.asm0 - 1.9, seg, 1, true), M.make('steel', { color: 0x5f6b76 }));
  sk.position.y = (G.asm0 + 1.9) / 2;
  g.add(sk);
  // support lugs between guard vessel and pit floor
  const lugs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), M.get('steel'), 8);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) lugs.setMatrixAt(i, m.makeTranslation(Math.cos((i / 8) * 6.2832) * 4.2, 0.45, Math.sin((i / 8) * 6.2832) * 4.2));
  g.add(lugs);
  return g;
}

/** Hot pool, cold pool, free surfaces, argon cover gas and the primary flow particles (the pool part). */
export function buildPool(M, seg, loopPaths) {
  const g = new THREE.Group();
  const hotMat = M.make('sodium', { color: 0xdc2626, transparent: true, opacity: 0.3, metalness: 0.3, roughness: 0.4, depthWrite: false });
  const coldMat = M.make('sodium', { color: 0x2563eb, transparent: true, opacity: 0.24, metalness: 0.3, roughness: 0.4, depthWrite: false });
  const ri = G.vesRi - 0.03;
  const dish = 1.3;
  const arc = ellipse(0, G.vesBot + dish + 0.05, ri, dish, -Math.PI / 2, 0, 14);
  const cold = lathe([...arc, [ri, G.level], [G.shellR + 0.08, G.level], [G.shellR + 0.08, G.hotBase], [0, G.hotBase], [0, arc[0][1]]], coldMat, seg);
  const hot = lathe([[0, G.hotBase], [G.shellR - 0.08, G.hotBase], [G.shellR - 0.08, G.levelHot], [0, G.levelHot], [0, G.hotBase]], hotMat, seg);
  g.add(cold, hot);
  const surfMat = M.make('sodium', { color: 0x7d8791, metalness: 0.95, roughness: 0.12, transparent: true, opacity: 0.9 });
  const sc = new THREE.Mesh(new THREE.RingGeometry(G.shellR + 0.1, ri, seg), surfMat);
  sc.rotation.x = -Math.PI / 2;
  sc.position.y = G.level;
  const sh = new THREE.Mesh(new THREE.CircleGeometry(G.shellR - 0.1, seg), surfMat);
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = G.levelHot;
  g.add(sc, sh);
  const gas = new THREE.Mesh(new THREE.CylinderGeometry(ri, ri, G.vesTop - G.level - 0.05, seg, 1, true), M.make('glass', { color: 0x3b9d86, opacity: 0.16, transparent: true, depthWrite: false }));
  gas.position.y = (G.level + G.vesTop) / 2;
  g.add(gas);
  // primary flow particles: plenum -> core -> hot pool -> IHX -> cold pool -> pump -> plenum (three loops)
  const flow = createFlow(loopPaths.map((p) => ({ points: p.pts.map((v) => v.toArray()), count: 70, loop: true })), { size: 0.55, opacity: 0.95 });
  g.add(flow.object);
  const cl = new THREE.Color();
  const hotC = new THREE.Color();
  const coldC = new THREE.Color();
  const cuts = loopPaths.map((p) => p.cuts);
  function update(state, dt) {
    M.tempColor(state.Tout, 330, 600, hotC);
    M.tempColor(state.Tin, 330, 600, coldC);
    hotMat.color.copy(hotC);
    coldMat.color.copy(coldC);
    flow.update(dt, 3.5 * state.flowFrac, (pi, u) => {
      const c = cuts[pi];
      const f = u < c[0] ? 0 : u < c[1] ? (u - c[0]) / (c[1] - c[0]) : u < c[2] ? 1 : u < c[3] ? 1 - (u - c[2]) / (c[3] - c[2]) : 0;
      return cl.copy(coldC).lerp(hotC, f);
    });
  }
  return { object: g, update, hotMat, coldMat };
}

// ------------------------------------------------------------------ core, blanket, rods
const hexGeo = (R, h, open = true) => {
  const geo = new THREE.CylinderGeometry(R, R, h, 6, 1, open);
  return geo;
};

export function buildCore(M) {
  const g = new THREE.Group();
  const col = new THREE.Color();
  const m = new THREE.Matrix4();
  const nF = LAT.fuel.length;
  const wrapGeo = hexGeo(G.asmR, G.asmTop - G.asm0);
  const wrapMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.5, side: THREE.DoubleSide });
  const wraps = new THREE.InstancedMesh(wrapGeo, wrapMat, nF);
  LAT.fuel.forEach((c, i) => {
    wraps.setMatrixAt(i, m.makeTranslation(c.x, (G.asm0 + G.asmTop) / 2, c.z));
    wraps.setColorAt(i, col.set(ZONE_COL[c.zone]));
  });
  g.add(wraps);
  // active band, coloured by temperature
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.2, roughness: 0.55, side: THREE.DoubleSide });
  const bands = new THREE.InstancedMesh(hexGeo(G.asmR * 1.05, G.coreH), bandMat, nF);
  LAT.fuel.forEach((c, i) => {
    bands.setMatrixAt(i, m.makeTranslation(c.x, G.coreY0 + G.coreH / 2, c.z));
    bands.setColorAt(i, col.set(0x9aa0a8));
  });
  g.add(bands);
  // assembly heads (zone tint, visible from above) - closed caps
  const heads = new THREE.InstancedMesh(hexGeo(G.asmR * 0.9, 0.25, false), M.get('steel'), nF);
  LAT.fuel.forEach((c, i) => heads.setMatrixAt(i, m.makeTranslation(c.x, G.asmTop + 0.125, c.z)));
  g.add(heads);
  // diagrid
  const dg = new THREE.Mesh(new THREE.CylinderGeometry(G.shellR, G.shellR, 0.3, 64), M.make('steel', { color: 0x56626d }));
  dg.position.y = G.asm0 - 0.15;
  g.add(dg);
  outline(dg, { opacity: 0.5 });
  const Rext = LAT.Rmax + 0.1;
  const rel = LAT.fuel.map((c) => Math.cos((Math.PI / 2) * (Math.hypot(c.x, c.z) / Rext)));
  const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
  for (let i = 0; i < rel.length; i++) rel[i] /= mean;
  let lastKey = '';
  function update(state) {
    const key = Math.round(state.Tfuel / 5) + ':' + Math.round(state.Tavg / 3);
    if (key === lastKey) return;
    lastKey = key;
    for (let i = 0; i < nF; i++) {
      const T = state.Tavg + (state.Tfuel - state.Tavg) * rel[i];
      M.tempColor(T, 350, 1100, col);
      bands.setColorAt(i, col);
    }
    bands.instanceColor.needsUpdate = true;
  }
  return { object: g, update };
}

export function buildBlanket(M) {
  const g = new THREE.Group();
  const n = LAT.blanket.length;
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  const wraps = new THREE.InstancedMesh(hexGeo(G.asmR, G.asmTop - G.asm0), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.55, side: THREE.DoubleSide }), n);
  LAT.blanket.forEach((c, i) => {
    wraps.setMatrixAt(i, m.makeTranslation(c.x, (G.asm0 + G.asmTop) / 2, c.z));
    wraps.setColorAt(i, col.set(0x4b5a52));
  });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide, emissive: GREEN, emissiveIntensity: 0.3 });
  const bands = new THREE.InstancedMesh(hexGeo(G.asmR * 1.07, G.coreH + 0.5), bandMat, n);
  LAT.blanket.forEach((c, i) => {
    bands.setMatrixAt(i, m.makeTranslation(c.x, G.coreY0 + G.coreH / 2, c.z));
    bands.setColorAt(i, col.set(0x4b5a52));
  });
  const heads = new THREE.InstancedMesh(hexGeo(G.asmR * 0.9, 0.25, false), M.get('steel'), n);
  LAT.blanket.forEach((c, i) => heads.setMatrixAt(i, m.makeTranslation(c.x, G.asmTop + 0.125, c.z)));
  g.add(wraps, bands, heads);
  const base = new THREE.Color(0x4b5a52);
  const rim = LAT.blanket.map((c) => 0.75 + 0.25 * Math.sin(Math.atan2(c.z, c.x) * 3));
  let last = '';
  function update(state, t) {
    // glow in the breeding colour grows with the capture rate in the blanket; a slow pulse shows it is alive
    const act = Math.min(1.1, state.bladeKgDay / (S.bredPerDay.v * S.brBlanket.v));
    const key = Math.round(act * 40) + ':' + (Math.round(t * 3) % 6);
    if (key === last) return;
    last = key;
    for (let i = 0; i < n; i++) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 2 + i * 0.7);
      col.copy(base).lerp(GREEN, Math.min(1, act * rim[i] * pulse));
      bands.setColorAt(i, col);
    }
    bands.instanceColor.needsUpdate = true;
    bandMat.emissiveIntensity = 0.1 + 0.9 * Math.min(1, act);
  }
  return { object: g, update };
}

export function buildRods(M) {
  const g = new THREE.Group();
  const n = LAT.rods.length;
  const m = new THREE.Matrix4();
  const guide = new THREE.InstancedMesh(hexGeo(G.asmR, G.asmTop - G.asm0), M.make('dark', { color: 0x2f3841 }), n);
  LAT.rods.forEach((c, i) => guide.setMatrixAt(i, m.makeTranslation(c.x, (G.asm0 + G.asmTop) / 2, c.z)));
  const L = 0.95;
  const abGeo = new THREE.CylinderGeometry(0.036, 0.036, L, 10);
  abGeo.translate(0, L / 2, 0);
  const ab = new THREE.InstancedMesh(abGeo, M.make('absorber', { color: 0x1c2228 }), n);
  const shGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 6);
  shGeo.translate(0, 0.5, 0);
  const sh = new THREE.InstancedMesh(shGeo, M.get('stainless'), n);
  const drvGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.3, 12);
  const drv = new THREE.InstancedMesh(drvGeo, M.make('dark', { color: 0x39424b }), n);
  const topY = 18.4;
  LAT.rods.forEach((c, i) => drv.setMatrixAt(i, m.makeTranslation(c.x, topY + 0.65, c.z)));
  g.add(guide, ab, sh, drv);
  let last = -1;
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  function setPos(x) {
    if (Math.abs(x - last) < 1e-5) return;
    last = x;
    const tip = G.coreY0 - 0.05 + x * (G.coreH + 0.2);
    LAT.rods.forEach((c, i) => {
      ab.setMatrixAt(i, m.makeTranslation(c.x, tip, c.z));
      const top = tip + L;
      sh.setMatrixAt(i, m.compose(V(c.x, top, c.z), q, V(1, topY - top, 1)));
    });
    ab.instanceMatrix.needsUpdate = sh.instanceMatrix.needsUpdate = true;
  }
  setPos(0.88);
  void one;
  return { object: g, setPos };
}

// ------------------------------------------------------------------ roof, rotating plugs, central column, refuelling machine
export function buildPlug(M, seg) {
  const g = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(G.pitRo, G.pitRo, G.roofTop - G.vesTop, seg), M.make('concrete', { color: 0x8e979e }));
  roof.position.y = (G.roofTop + G.vesTop) / 2;
  g.add(roof);
  outline(roof, { opacity: 0.55 });
  const lp = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 2.95, 0.7, 48), M.make('steel', { color: 0x5f6b76 }));
  lp.position.set(-0.45, G.roofTop + 0.35, 0);
  const sp = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.0, 40), M.make('steel', { color: 0x4b5761 }));
  sp.position.set(0, G.roofTop + 0.5, 0);
  g.add(lp, sp);
  outline(lp, { opacity: 0.6 });
  outline(sp, { opacity: 0.6 });
  // central column over the core (hollow, so the rods show when cut)
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, G.roofTop - G.asmTop - 0.3, 40, 1, true), M.make('stainless', { color: 0x7d8993 }));
  col.position.y = (G.asmTop + 0.3 + G.roofTop) / 2;
  g.add(col);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.75, 0.2, 40), M.make('steel', { color: 0x56626d }));
  cap.position.y = G.asmTop + 0.4;
  cap.visible = true;
  // refuelling machine on the large plug
  const rm = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 3.2, 28), M.make('paint', { color: 0x5b6772 }));
  body.position.y = 1.6;
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.0, 28), M.make('steel', { color: 0x4a555f }));
  drum.position.y = 0.5;
  const motor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.9), M.make('dark', { color: 0x39424b }));
  motor.position.set(0, 3.7, 0);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 12), M.get('stainless'));
  grip.position.y = 4.5;
  rm.add(body, drum, motor, grip);
  const a = rad(-25);
  rm.position.set(2.3 * Math.cos(a), G.roofTop + 0.7, 2.3 * Math.sin(a));
  g.add(rm);
  outline(body, { opacity: 0.5 });
  // in-vessel transfer arm hanging below the large plug (visible when cut)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.6), M.get('steel'));
  arm.position.set(-1.3, G.asmTop + 1.3, 0.0);
  arm.rotation.y = 0.6;
  g.add(arm);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 6.0, 10), M.get('steel'));
  stem.position.set(-1.9, G.asmTop + 1.3 + 3.0, 0.3);
  g.add(stem);
  return { object: g, rm };
}

// ------------------------------------------------------------------ fuel drill-down
const MAG_ASM = 14;
const MAG_PIN = 60;
export const PIN_P = 8.0; // mm pin pitch (derived: 94.5 mm flats, 127 pins)
const hexPins = () => {
  const out = [[0, 0]];
  for (let ring = 1; ring <= 6; ring++) {
    for (let k = 0; k < 6 * ring; k++) {
      const side = Math.floor(k / ring);
      const idx = k % ring;
      const a0 = (side * Math.PI) / 3;
      const a1 = ((side + 1) * Math.PI) / 3;
      const p0 = [Math.cos(a0) * ring, Math.sin(a0) * ring];
      const p1 = [Math.cos(a1) * ring, Math.sin(a1) * ring];
      out.push([p0[0] + ((p1[0] - p0[0]) * idx) / ring, p0[1] + ((p1[1] - p0[1]) * idx) / ring]);
    }
  }
  return out;
};

export function buildAssemblyDrill(M) {
  const g = new THREE.Group();
  const k = MAG_ASM;
  const p = (PIN_P / 1000) * k;
  const R = (S.pinOD.v / 2000) * k;
  const len = 1.6;
  const pins = hexPins();
  const pinMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(R, R, len, 14), M.make('steel', { color: 0x8f9aa4 }), pins.length);
  const wireTurns = 2.2;
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 1 / 60) {
    const a = t * wireTurns * 6.2832;
    pts.push(V(Math.cos(a) * (R + 0.012 * k * 0.4), -len / 2 + t * len, Math.sin(a) * (R + 0.012 * k * 0.4)));
  }
  const wireGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.011 * k * 0.5, 6);
  const wire = new THREE.InstancedMesh(wireGeo, M.make('stainless', { color: 0x4f5a64 }), pins.length);
  const m = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  pins.forEach(([a, b], i) => {
    // hex-lattice coordinates -> x,z (ring vectors are 60 deg apart)
    const x = a * p;
    const z = b * p;
    pinMesh.setMatrixAt(i, m.makeTranslation(x, 0, z));
    q.setFromEuler(e.set(0, i * 0.9, 0));
    wire.setMatrixAt(i, m.compose(V(x, 0, z), q, V(1, 1, 1)));
  });
  g.add(pinMesh, wire);
  const Rw = (S.acrossFlats.v / 1000 / Math.sqrt(3)) * k;
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(Rw, Rw, len, 6, 1, true), M.make('steel', { color: 0x6d7984 }));
  wrap.rotation.y = Math.PI / 2;
  g.add(wrap);
  outline(wrap, { opacity: 0.7 });
  // head and spacer tab rings so the slice reads as a piece of a long assembly
  for (const y of [-len / 2 + 0.05, len / 2 - 0.05]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(Rw * 1.0, Rw * 1.0, 0.1, 6, 1, true), M.make('dark', { color: 0x2f3841 }));
    ring.position.y = y;
    ring.rotation.y = Math.PI / 2;
    g.add(ring);
  }
  g.position.copy(G.drill);
  g.userData.count = pins.length;
  return g;
}

export function buildPinDrill(M) {
  const g = new THREE.Group();
  const k = MAG_PIN;
  const R = (S.pinOD.v / 2000) * k;
  const wall = 0.4e-3 * k;
  const L = 3.2;
  const mk = (r, color) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 40, 1, true, 0, Math.PI * 1.5), M.make('steel', { color }));
    m.rotation.y = Math.PI * 0.25;
    return m;
  };
  g.add(mk(R, 0x8f9aa4), mk(R - wall, 0x66707a));
  const pelR = R - wall - 0.012;
  const pelH = 0.2;
  const n = 7;
  const pel = new THREE.InstancedMesh(new THREE.CylinderGeometry(pelR, pelR, pelH * 0.95, 32), M.make('fuel', { color: 0x4a5249 }), n);
  const m = new THREE.Matrix4();
  const y0 = -L / 2 + 0.4 + pelH / 2;
  for (let i = 0; i < n; i++) pel.setMatrixAt(i, m.makeTranslation(0, y0 + i * pelH, 0));
  g.add(pel);
  // spring in the plenum
  const top = y0 + (n - 1) * pelH + pelH / 2;
  const sp = [];
  for (let t = 0; t <= 1; t += 0.01) sp.push(V(Math.cos(t * 40) * pelR * 0.7, top + 0.05 + t * (L / 2 - 0.3 - top), Math.sin(t * 40) * pelR * 0.7));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp), 140, 0.02, 6), M.get('stainless')));
  // spiral spacer wire
  const wp = [];
  for (let t = 0; t <= 1; t += 0.004) wp.push(V(Math.cos(t * 22) * (R + 0.04), -L / 2 + 0.1 + t * (L - 0.2), Math.sin(t * 22) * (R + 0.04)));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(wp), 300, 0.035, 6), M.make('stainless', { color: 0x4f5a64 })));
  for (const y of [-L / 2, L / 2]) {
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.8, 0.26, 24), M.make('steel', { color: 0x8f9aa4 }));
    plug.position.y = y;
    g.add(plug);
  }
  g.position.copy(G.drill);
  return g;
}
export { MAG_ASM, MAG_PIN, pipe };
