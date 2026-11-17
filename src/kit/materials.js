// kit/materials.js - shared palette. Mid-tone parts so nothing is lost on the pale backdrop (rule 6).
import * as THREE from 'three';

export const COLORS = {
  ink: 0x000000,
  muted: 0x666666,
  accent: 0xff4500, // Strategik signal: a mark only, never on parts
  hot: 0xdc2626, // mark-danger
  cold: 0x2563eb, // id-4
  steam: 0xa3a3a3, // decor
  plasma: 0xdb2777, // id-1
  cherenkov: 0x3fb8ff, // physical glow, not a UI colour
};

const PAL = {
  steel: { color: 0x6f7b86, metalness: 0.65, roughness: 0.42 },
  stainless: { color: 0x9aa6b0, metalness: 0.8, roughness: 0.3 },
  concrete: { color: 0x98a0a6, metalness: 0.0, roughness: 0.95 },
  zircaloy: { color: 0x8a9487, metalness: 0.55, roughness: 0.45 },
  copper: { color: 0xb9743e, metalness: 0.85, roughness: 0.35 },
  graphite: { color: 0x3a4046, metalness: 0.2, roughness: 0.7 },
  sodium: { color: 0x9aa3ad, metalness: 0.9, roughness: 0.18 },
  salt: { color: 0x5aa89c, metalness: 0.1, roughness: 0.35, transparent: true, opacity: 0.8 },
  water: { color: 0x5b9bd0, metalness: 0.0, roughness: 0.15, transparent: true, opacity: 0.45 },
  glass: { color: 0xa9bccb, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.25 },
  absorber: { color: 0x2c3138, metalness: 0.5, roughness: 0.5 },
  fuel: { color: 0x7f8f85, metalness: 0.2, roughness: 0.6 },
  paint: { color: 0x7d8a96, metalness: 0.3, roughness: 0.55 },
  dark: { color: 0x2a3138, metalness: 0.4, roughness: 0.55 },
};

/**
 * Material factory. One shared MeshStandardMaterial per palette name; call m.get('steel') for the shared one
 * or m.make('steel', {color: 0x...}) for a tinted clone you intend to animate.
 * All are DoubleSide so global clip-plane cutaways show the inner wall (CONTRACT section "Cutaway").
 */
export function createMaterials() {
  const cache = new Map();
  const base = (name, over = {}) => {
    const spec = { ...(PAL[name] || PAL.steel), ...over };
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...spec });
    if (spec.transparent) m.depthWrite = false;
    m.name = name;
    return m;
  };
  return {
    COLORS,
    names: Object.keys(PAL),
    get(name) {
      if (!cache.has(name)) cache.set(name, base(name));
      return cache.get(name);
    },
    make(name, over) {
      return base(name, over);
    },
    /** Additive glow (Cherenkov, plasma halo...). Flag meshes using it with userData.fx = true. */
    glow(color = COLORS.cherenkov, opacity = 0.3) {
      return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    },
    basic(color, opacity = 1) {
      return new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide });
    },
    /** Cold -> hot data ramp. t in 0..1. Writes into `out` (THREE.Color) and returns it. */
    ramp(t, out = new THREE.Color()) {
      return heatRamp(t, out);
    },
    /** Temperature to colour using a [tMin,tMax] window. */
    tempColor(T, tMin, tMax, out = new THREE.Color()) {
      return heatRamp((T - tMin) / (tMax - tMin), out);
    },
  };
}

const C0 = new THREE.Color(COLORS.cold);
const C1 = new THREE.Color(0x9aa0a8); // neutral mid-grey (darker than the backdrop) between cold and hot
const C2 = new THREE.Color(COLORS.hot);
export function heatRamp(t, out = new THREE.Color()) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  if (t < 0.5) return out.copy(C0).lerp(C1, t * 2);
  return out.copy(C1).lerp(C2, (t - 0.5) * 2);
}
