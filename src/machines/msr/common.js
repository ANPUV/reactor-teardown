// msr/common.js - layout constants (metres, y up, ground at y = 0) and small helpers shared by the geometry files.
import * as THREE from 'three';
import { spec } from './spec.js';

const S = spec.items;
export const G = {
  // reactor vessel (axis = y axis)
  ri: S.vesselID.v / 2, // 3.4
  wall: 0.2,
  domeB: 0.8,
  cylY0: 4.6, // start of cylindrical section
  cylY1: 9.1,
  coreR: S.coreDiameter.v / 2, // 2.2
  coreH: S.coreHeight.v, // 4.0
  coreY0: 4.7,
  pitch: S.elementWidth.v / 100, // 0.10
  centralR: S.centralZoneD.v / 2, // 1.45
  reflR: 2.62,
  topY: 9.9,
  botY: 3.8,
  outY: 8.95, // outlet nozzles (above the core top plenum)
  inY: 8.2, // inlet nozzles (feed the downcomer)
  saltTop: 9.1,
  saltBot: 3.9,
  rodHole: 0.7, // rod channels at (±0.7, ±0.7)
  rodLen: 4.2,
  driveTop: 14.2,
  // loops
  pumpR: 6.9,
  hxR: 10.8,
  ringR: 13,
  ringHotY: 9.2,
  ringColdY: 2.6,
  // drain
  tankY: 1.35,
  tankR: 1.3,
  tankL: 10.0,
  // plant
  sgX: 21,
  turbZ: -14,
};
G.coreY1 = G.coreY0 + G.coreH; // 8.7
G.coreMid = G.coreY0 + G.coreH / 2;
G.rodTip = (x) => G.coreY0 + 0.1 + x * G.coreH;

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const PHI = [45, 135, 225, 315].map((d) => (d * Math.PI) / 180);
/** loop-local (r radial, t tangential, y) -> world */
export const L = (k, r, t, y) => V(r * Math.cos(PHI[k]) - t * Math.sin(PHI[k]), y, r * Math.sin(PHI[k]) + t * Math.cos(PHI[k]));
export const radial = (k) => [Math.cos(PHI[k]), 0, Math.sin(PHI[k])];

const cA = new THREE.Color(0x4a2a24);
const cB = new THREE.Color(0xe8591a);
/** Fuel-salt colour from temperature: a dull brown near the freezing point, red-orange glow at 700 degC. */
export function saltColor(T, out = new THREE.Color()) {
  const t = Math.min(1, Math.max(0, (T - 450) / 290));
  return out.copy(cA).lerp(cB, t * t * (3 - 2 * t));
}
const pFuelA = new THREE.Color(0xf97316);
const pFuelB = new THREE.Color(0xdc2626);
const pCoolA = new THREE.Color(0x7c3aed);
const pCoolB = new THREE.Color(0x5b21b6);
/** Flow-particle palettes: bright, saturated, readable on white. */
export const fuelParticle = (T, out = new THREE.Color()) => out.copy(pFuelA).lerp(pFuelB, Math.min(1, Math.max(0, (T - 540) / 170)));
export const coolantParticle = (T, out = new THREE.Color()) => out.copy(pCoolA).lerp(pCoolB, Math.min(1, Math.max(0, (T - 440) / 190)));
export const STEAM_COL = new THREE.Color(0x374151);
export const WATER_COL = new THREE.Color(0x2563eb);
export const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Emissive salt material that we recolour per frame (change the ORIGINAL; the stage syncs variants). */
export function saltMaterial(M, opacity = 0.7) {
  const m = M.make('salt', { color: 0xe8591a, opacity, emissive: 0xe8591a, emissiveIntensity: 0.55, roughness: 0.5 });
  m.userData.saltBase = true;
  return m;
}
export function paintSalt(mat, T, glow = 0.55, out = new THREE.Color()) {
  saltColor(T, out);
  mat.color.copy(out);
  mat.emissive.copy(out);
  mat.emissiveIntensity = glow;
}
export const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
};
export const cyl = (r0, r1, h, mat, seg = 24, x = 0, y = 0, z = 0) => mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat, x, y, z);

/**
 * Draw-call saver: bakes the static plain meshes under `root` into one mesh per material (positions, normals, uvs).
 * Skips instanced meshes, anything with children (outlines), userData.keep, and whole subtrees flagged userData.noBake.
 */
export function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const victims = [];
  const walk = (o) => {
    for (const c of [...o.children]) {
      if (c.userData.noBake) continue;
      if (c.isMesh && !c.isInstancedMesh && !c.userData.keep && c.children.length === 0 && c.geometry && !Array.isArray(c.material)) {
        const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
        if (!byMat.has(c.material)) byMat.set(c.material, []);
        byMat.get(c.material).push(g);
        victims.push(c);
      } else if (!c.isMesh && !c.isPoints && !c.isLine) walk(c);
    }
  };
  walk(root);
  for (const v of victims) v.parent.remove(v);
  for (const [mat, list] of byMat) {
    const n = list.reduce((a, g) => a + g.attributes.position.count, 0);
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of list) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += c;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    root.add(new THREE.Mesh(geo, mat));
  }
  return root;
}
