// tokamak/fx.js - heating hardware, pellet injector, heat-extraction concept and every moving particle system.
// All motion is driven by live state; update(state, dt) is a pure reader (dt = 0 while paused).
import * as THREE from 'three';
import { clamp, cylBetween, outline, glowTexture } from '../../kit/util.js';
import { spec } from './spec.js';
import { R0, A0, Y0, SH, DELTA, at } from './shapes.js';
import { TF_N, phiTF, SECT, phiSect, PF } from './structures.js';

const I = spec.items;
const D2R = Math.PI / 180;

// identity colours of the design system, in order (used for the heating channels)
export const ID = { pink: 0xdb2777, rust: 0xc2410c, violet: 0x7c3aed, blue: 0x2563eb, green: 0x059669 };

let spriteTex = null;
/** Round soft sprite shared by every particle system. */
export function sprite() {
  if (!spriteTex) spriteTex = glowTexture(32);
  return spriteTex;
}
/** One Points object with n particles; `size` is a legacy world size converted to a pixel size so dots stay readable at any zoom. Returns { pts, pos, col, geo, mat }. */
export function makePoints(n, size, color, opacity = 0.95, hidden = false) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = Y0; // inside the machine, so bounding boxes stay sane; drawRange hides unused slots
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: Math.max(7, size * 11), vertexColors: true, transparent: true, opacity, depthWrite: false, sizeAttenuation: false, map: sprite(), alphaTest: 0.02 });
  if (hidden) geo.setDrawRange(0, 0);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.fx = true;
  return { pts, pos, col, geo, mat };
}
const put = (P, i, x, y, z) => {
  P.pos[i * 3] = x;
  P.pos[i * 3 + 1] = y;
  P.pos[i * 3 + 2] = z;
};

// ------------------------------------------------------------------ coil current pulses and cryogenic helium
export function tfFlow(M, tf) {
  const nC = 8;
  const nH = 4;
  const per = nC + nH;
  const P = makePoints(TF_N * per, 0.68, 0xdff0ff);
  const he = new THREE.Color(0xffd9a8);
  const L = tf.mid.length;
  const u = new Float32Array(TF_N * per);
  for (let i = 0; i < u.length; i++) u[i] = ((i % per) % nC) / nC + ((i % per) >= nC ? 0.1 * (i % per) : 0);
  for (let k = 0; k < TF_N; k++) for (let j = nC; j < per; j++) {
    const i = k * per + j;
    P.col[i * 3] = he.r;
    P.col[i * 3 + 1] = he.g;
    P.col[i * 3 + 2] = he.b;
  }
  const seg = tf.mid.map((p, i) => {
    const q = tf.mid[(i + 1) % L];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const len = seg.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (let i = 0; i < L; i++) cum.push(cum[i] + seg[i]);
  const sample = (uu, out) => {
    const d = (uu - Math.floor(uu)) * len;
    let lo = 0;
    let hi = L;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cum[m] <= d) lo = m;
      else hi = m;
    }
    const f = (d - cum[lo]) / (seg[lo] || 1);
    const a = tf.mid[lo];
    const b = tf.mid[(lo + 1) % L];
    out[0] = a[0] + (b[0] - a[0]) * f;
    out[1] = a[1] + (b[1] - a[1]) * f;
  };
  const tmp = [0, 0];
  const cs = Array.from({ length: TF_N }, (_, k) => [Math.cos(phiTF(k)), Math.sin(phiTF(k))]);
  function update(s, dt) {
    const e = clamp(s.tf, 0, 1);
    if (e <= 0.03) {
      P.mat.opacity = 0;
      return;
    }
    P.mat.opacity = 0.35 + 0.6 * e;
    const vc = (7 * e * dt) / len;
    const vh = (1.6 * dt) / len;
    for (let k = 0; k < TF_N; k++) {
      const c = tf.coils[k].position;
      for (let j = 0; j < per; j++) {
        const i = k * per + j;
        u[i] += j < nC ? vc : -vh;
        sample(u[i], tmp);
        put(P, i, tmp[0] * cs[k][0] + c.x, tmp[1] + Y0 + c.y, tmp[0] * cs[k][1] + c.z);
      }
    }
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: P.pts, update };
}

