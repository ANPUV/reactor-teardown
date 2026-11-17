// tokamak/shapes.js - D-shaped poloidal cross-sections and sweeps around the vertical axis.
// Convention: world x = R cos(phi), z = R sin(phi), y up. theta = poloidal angle (0 = outboard midplane, pi/2 = top).
import * as THREE from 'three';
import { spec } from './spec.js';

const I = spec.items;
export const R0 = I.R.v;
export const A0 = I.a.v;
export const DELTA = I.delta.v;
export const Y0 = 14.5; // height of the midplane above the floor

/** A poloidal shape: { Rin, Rout, yUp, yDn, delta }. Returns [R, y] at poloidal angle th. */
export function pol(sh, th, out = [0, 0]) {
  const Rc = (sh.Rin + sh.Rout) / 2;
  const a = (sh.Rout - sh.Rin) / 2;
  const s = Math.sin(th);
  out[0] = Rc + a * Math.cos(th + sh.delta * s);
  out[1] = (s >= 0 ? sh.yUp : sh.yDn) * s;
  return out;
}
/** Shape scaled about the plasma centre (R0, 0). */
export const scaled = (sh, f) => ({
  Rin: R0 + (sh.Rin - R0) * f,
  Rout: R0 + (sh.Rout - R0) * f,
  yUp: sh.yUp * f,
  yDn: sh.yDn * f,
  delta: sh.delta,
});

// Layers (metres). Plasma boundary from spec; vessel and blanket sized to ITER's 19.4 m x 11.4 m envelope.
export const SH = {
  plasma: { Rin: R0 - A0, Rout: R0 + A0, yUp: A0 * I.kappa.v, yDn: A0 * I.kappa.v, delta: DELTA },
  firstWall: { Rin: 4.05, Rout: 8.45, yUp: 3.85, yDn: 3.85, delta: 0.36 },
  vvIn: { Rin: 3.7, Rout: 9.3, yUp: 4.6, yDn: 6.0, delta: 0.38 },
  vvOut: { Rin: 3.3, Rout: I.vvD.v / 2, yUp: 5.0, yDn: 6.4, delta: 0.38 },
};
SH.vvH = SH.vvOut.yUp + SH.vvOut.yDn;

const toXYZ = (R, y, phi, out, k) => {
  out[k] = R * Math.cos(phi);
  out[k + 1] = y;
  out[k + 2] = R * Math.sin(phi);
};

/**
 * Surface of a D-shaped section swept from phi0 to phi1. Closed in theta; closed in phi when the sweep is 2 pi.
 * UVs: u along phi (0..1 over the sweep), v along theta. Returns BufferGeometry (smooth normals).
 */
export function sweep(sh, nTh, phi0 = 0, phi1 = Math.PI * 2, nPhi = 96, { thFrom = 0, thTo = Math.PI * 2 } = {}) {
  const full = Math.abs(phi1 - phi0 - Math.PI * 2) < 1e-6;
  const closedTh = Math.abs(thTo - thFrom - Math.PI * 2) < 1e-6;
  const cols = full ? nPhi : nPhi + 1;
  const rows = closedTh ? nTh : nTh + 1;
  const pos = new Float32Array(cols * rows * 3);
  const uv = new Float32Array(cols * rows * 2);
  const tmp = [0, 0];
  for (let i = 0; i < cols; i++) {
    const phi = phi0 + ((phi1 - phi0) * i) / nPhi;
    for (let j = 0; j < rows; j++) {
      const th = thFrom + ((thTo - thFrom) * j) / nTh;
      pol(sh, th, tmp);
      const k = (i * rows + j) * 3;
      toXYZ(tmp[0], tmp[1], phi, pos, k);
      uv[(i * rows + j) * 2] = i / nPhi;
      uv[(i * rows + j) * 2 + 1] = j / nTh;
    }
  }
  const idx = [];
  const nI = full ? nPhi : nPhi;
  const nJ = closedTh ? nTh : nTh;
  for (let i = 0; i < nI; i++) {
    const i1 = full ? (i + 1) % cols : i + 1;
    for (let j = 0; j < nJ; j++) {
      const j1 = closedTh ? (j + 1) % rows : j + 1;
      const a = i * rows + j;
      const b = i1 * rows + j;
      const c = i1 * rows + j1;
      const d = i * rows + j1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat strip joining shape A to shape B at toroidal angle phi (sector end cap). */
export function cap(shA, shB, phi, nTh) {
  const pos = new Float32Array((nTh + 1) * 2 * 3);
  const a = [0, 0];
  const b = [0, 0];
  for (let j = 0; j <= nTh; j++) {
    const th = (Math.PI * 2 * j) / nTh;
    pol(shA, th, a);
    pol(shB, th, b);
    toXYZ(a[0], a[1], phi, pos, j * 6);
    toXYZ(b[0], b[1], phi, pos, j * 6 + 3);
  }
  const idx = [];
  for (let j = 0; j < nTh; j++) {
    const p = j * 2;
    idx.push(p, p + 1, p + 3, p, p + 3, p + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Concatenate non-indexed/indexed geometries that share the same attribute set (position + optional normal). */
export function merge(list) {
  let nv = 0;
  let ni = 0;
  for (const g of list) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const idx = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    const n = g.attributes.position.count;
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    else for (let i = 0; i < n; i++) idx[io++] = vo + i;
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** World position of a point on a shape at (theta, phi). */
export function at(sh, th, phi, out = new THREE.Vector3()) {
  const t = [0, 0];
  pol(sh, th, t);
  return out.set(t[0] * Math.cos(phi), t[1], t[0] * Math.sin(phi));
}

/** Toroidal field coil outline (outer boundary of the D), x = R, y = height above midplane. */
export function tfOutline(n = 120) {
  const key = [
    [2.3, 0], [2.3, -5.8], [2.9, -7.6], [4.6, -8.5], [7.2, -7.9], [9.6, -5.6], [11.0, -2.4], [11.3, 0],
    [11.0, 2.4], [9.6, 5.6], [7.2, 7.9], [4.6, 8.5], [2.9, 7.6], [2.3, 5.8],
  ].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const c = new THREE.CatmullRomCurve3(key, true, 'centripetal');
  return c.getSpacedPoints(n).slice(0, n).map((p) => [p.x, p.y]);
}
/** Offset a closed counter-clockwise polyline inwards by d(i). */
export function inset(pts, d) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    const di = typeof d === 'function' ? d(p, i) : d;
    return [p[0] + (-ty / l) * di, p[1] + (tx / l) * di];
  });
}
