// tokamak/structures.js - passive hardware: cryostat, magnets, vessel, blanket, divertor.
// Every builder returns { object, spread?, update?(state, dt, anim) }. Metres, y up, floor at y = 0, plasma midplane at Y0.
import * as THREE from 'three';
import { lathe, outline } from '../../kit/util.js';
import { spec } from './spec.js';
import { R0, Y0, SH, pol, sweep, cap, merge, tfOutline, inset } from './shapes.js';

const I = spec.items;
const D2R = Math.PI / 180;
export const TF_N = I.tfN.v;
export const phiTF = (k) => (10 + (360 / TF_N) * k) * D2R; // coil centre angles: 10, 30, ... degrees
export const SECT = I.vvSectors.v;
export const phiSect = (s) => (20 + (360 / SECT) * s) * D2R; // sector centre angles: 20, 60, ...
export const radial = (phi, d) => [Math.cos(phi) * d, 0, Math.sin(phi) * d];

/** Group that holds midplane-centred children at the right height. */
export function midplane() {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = Y0;
  outer.add(inner);
  return { outer, inner };
}

// ------------------------------------------------------------------ cryostat
export const FAN = 3.4; // common radial fan-out of the toroidal assembly (coils, vessel, blanket, divertor, ports)
export const CRYO_LIFT = 27;
export function buildCryostat(M, seg) {
  const g = new THREE.Group();
  const r = I.cryoD.v / 2;
  const H = I.cryoH.v;
  const prof = [[r, 0.8]];
  for (let y = 3; y < H - 1; y += 3) prof.push([r, y - 0.25], [r + 0.3, y - 0.25], [r + 0.3, y + 0.25], [r, y + 0.25]);
  prof.push([r, H], [r - 3, H + 0.5], [0, H + 0.9]);
  const wall = lathe(prof, M.make('stainless', { color: 0x8995a0, metalness: 0.6, roughness: 0.4 }), seg);
  outline(wall, { opacity: 0.4 });
  g.add(wall);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.4, r + 0.4, 0.8, seg), M.make('concrete', { color: 0x969ea6 }));
  base.position.y = 0.4;
  g.add(base);
  // the drum (wall and lid) lifts away; the base slab stays on the floor
  return { object: g, spread: [{ object: wall, offset: [0, CRYO_LIFT, 0] }] };
}

// ------------------------------------------------------------------ central solenoid
export function buildCS(M, seg) {
  const { outer, inner } = midplane();
  const n = I.csN.v;
  const h = I.csH.v / n;
  const mat = M.make('steel', { color: 0x5d7088, metalness: 0.6, roughness: 0.4 });
  mat.emissive = new THREE.Color(0x000000);
  const geo = new THREE.LatheGeometry([[0.7, 0], [I.csW.v / 2, 0], [I.csW.v / 2, h - 0.12], [0.7, h - 0.12], [0.7, 0]].map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const mods = [];
  for (let k = 0; k < n; k++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -I.csH.v / 2 + k * h;
    outline(mesh, { opacity: 0.45 });
    inner.add(mesh);
    mods.push(mesh);
  }
  const support = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.8, Y0 - I.csH.v / 2 - 0.8 + 0.05, 24), M.make('steel', { color: 0x59646e }));
  support.position.y = 0.8 + (Y0 - I.csH.v / 2 - 0.8 + 0.05) / 2;
  outer.add(support);
  return { object: outer, mods, mat, spread: mods.map((o, k) => ({ object: o, offset: [0, k * 0.6, 0] })), h };
}