export function csFlow(M, cs) {
  const per = 8;
  const n = I.csN.v;
  const P = makePoints(n * per, 0.60, 0xdff0ff);
  const ang = new Float32Array(n * per);
  const hy = new Float32Array(n * per);
  for (let i = 0; i < n * per; i++) {
    ang[i] = (i % per) * ((Math.PI * 2) / per) + Math.floor(i / per);
    hy[i] = 0.25 + 0.5 * (((i * 37) % 11) / 11);
  }
  function update(s, dt) {
    const e = clamp(s.cs, 0, 1);
    if (e <= 0.03) {
      P.mat.opacity = 0;
      return;
    }
    P.mat.opacity = 0.4 + 0.55 * e;
    const w = (0.2 + 1.8 * e) * dt;
    for (let k = 0; k < n; k++) {
      const y = cs.mods[k].position.y + Y0;
      for (let j = 0; j < per; j++) {
        const i = k * per + j;
        ang[i] += w;
        put(P, i, 2.04 * Math.cos(ang[i]), y + hy[i] * cs.h, 2.04 * Math.sin(ang[i]));
      }
    }
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: P.pts, update };
}

export function pfFlow(M, pf) {
  const per = 12;
  const P = makePoints(PF.length * per, 0.60, 0xdff0ff);
  const ang = new Float32Array(PF.length * per);
  for (let i = 0; i < ang.length; i++) ang[i] = (i % per) * ((Math.PI * 2) / per);
  function update(s, dt) {
    const e = clamp(s.pf, 0, 1);
    if (e <= 0.03) {
      P.mat.opacity = 0;
      return;
    }
    P.mat.opacity = 0.4 + 0.55 * e;
    const w = (0.2 + 1.4 * e) * dt;
    PF.forEach((c, k) => {
      const y = pf.rings[k].position.y + Y0;
      for (let j = 0; j < per; j++) {
        const i = k * per + j;
        ang[i] += w;
        put(P, i, (c.R + c.w / 2 + 0.05) * Math.cos(ang[i]), y, (c.R + c.w / 2 + 0.05) * Math.sin(ang[i]));
      }
    });
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: P.pts, update };
}

// ------------------------------------------------------------------ neutrons and wall flashes (in the blanket part)
export function neutrons(M, blanket, plasma) {
  const N = 110;
  const S = 48;
  const P = makePoints(N, 0.63, M.COLORS.ink, 0.95, true);
  const SP = makePoints(S, 1.65, M.COLORS.hot, 0.95, true);
  const sx = new Float32Array(N * 3);
  const ex = new Float32Array(N * 3);
  const age = new Float32Array(N).fill(-1);
  const dur = new Float32Array(N);
  const sage = new Float32Array(S).fill(-1);
  const sx2 = new Float32Array(S * 3);
  const hot = new THREE.Color(M.COLORS.hot);
  const pale = new THREE.Color(M.COLORS.steam);
  let acc = 0;
  let seed = 5;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let sparkI = 0;
  const v = new THREE.Vector3();
  const thA = 297 * D2R;
  const span = 306 * D2R;
  function spawn(size) {
    let i = 0;
    while (i < N && age[i] >= 0) i++;
    if (i === N) return;
    const th0 = rnd() * Math.PI * 2;
    const rr = 0.55 * Math.sqrt(rnd()) * size;
    const ph0 = rnd() * Math.PI * 2;
    const pR = R0 + rr * A0 * Math.cos(th0 + DELTA * Math.sin(th0));
    const pY = rr * SH.plasma.yUp * Math.sin(th0);
    sx[i * 3] = pR * Math.cos(ph0);
    sx[i * 3 + 1] = pY + Y0;
    sx[i * 3 + 2] = pR * Math.sin(ph0);
    const thT = thA + rnd() * span;
    const phT = ph0 + (rnd() - 0.5) * 0.35;
    at(SH.firstWall, thT, phT, v);
    const s = ((Math.floor(((phT / (Math.PI * 2)) % 1 + 1) % 1 * SECT)) + SECT) % SECT;
    const o = blanket.meshes[s].position;
    ex[i * 3] = v.x + o.x;
    ex[i * 3 + 1] = v.y + Y0 + o.y;
    ex[i * 3 + 2] = v.z + o.z;
    age[i] = 0;
    dur[i] = 0.22 + 0.05 * rnd();
  }
  function update(s, dt) {
    const on = s.pFus > 1 && s.plasma;
    if (on) acc += dt * 160 * clamp(s.pFus / I.pfus.v, 0, 2);
    const size = clamp(0.3 + 0.7 * Math.sqrt(clamp(s.ipFrac, 0, 1)), 0.3, 1);
    while (acc >= 1) {
      acc -= 1;
      spawn(size);
    }
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (age[i] < 0) continue;
      age[i] += dt;
      const f = age[i] / dur[i];
      if (f >= 1) {
        age[i] = -1;
        const q = sparkI++ % S;
        sage[q] = 0;
        sx2[q * 3] = ex[i * 3];
        sx2[q * 3 + 1] = ex[i * 3 + 1];
        sx2[q * 3 + 2] = ex[i * 3 + 2];
        continue;
      }
      put(P, k++, sx[i * 3] + (ex[i * 3] - sx[i * 3]) * f, sx[i * 3 + 1] + (ex[i * 3 + 1] - sx[i * 3 + 1]) * f, sx[i * 3 + 2] + (ex[i * 3 + 2] - sx[i * 3 + 2]) * f);
    }
    P.geo.setDrawRange(0, k);
    P.geo.attributes.position.needsUpdate = true;
    let m = 0;
    for (let q = 0; q < S; q++) {
      if (sage[q] < 0) continue;
      sage[q] += dt;
      const f = sage[q] / 0.4;
      if (f >= 1) {
        sage[q] = -1;
        continue;
      }
      const kk = f * f;
      put(SP, m, sx2[q * 3], sx2[q * 3 + 1], sx2[q * 3 + 2]);
      SP.col[m * 3] = hot.r + (pale.r - hot.r) * kk;
      SP.col[m * 3 + 1] = hot.g + (pale.g - hot.g) * kk;
      SP.col[m * 3 + 2] = hot.b + (pale.b - hot.b) * kk;
      m++;
    }
    SP.geo.setDrawRange(0, m);
    SP.geo.attributes.position.needsUpdate = true;
    SP.geo.attributes.color.needsUpdate = true;
  }
  return { objects: [P.pts, SP.pts], update };
}

