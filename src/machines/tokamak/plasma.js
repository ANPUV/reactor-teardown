// tokamak/plasma.js - the plasma body: nested D-shaped shells (alpha-blended, rim-lit, with streaky turbulence),
// divertor legs and helical field-line particles. Everything is driven by live state.
import * as THREE from 'three';
import { clamp } from '../../kit/util.js';
import { spec } from './spec.js';
import { R0, A0, DELTA, SH, scaled, sweep } from './shapes.js';
import { sprite } from './fx.js';

const I = spec.items;
const KAPPA = I.kappa.v;

function noiseTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(150,150,150)';
  g.fillRect(0, 0, 256, 128);
  let s = 7;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 260; i++) {
    const x = r() * 256;
    const y = r() * 128;
    const len = 20 + r() * 70;
    const w = 2 + r() * 7;
    const v = Math.floor(70 + r() * 185);
    g.fillStyle = `rgba(${v},${v},${v},0.5)`;
    for (const dx of [-256, 0, 256]) g.fillRect(x + dx, y, len, w);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  return t;
}

export function buildPlasma(M, detail) {
  const group = new THREE.Group();
  const nTh = detail >= 0.9 ? 32 : detail >= 0.5 ? 24 : 18;
  const nPhi = detail >= 0.9 ? 96 : detail >= 0.5 ? 72 : 48;
  const tex = noiseTexture();
  const shared = { uS: { value: 1 }, uT: { value: 0 }, uTurb: { value: 0.03 } };
  const base = new THREE.Color(M.COLORS.plasma);
  const white = new THREE.Color(0xffffff);

  const mk = (color, b, g, p) => {
    const own = { uBase: { value: b }, uGain: { value: g }, uPow: { value: p } };
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, alphaMap: tex });
    m.userData.noVariant = true;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, shared, own);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uS; uniform float uT; uniform float uTurb; varying vec3 vN; varying vec3 vV;')
        .replace(
          '#include <begin_vertex>',
          `float rr = length(position.xz);
           vec2 dir = position.xz / max(rr, 1e-4);
           float off = rr - ${R0.toFixed(3)};
           float ph = atan(position.z, position.x);
           float wob = 1.0 + uTurb * (0.5 * sin(7.0 * ph + uT * 1.3 + position.y * 1.5) + 0.5 * sin(13.0 * ph - uT * 0.9 + position.y * 2.3));
           float rn = ${R0.toFixed(3)} + off * uS * wob;
           vec3 transformed = vec3(dir.x * rn, position.y * uS * wob, dir.y * rn);`
        )
        .replace('#include <project_vertex>', '#include <project_vertex>\nvV = -mvPosition.xyz; vN = normalMatrix * normal;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uBase; uniform float uGain; uniform float uPow; varying vec3 vN; varying vec3 vV;')
        .replace('#include <opaque_fragment>', 'float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));\n diffuseColor.a *= uBase + uGain * pow(rim, uPow);\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'tokamak-plasma-v2';
    return m;
  };
  const shells = [
    { mat: mk(base.clone(), 0.1, 1.1, 2.0), s: 1.0 },
    { mat: mk(base.clone().lerp(white, 0.35), 0.06, 0.6, 1.8), s: 0.78 },
    { mat: mk(base.clone().lerp(white, 0.7), 0.1, 0.25, 1.4), s: 0.5 },
  ];
  for (const sh of shells) {
    const mesh = new THREE.Mesh(sweep(scaled(SH.plasma, sh.s), nTh, 0, Math.PI * 2, nPhi), sh.mat);
    mesh.userData.fx = true;
    mesh.userData.noVariant = true;
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  // alpha-blended divertor legs (the cooler, brighter pink at the bottom)
  const legMat = new THREE.MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  legMat.userData.noVariant = true;
  const X = [5.54, -3.4];
  const legs = [[5.32, -4.62], [6.62, -4.78]].map(([r, y]) => {
    const prof = [[X[0] - 0.05, X[1]], [r - 0.06, y], [r + 0.06, y], [X[0] + 0.05, X[1]]].map(([a, b]) => new THREE.Vector2(a, b));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, nPhi), legMat);
    m.userData.fx = true;
    m.userData.noVariant = true;
    m.renderOrder = 4;
    group.add(m);
    return m;
  });

  // helical field lines: particles on flux surfaces, pitch from q, speed from T
  const NP = detail >= 0.9 ? 420 : detail >= 0.5 ? 280 : 160;
  const pos = new Float32Array(NP * 3);
  const col = new Float32Array(NP * 3);
  const rho = new Float32Array(NP);
  const th = new Float32Array(NP);
  const ph = new Float32Array(NP);
  const pc = base.clone().lerp(new THREE.Color(M.COLORS.ink), 0.2);
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < NP; i++) {
    rho[i] = 0.2 + 0.8 * Math.sqrt(rnd());
    th[i] = rnd() * Math.PI * 2;
    ph[i] = rnd() * Math.PI * 2;
    const k = 0.75 + 0.25 * rho[i];
    col[i * 3] = pc.r * k;
    col[i * 3 + 1] = pc.g * k;
    col[i * 3 + 2] = pc.b * k;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pmat = new THREE.PointsMaterial({ size: 7, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: false, map: sprite(), alphaTest: 0.02 });
  const pts = new THREE.Points(geo, pmat);
  pts.frustumCulled = false;
  pts.userData.fx = true;
  group.add(pts);

  const a = A0;
  const ky = A0 * KAPPA;
  let t = 0;
  let flick = 1;
  const color = new THREE.Color();
  function update(s, dt) {
    t += dt;
    const on = s.plasma;
    const ramp = clamp(s.ipFrac, 0, 1.15);
    const brk = s.breakFrac;
    const age = clamp(1 - s.quench, 0, 1); // 0 at the start of a disruption
    const disrupting = s.phase === 'disruption';
    // size: grows with the current; spreads onto the wall when it disrupts
    let size = on ? 0.3 + 0.7 * Math.sqrt(clamp(ramp, 0, 1)) : 0.04 + 0.14 * brk;
    if (disrupting) size = Math.min(1.22, size + 0.25 * clamp(age * 8, 0, 1));
    // brightness from n and T
    const nT = s.n * s.T;
    let b = on ? 0.2 + 0.8 * clamp(Math.sqrt(nT / 9), 0, 1.15) : 0.7 * brk * brk;
    b *= 0.5 + 0.5 * clamp(0.3 + 3 * ramp, 0, 1);
    if (disrupting) {
      flick = 0.35 + 0.65 * Math.abs(Math.sin(t * 47 + Math.sin(t * 13) * 3));
      b = Math.max(0.2, 1.3 - age * 4) * flick * clamp(s.ipFrac * 1.3 + 0.1, 0, 1);
    }
    b += 0.9 * s.flash;
    shared.uS.value = size;
    shared.uT.value = t;
    shared.uTurb.value = disrupting ? 0.1 : 0.02 + 0.03 * clamp(s.T / 10, 0, 1.5) + 0.015 * clamp(s.fGW, 0, 1.2);
    tex.offset.x = (tex.offset.x + dt * (0.12 + 0.06 * clamp(s.T / 10, 0, 2))) % 1;
    tex.offset.y = (tex.offset.y + dt * 0.01) % 1;
    const dens = 0.35 + 0.65 * clamp(s.n / 1.2, 0, 1);
    const hot = clamp(s.T / 30, 0, 1);
    const flash = clamp(s.flash, 0, 1);
    for (let i = 0; i < 3; i++) {
      const sh = shells[i];
      sh.mat.color.copy(base).lerp(white, i * 0.12 + 0.3 * hot * (1 - i * 0.3) + 0.5 * flash);
      const k = [0.7, 0.45, 0.35 * (1 - 0.6 * clamp(s.T / 20, 0, 1))][i];
      sh.mat.opacity = clamp(b * k * (i === 0 ? dens : 1), 0, 1);
    }
    legMat.opacity = on || disrupting ? clamp(b * 0.6 * clamp(s.divHeat * 1.4, 0.15, 1), 0, 0.9) : 0;
    // field-line particles
    const on2 = (on || disrupting) && b > 0.05;
    pmat.opacity = on2 ? clamp(b * 0.8, 0, 0.95) : 0;
    if (on2) {
      const w = (1.0 + 1.6 * Math.sqrt(Math.max(s.T, 0) / 10)) * dt;
      const q95 = clamp(s.q95Visual, 1.2, 8);
      const wob = shared.uTurb.value;
      for (let i = 0; i < NP; i++) {
        const r = rho[i];
        const q = 1 + (q95 - 1) * r * r;
        ph[i] += w * (1 + 0.25 * r);
        th[i] += (w * (1 + 0.25 * r)) / q;
        const T0 = th[i];
        const R = R0 + (r * a * size * Math.cos(T0 + DELTA * Math.sin(T0))) * (1 + wob * Math.sin(7 * ph[i] + t));
        const y = r * ky * size * Math.sin(T0);
        pos[i * 3] = R * Math.cos(ph[i]);
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = R * Math.sin(ph[i]);
      }
      geo.attributes.position.needsUpdate = true;
    }
    void color;
  }
  return { object: group, update, shells, legs, uniforms: shared };
}