// ------------------------------------------------------------------ toroidal field coils
export function buildTF(M) {
  const { outer, inner } = midplane();
  const out = tfOutline(90);
  const hole = inset(out, ([x]) => 0.8 + 0.2 * Math.min(1, Math.max(0, (x - 3) / 3)));
  const shape = new THREE.Shape(out.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y)).reverse()));
  const t = 0.8;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -t / 2);
  const mat = M.make('steel', { color: 0x4f6f94, metalness: 0.5, roughness: 0.5 });
  mat.emissive = new THREE.Color(0x000000);
  const coils = [];
  const pedGeo = new THREE.CylinderGeometry(0.5, 0.6, 5.5, 14);
  const pedMat = M.make('steel', { color: 0x59646e });
  for (let k = 0; k < TF_N; k++) {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.y = -phiTF(k);
    // gravity support under each coil travels with it
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.set(5.7, -8.3 - 2.7, 0);
    m.add(ped);
    inner.add(m);
    coils.push(m);
  }
  // centreline of the winding (between outline and hole) for the current pulses and helium flow
  const mid = out.map((p, i) => [(p[0] + hole[i][0]) / 2, (p[1] + hole[i][1]) / 2]);
  return { object: outer, coils, mat, mid, spread: coils.map((o, k) => ({ object: o, offset: radial(phiTF(k), FAN) })) };
}

// ------------------------------------------------------------------ poloidal field coils
export const PF = [
  { R: 3.9, y: 8.9, w: 1.4, h: 1.4, up: 3 },
  { R: 8.0, y: 8.6, w: 1.4, h: 1.4, up: 2 },
  { R: 12.0, y: 1.8, w: 1.5, h: 1.2, up: 9 },
  { R: 12.0, y: -1.8, w: 1.5, h: 1.2, up: -9 },
  { R: 8.2, y: -8.6, w: 1.4, h: 1.4, up: -3 },
  { R: 4.3, y: -9.4, w: 1.4, h: 1.4, up: -3 },
];
export function buildPF(M, seg) {
  const { outer, inner } = midplane();
  const mat = M.make('steel', { color: 0x4f8a8b, metalness: 0.5, roughness: 0.5 });
  mat.emissive = new THREE.Color(0x000000);
  const rings = PF.map((c) => {
    const w = c.w / 2;
    const h = c.h / 2;
    const m = new THREE.Mesh(new THREE.LatheGeometry([[c.R - w, -h], [c.R + w, -h], [c.R + w, h], [c.R - w, h], [c.R - w, -h]].map(([r, y]) => new THREE.Vector2(r, y)), seg), mat);
    m.position.y = c.y;
    outline(m, { opacity: 0.45 });
    inner.add(m);
    return m;
  });
  return { object: outer, rings, mat, spread: rings.map((o, k) => ({ object: o, offset: [0, PF[k].up, 0] })) };
}

// ------------------------------------------------------------------ vacuum vessel (9 sectors)
export function buildVessel(M, detail) {
  const { outer, inner } = midplane();
  const nTh = detail >= 0.9 ? 44 : detail >= 0.5 ? 36 : 28;
  const mat = M.make('stainless', { color: 0x7d8a96, metalness: 0.6, roughness: 0.45 });
  const sectors = [];
  const w = 360 / SECT;
  for (let s = 0; s < SECT; s++) {
    const p0 = (s * w + 1) * D2R;
    const p1 = ((s + 1) * w - 1) * D2R;
    const geo = merge([
      sweep(SH.vvOut, nTh, p0, p1, 10),
      sweep(SH.vvIn, nTh, p0, p1, 10),
      cap(SH.vvIn, SH.vvOut, p0, nTh),
      cap(SH.vvIn, SH.vvOut, p1, nTh),
    ]);
    const mesh = new THREE.Mesh(geo, mat);
    outline(mesh, { opacity: 0.4, angle: 50 });
    const grp = new THREE.Group();
    grp.add(mesh);
    inner.add(grp);
    sectors.push(grp);
  }
  // blind equatorial port stubs (heating ports bring their own)
  const pg = new THREE.CylinderGeometry(0.8, 0.8, 3.0, 20);
  pg.rotateZ(Math.PI / 2);
  pg.translate(10.9, 0, 0);
  const fl = new THREE.CylinderGeometry(1.0, 1.0, 0.3, 20);
  fl.rotateZ(Math.PI / 2);
  fl.translate(12.4, 0, 0);
  for (const s of [1, 2, 3, 4, 5, 8]) {
    const a = new THREE.Mesh(pg, mat);
    const b = new THREE.Mesh(fl, M.get('dark'));
    const hold = new THREE.Group();
    hold.rotation.y = -(20 + w * s) * D2R;
    hold.add(a, b);
    sectors[s].add(hold);
  }
  return { object: outer, sectors, spread: sectors.map((o, s) => ({ object: o, offset: radial(phiSect(s), FAN) })) };
}