// ------------------------------------------------------------------ neutral beam injector
const NBI_PHI_T = 0.3 * D2R;
const NBI_RT = 5.3;
const nbiP = (s, out = new THREE.Vector3()) => out.set(NBI_RT * Math.cos(NBI_PHI_T) - s * Math.sin(NBI_PHI_T), 0, NBI_RT * Math.sin(NBI_PHI_T) + s * Math.cos(NBI_PHI_T));
export function buildNBI(M) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = Y0;
  g.add(inner);
  const steel = M.make('stainless', { color: 0x7d8a96 });
  const duct = cylBetween(nbiP(-17), nbiP(-8.0), 0.9, steel, 24);
  outline(duct, { opacity: 0.35 });
  inner.add(duct);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.4, 3.6), M.make('steel', { color: 0x5a6672 }));
  const c = nbiP(-17.9);
  box.position.copy(c);
  box.rotation.y = -NBI_PHI_T;
  outline(box, { opacity: 0.5 });
  inner.add(box);
  const flange = cylBetween(nbiP(-14.0), nbiP(-13.2), 1.25, M.make('steel', { color: 0x4b5560 }), 24);
  inner.add(flange);

  const N = 48;
  const P = makePoints(N, 0.68, ID.blue, 0.95, true);
  inner.add(P.pts);
  P.pts.position.y = 0;
  const u = new Float32Array(N);
  for (let i = 0; i < N; i++) u[i] = i / N;
  const s0 = -13.5;
  const s1 = 6.5;
  const tmp = new THREE.Vector3();
  function update(s, dt) {
    const frac = clamp(s.pNBI / I.pnbi.v, 0, 1.2);
    const n = Math.round(N * clamp(frac, 0, 1));
    P.mat.opacity = n > 0 ? 0.95 : 0;
    if (!n) return;
    P.geo.setDrawRange(0, n);
    for (let i = 0; i < n; i++) {
      u[i] = (u[i] + (dt * 26) / (s1 - s0)) % 1;
      nbiP(s0 + u[i] * (s1 - s0), tmp);
      put(P, i, tmp.x - (i % 2 ? 0.22 : -0.22) * Math.sin(NBI_PHI_T), 0 + ((i % 3) - 1) * 0.12, tmp.z + (i % 2 ? 0.22 : -0.22) * Math.cos(NBI_PHI_T));
    }
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: g, update };
}

// ------------------------------------------------------------------ electron cyclotron launcher (upper port) and ion cyclotron antenna
const EC_PHI = 340 * D2R;
const EC_R = 6.0;
export function buildECRH(M) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = Y0;
  g.add(inner);
  const cph = Math.cos(EC_PHI);
  const sph = Math.sin(EC_PHI);
  const tube = cylBetween([EC_R * cph, 4.7, EC_R * sph], [EC_R * cph, 12.6, EC_R * sph], 0.55, M.make('stainless', { color: 0x7d8a96 }), 20);
  outline(tube, { opacity: 0.35 });
  inner.add(tube);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.5, 2.0), M.make('steel', { color: 0x5a6672 }));
  box.position.set(EC_R * cph, 13.35, EC_R * sph);
  box.rotation.y = -EC_PHI;
  outline(box, { opacity: 0.5 });
  inner.add(box);
  const targets = [[6.0, 0.3, 0], [6.6, 0.5, 0.35], [5.5, 0.7, -0.35]];
  const per = 8;
  const N = targets.length * per;
  const P = makePoints(N, 0.42, ID.violet, 0.95, true);
  inner.add(P.pts);
  const u = new Float32Array(N);
  for (let i = 0; i < N; i++) u[i] = (i % per) / per;
  const tang = [-sph, cph];
  function update(s, dt) {
    const frac = clamp(s.pEC / I.pec.v, 0, 1.2);
    const n = Math.round(per * clamp(frac, 0, 1));
    P.mat.opacity = n > 0 ? 0.95 : 0;
    if (!n) return;
    let k = 0;
    for (let r = 0; r < targets.length; r++) {
      const tg = targets[r];
      const tr = tg[0];
      const ty = tg[1];
      const tt = tg[2];
      for (let j = 0; j < per; j++) {
        const i = r * per + j;
        u[i] = (u[i] + dt * 1.5) % 1;
        if (j >= n) continue;
        const f = u[i];
        const R = EC_R + (tr - EC_R) * f;
        const y = 3.9 + (ty - 3.9) * f;
        const t = tt * f;
        put(P, k++, R * cph + tang[0] * t, y, R * sph + tang[1] * t);
      }
    }
    P.geo.setDrawRange(0, k);
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: g, update };
}

const IC_PHI = 260 * D2R;
export function buildICRH(M) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = Y0;
  g.add(inner);
  const cph = Math.cos(IC_PHI);
  const sph = Math.sin(IC_PHI);
  const stub = cylBetween([9.2 * cph, 0, 9.2 * sph], [16.4 * cph, 0, 16.4 * sph], 0.8, M.make('stainless', { color: 0x7d8a96 }), 20);
  outline(stub, { opacity: 0.35 });
  inner.add(stub);
  const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 2.4), M.make('steel', { color: 0x5a6672 }));
  box.position.set(17.7 * cph, 0, 17.7 * sph);
  box.rotation.y = -IC_PHI;
  outline(box, { opacity: 0.5 });
  inner.add(box);
  const N = 30;
  const P = makePoints(N, 0.42, ID.green, 0.95, true);
  inner.add(P.pts);
  const u = new Float32Array(N);
  for (let i = 0; i < N; i++) u[i] = i / N;
  const tang = [-sph, cph];
  function update(s, dt) {
    const frac = clamp(s.pIC / I.pic.v, 0, 1.2);
    const n = Math.round(N * clamp(frac, 0, 1));
    P.mat.opacity = n > 0 ? 0.95 : 0;
    if (!n) return;
    P.geo.setDrawRange(0, n);
    for (let i = 0; i < n; i++) {
      u[i] = (u[i] + dt * 0.9) % 1;
      const f = u[i];
      const R = 8.5 + (6.0 - 8.5) * f;
      const w = 0.55 * Math.sin(f * 18 + (i % 5)) * (1 - f * 0.4);
      put(P, i, R * cph + tang[0] * w, 0.6 * Math.sin(f * 14 + i) * 0.5, R * sph + tang[1] * w);
    }
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: g, update };
}

// ------------------------------------------------------------------ pellet injector
const PE_PHI = 20 * D2R;
const PE_A = [12.6, 6.2];
const PE_B = [7.6, 2.2];
const PE_C = [6.6, 0.8];
export function buildPellet(M) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = Y0;
  g.add(inner);
  const cph = Math.cos(PE_PHI);
  const sph = Math.sin(PE_PHI);
  const P3 = (p) => new THREE.Vector3(p[0] * cph, p[1], p[0] * sph);
  const tube = cylBetween(P3(PE_A), P3(PE_B), 0.24, M.make('stainless', { color: 0x7d8a96 }), 14);
  outline(tube, { opacity: 0.4 });
  inner.add(tube);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 1.8), M.make('steel', { color: 0x5a6672 }));
  box.position.copy(P3([13.4, 6.7]));
  box.rotation.y = -PE_PHI;
  outline(box, { opacity: 0.5 });
  inner.add(box);
  const N = 10;
  const P = makePoints(N, 0.63, M.COLORS.ink, 0.95, true);
  inner.add(P.pts);
  const age = new Float32Array(N).fill(-1);
  let acc = 0;
  function update(s, dt) {
    if (s.plasma) acc += s.pelletRate * dt;
    while (acc >= 1) {
      acc -= 1;
      for (let i = 0; i < N; i++) if (age[i] < 0) {
        age[i] = 0;
        break;
      }
    }
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (age[i] < 0) continue;
      age[i] += dt;
      const f = age[i] / 0.55;
      if (f >= 1) {
        age[i] = -1;
        continue;
      }
      const R = PE_A[0] + (PE_C[0] - PE_A[0]) * f;
      const y = PE_A[1] + (PE_C[1] - PE_A[1]) * f;
      put(P, k++, R * cph, y, R * sph);
    }
    P.geo.setDrawRange(0, k);
    P.geo.attributes.position.needsUpdate = true;
  }
  return { object: g, update };
}