// ------------------------------------------------------------------ blanket: 11 rows x 40 columns = 440 modules
export const BLK_ROWS = 11;
export const BLK_COLS = 40;
export function buildBlanket(M) {
  const { outer, inner } = midplane();
  const mat = M.make('dark', { color: 0x46515b, metalness: 0.45, roughness: 0.5 });
  mat.emissive = new THREE.Color(0x000000);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const thA = 297 * D2R;
  const span = 306 * D2R;
  const per = Array.from({ length: SECT }, () => []);
  const F = [0, 0];
  const B = [0, 0];
  const Ma = [0, 0];
  const Mb = [0, 0];
  const e = 0.01;
  const midAt = (th, out) => {
    pol(SH.firstWall, th, F);
    pol(SH.vvIn, th, B);
    out[0] = (F[0] + B[0]) / 2;
    out[1] = (F[1] + B[1]) / 2;
  };
  const mods = [];
  for (let j = 0; j < BLK_ROWS; j++) {
    const th = thA + ((j + 0.5) * span) / BLK_ROWS;
    pol(SH.firstWall, th, F);
    pol(SH.vvIn, th, B);
    const nR = B[0] - F[0];
    const nY = B[1] - F[1];
    const depth = Math.hypot(nR, nY);
    midAt(th - e, Ma);
    midAt(th + e, Mb);
    let tR = Mb[0] - Ma[0];
    let tY = Mb[1] - Ma[1];
    const arc = Math.hypot(tR, tY) / (2 * e);
    const nl = depth || 1;
    const nr = nR / nl;
    const ny = nY / nl;
    const tl = Math.hypot(tR, tY) || 1;
    tR /= tl;
    tY /= tl;
    const dot = tR * nr + tY * ny;
    tR -= nr * dot;
    tY -= ny * dot;
    const tl2 = Math.hypot(tR, tY) || 1;
    tR /= tl2;
    tY /= tl2;
    const L = arc * (span / BLK_ROWS) * 0.93;
    for (let i = 0; i < BLK_COLS; i++) {
      const phiDeg = (i + 0.5) * (360 / BLK_COLS);
      const s = Math.floor(phiDeg / (360 / SECT));
      const phi = phiDeg * D2R;
      const cph = Math.cos(phi);
      const sph = Math.sin(phi);
      const Rm = (F[0] + B[0]) / 2;
      const wd = ((2 * Math.PI * Rm) / BLK_COLS) * 0.92;
      mods.push({ s, nr, ny, tR, tY, depth: depth * 0.97, L, wd, cph, sph, Rm, ym: (F[1] + B[1]) / 2 });
      per[s].push(mods.length - 1);
    }
  }
  const meshes = [];
  const m4 = new THREE.Matrix4();
  const nW = new THREE.Vector3();
  const tW = new THREE.Vector3();
  const bW = new THREE.Vector3();
  for (let s = 0; s < SECT; s++) {
    const im = new THREE.InstancedMesh(box, mat, per[s].length);
    per[s].forEach((mi, q) => {
      const d = mods[mi];
      nW.set(d.nr * d.cph, d.ny, d.nr * d.sph).multiplyScalar(d.depth);
      tW.set(d.tR * d.cph, d.tY, d.tR * d.sph).multiplyScalar(d.L);
      bW.set(-d.sph, 0, d.cph).multiplyScalar(d.wd);
      m4.makeBasis(nW, tW, bW);
      m4.setPosition(d.Rm * d.cph, d.ym, d.Rm * d.sph);
      im.setMatrixAt(q, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    inner.add(im);
    meshes.push(im);
  }
  return { object: outer, meshes, mat, count: mods.length, inner, spread: meshes.map((o, s) => ({ object: o, offset: radial(phiSect(s), FAN) })) };
}

// ------------------------------------------------------------------ divertor: 54 cassettes
export const DIV_TOP = [[4.6, -4.3], [5.1, -4.15], [5.5, -5.0], [5.95, -4.55], [6.4, -5.0], [7.4, -4.0], [8.0, -3.8]];
export const STRIKE = { inner: [5.32, -4.62], outer: [6.62, -4.78], xpoint: [5.54, -3.4] };
function cassetteShape() {
  const top = (R) => {
    for (let i = 1; i < DIV_TOP.length; i++) {
      const [r1, y1] = DIV_TOP[i];
      const [r0, y0] = DIV_TOP[i - 1];
      if (R <= r1) return y0 + ((y1 - y0) * (R - r0)) / (r1 - r0);
    }
    return DIV_TOP[DIV_TOP.length - 1][1];
  };
  const bot = [];
  const t = [0, 0];
  for (let k = 0; k <= 80; k++) {
    const th = Math.PI + (Math.PI * k) / 80;
    pol(SH.vvIn, th, t);
    if (t[0] >= 4.6 && t[0] <= 8.0) bot.push([t[0], t[1]]);
  }
  bot.sort((a, b) => a[0] - b[0]);
  const topPts = bot.map(([R, y]) => [R, Math.max(top(R), y + 0.18)]);
  const pts = [...topPts, ...bot.slice().reverse()];
  return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}
export function buildDivertor(M, seg) {
  const { outer, inner } = midplane();
  const N = I.divN.v;
  const depth = 0.6;
  const geo = new THREE.ExtrudeGeometry(cassetteShape(), { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const mat = M.make('dark', { color: 0x3a444e, metalness: 0.6, roughness: 0.45 });
  mat.emissive = new THREE.Color(0x000000);
  const per = Array.from({ length: SECT }, () => []);
  for (let i = 0; i < N; i++) per[Math.floor(((i + 0.5) * (360 / N)) / (360 / SECT))].push(i);
  const meshes = [];
  const m4 = new THREE.Matrix4();
  for (let s = 0; s < SECT; s++) {
    const im = new THREE.InstancedMesh(geo, mat, per[s].length);
    per[s].forEach((i, q) => {
      m4.makeRotationY(-((i + 0.5) * (360 / N)) * D2R);
      im.setMatrixAt(q, m4);
    });
    im.instanceMatrix.needsUpdate = true;
    inner.add(im);
    meshes.push(im);
  }
  // strike-point rings: one arc per sector, carried by that sector's cassettes
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  ringMat.userData.noVariant = true;
  const rings = [];
  const segPer = Math.max(6, Math.round((seg + 24) / SECT));
  for (let s = 0; s < SECT; s++) {
    for (const [R, y] of [STRIKE.inner, STRIKE.outer]) {
      const geo = new THREE.TorusGeometry(R, 0.1, 8, segPer, (Math.PI * 2) / SECT);
      geo.rotateZ((s * 2 * Math.PI) / SECT);
      geo.rotateX(Math.PI / 2);
      geo.translate(0, y + 0.06, 0);
      const r = new THREE.Mesh(geo, ringMat);
      r.userData.fx = true;
      r.userData.noVariant = true;
      meshes[s].add(r);
      rings.push(r);
    }
  }
  return { object: outer, meshes, mat, ringMat, rings, count: N, spread: meshes.map((o, s) => ({ object: o, offset: radial(phiSect(s), FAN) })) };
}