// ------------------------------------------------------------------ tritium-breeding blanket heat extraction (concept)
const HX_R = 5.0;
export function buildHX(M, ctx) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = Y0;
  g.add(inner);
  const pipe = M.make('copper', { color: 0xb9743e });
  const steel = M.make('steel', { color: 0x66727d });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(HX_R, 0.25, 12, ctx.detail >= 0.5 ? 96 : 48), pipe);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 5.8;
  inner.add(ring);
  for (let s = 0; s < SECT; s++) {
    const p = phiSect(s);
    inner.add(cylBetween([HX_R * Math.cos(p), 4.85, HX_R * Math.sin(p)], [HX_R * Math.cos(p), 5.8, HX_R * Math.sin(p)], 0.13, pipe, 10));
  }
  const pOut = 238 * D2R;
  const pBack = 242 * D2R;
  const drumY = 12.0;
  const up = (p, r) => cylBetween([HX_R * Math.cos(p), 5.8, HX_R * Math.sin(p)], [HX_R * Math.cos(p), drumY - 1.2, HX_R * Math.sin(p)], r, pipe, 12);
  inner.add(up(pOut, 0.17), up(pBack, 0.17));
  const dp = (pOut + pBack) / 2;
  const tx = -Math.sin(dp);
  const tz = Math.cos(dp);
  const cx = HX_R * Math.cos(dp);
  const cz = HX_R * Math.sin(dp);
  const drum = cylBetween([cx - tx * 3, drumY, cz - tz * 3], [cx + tx * 3, drumY, cz + tz * 3], 1.25, steel, 24);
  outline(drum, { opacity: 0.5 });
  inner.add(drum);
  // coolant particles: ring loop, hot riser, return riser
  const NR = 48;
  const NU = 10;
  const P = makePoints(NR + 2 * NU, 0.45, M.COLORS.cold);
  inner.add(P.pts);
  const u = new Float32Array(NR + 2 * NU);
  for (let i = 0; i < u.length; i++) u[i] = (i % (i < NR ? NR : NU)) / (i < NR ? NR : NU);
  const c = new THREE.Color();
  function update(s, dt) {
    const h = clamp(s.blanketHeat, 0, 1.2);
    P.mat.opacity = h > 0.02 ? 0.95 : 0;
    if (h <= 0.02) return;
    const sp = dt * (0.04 + 0.35 * h);
    M.tempColor(h * 100, 0, 100, c);
    for (let i = 0; i < u.length; i++) {
      u[i] = (u[i] + sp * (i < NR ? 1 : 2.2)) % 1;
      let x;
      let y;
      let z;
      if (i < NR) {
        const a = u[i] * Math.PI * 2;
        x = HX_R * Math.cos(a);
        y = 5.8;
        z = HX_R * Math.sin(a);
      } else {
        const hot = i < NR + NU;
        const p = hot ? pOut : pBack;
        const f = hot ? u[i] : 1 - u[i];
        x = HX_R * Math.cos(p);
        z = HX_R * Math.sin(p);
        y = 5.8 + (drumY - 1.2 - 5.8) * f;
      }
      put(P, i, x, y, z);
      const k = i < NR ? 1 : i < NR + NU ? 1 : 0.4;
      P.col[i * 3] = c.r * k + (1 - k) * 0.2;
      P.col[i * 3 + 1] = c.g * k + (1 - k) * 0.4;
      P.col[i * 3 + 2] = c.b * k + (1 - k) * 0.8;
    }
    P.geo.attributes.position.needsUpdate = true;
    P.geo.attributes.color.needsUpdate = true;
  }
  return { object: g, update, points: P.pts };
}
