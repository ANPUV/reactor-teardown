// kit/util.js - small helpers shared by shell, kit and machines.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Deterministic RNG (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}

/** Format a number for display: fixed decimals, unicode minus, thin-space thousands. */
export function fmt(v, d = 0) {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '-∞';
  const s = Math.abs(v).toFixed(d);
  const [i, f] = s.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const out = f ? g + '.' + f : g;
  return v < 0 && Number(s) !== 0 ? '−' + out : out;
}
/**
 * Format a spec item value with the precision it was written with: item.decimals if set, else the decimals in the
 * source number (max 3 below 10, max 1 from 10 to 100, none from 100 up). Tiny values use scientific notation.
 */
export function fmtSpec(it) {
  const v = it.v;
  if (typeof v !== 'number') return String(v);
  if (v !== 0 && Math.abs(v) < 0.01) return fmtSci(v, 1);
  const dec = (String(v).split('.')[1] || '').length;
  const a = Math.abs(v);
  const d = it.decimals !== undefined ? it.decimals : a >= 100 ? 0 : a >= 10 ? Math.min(dec, 1) : Math.min(dec, 3);
  return fmt(v, d);
}
/** Scientific notation, e.g. 1.06e20 -> "1.06 × 10^20". */
export function fmtSci(v, d = 2) {
  if (!Number.isFinite(v) || v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  const m = v / Math.pow(10, e);
  return `${m.toFixed(d)}×10${sup(e)}`;
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
export const sup = (n) => String(n).split('').map((c) => SUP[c] || c).join('');

/** Tiny DOM builder: h('div.cls#id', {attr:..., on:{click}}, children...) */
export function h(tag, attrs, ...kids) {
  const m = /^([a-z0-9-]+)((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  const rest = m[2] || '';
  rest.replace(/([.#])([\w-]+)/g, (_, k, v) => {
    if (k === '.') el.classList.add(v);
    else el.id = v;
    return '';
  });
  if (attrs && typeof attrs === 'object' && !(attrs instanceof Node) && !Array.isArray(attrs)) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (attrs !== undefined) kids.unshift(attrs);
  for (const k of kids.flat()) {
    if (k === undefined || k === null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};

// ---------- three.js helpers used by machines ----------

/** Line-of-sight outline: ink edges for pale parts (rule 6). Returns the LineSegments added as a child. */
export function outline(mesh, { color = 0x14202b, opacity = 0.35, angle = 35 } = {}) {
  const g = new THREE.EdgesGeometry(mesh.geometry, angle);
  const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  const l = new THREE.LineSegments(g, m);
  l.userData.fx = false;
  l.userData.outline = true;
  mesh.add(l);
  return l;
}

/** Place a cylinder-like pipe along a polyline (CatmullRom tube). Returns Mesh. */
export function pipe(points, radius, material, { segments = 64, radial = 14, tension = 0.3, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(...p))), closed, 'catmullrom', tension);
  const geo = new THREE.TubeGeometry(curve, segments, radius, radial, closed);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.curve = curve;
  return mesh;
}

/** Lathe from [r,y] profile pairs. */
export function lathe(profile, material, segments = 64, { phiStart = 0, phiLength = Math.PI * 2 } = {}) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, segments, phiStart, phiLength), material);
}

/** Cylinder spanning two points. */
export function cylBetween(a, b, r, material, radial = 16) {
  const A = a.isVector3 ? a : new THREE.Vector3(...a);
  const B = b.isVector3 ? b : new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, radial), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/**
 * Particle stream along closed or open polylines (coolant flow, steam, salt, sodium...).
 * paths: array of {points:[[x,y,z],...], count, loop:true}. The path is resampled to `res` points.
 * Returns {object (THREE.Points), update(dt, speed, colorFn?)}.
 * speed is metres per second along the path. colorFn(pathIndex, u 0..1) -> THREE.Color (called every frame, keep it cheap).
 */
export function createFlow(paths, { size = 0.3, color = 0xffffff, opacity = 0.9, res = 160 } = {}) {
  const items = [];
  let total = 0;
  for (const p of paths) {
    const curve = new THREE.CatmullRomCurve3(p.points.map((q) => new THREE.Vector3(...q)), !!p.loop, 'catmullrom', 0.2);
    const n = p.count || 60;
    const samples = curve.getSpacedPoints(res);
    items.push({ curve, samples, n, len: curve.getLength(), offset: total, phase: Array.from({ length: n }, (_, i) => i / n), jitter: Array.from({ length: n }, (_, i) => ((i * 9301 + 49297) % 233280) / 233280 - 0.5) });
    total += n;
  }
  const pos = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, opacity, sizeAttenuation: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.fx = true;
  const tmp = new THREE.Color(color);
  function update(dt, speed = 1, colorFn) {
    items.forEach((it, pi) => {
      const du = (speed * dt) / Math.max(it.len, 1e-6);
      const S = it.samples;
      for (let i = 0; i < it.n; i++) {
        let u = it.phase[i] + du;
        u -= Math.floor(u);
        it.phase[i] = u;
        const f = u * res;
        const i0 = Math.min(res - 1, Math.floor(f));
        const t = f - i0;
        const a = S[i0];
        const b = S[i0 + 1];
        const k = (it.offset + i) * 3;
        pos[k] = a.x + (b.x - a.x) * t + it.jitter[i] * size * 0.8;
        pos[k + 1] = a.y + (b.y - a.y) * t + it.jitter[(i * 7) % it.n] * size * 0.8;
        pos[k + 2] = a.z + (b.z - a.z) * t + it.jitter[(i * 13) % it.n] * size * 0.8;
        const c = colorFn ? colorFn(pi, u) : tmp;
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
  update(0, 0);
  return { object: pts, update, material: mat };
}

/** Radial gradient sprite texture (glows, halos). */
export function glowTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Collect meshes of an object (excluding fx/outline) - used by tests/tools. */
export function meshesOf(obj) {
  const out = [];
  obj.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints) out.push(o);
  });
  return out;
}

/** True when the visitor asked for reduced motion: helpers drop decorative drift and pulses but keep state-true poses. */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Water-vapour plume (cooling towers, steam vents). One Points object, soft grey sprites that rise, widen and fade.
 *   createPlume({ radius, height, count=480, color=0x9aa1a8, size=14, wind=[1.5,0.5] })
 *   -> { object, update(dt, intensity01, rise=1) }
 * intensity01 scales density (how many sprites are alive) and plume height (rise speed ~ sqrt(intensity)); rise is a
 * multiplier. The object sits at the plume origin (set object.position to the tower mouth). Never allocates per frame.
 * With reduced motion the plume keeps its state-true height and density but does not drift or evolve.
 */
export function createPlume({ radius = 10, height = 60, count = 480, color = 0x9aa1a8, size = 14, wind = [1.5, 0.5] } = {}) {
  const pos = new Float32Array(count * 3);
  const age = new Float32Array(count);
  const seed = new Float32Array(count * 2);
  const ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    ph[i] = i / count;
    seed[i * 2] = Math.sin(i * 12.9898) * 43758.5453 % 1;
    seed[i * 2 + 1] = Math.sin(i * 78.233) * 12345.678 % 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('age', new THREE.BufferAttribute(age, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uScale: { value: 400 } },
    vertexShader: `attribute float age; uniform float uSize; uniform float uScale; varying float vA;
      void main(){ vA = age; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = age < 0.0 ? 0.0 : uSize * (0.45 + 2.6 * age) * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d) * 4.0; if (r > 1.0) discard; float a = (1.0 - r) * (1.0 - r) * 0.32 * smoothstep(0.0, 0.08, vA) * (1.0 - vA); gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.userData.fx = true;
  pts.userData.noVariant = true;
  pts.onBeforeRender = (renderer, scene, camera) => {
    mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  };
  const still = reducedMotion();
  let clock = 0;
  const api = {
    object: pts,
    update(dt, intensity = 1, rise = 1) {
      const I = Math.max(0, Math.min(1, intensity));
      const speedUp = Math.sqrt(I) * rise;
      const alive = Math.floor(count * Math.min(1, I * 1.15 + (I > 0.003 ? 0.04 : 0)));
      if (!still) clock += dt;
      const life = 1; // phase units per cycle
      for (let i = 0; i < count; i++) {
        if (i >= alive) {
          age[i] = -1;
          continue;
        }
        let u = still ? ph[i] : (ph[i] + clock * 0.06 * Math.max(0.15, speedUp)) % life;
        if (u < 0) u += 1;
        age[i] = u;
        const h = u * height * (0.15 + 0.85 * speedUp);
        const spread = radius * (0.35 + 1.4 * u) ;
        pos[i * 3] = seed[i * 2] * spread + (still ? 0 : wind[0] * u * u * height * 0.25);
        pos[i * 3 + 1] = h;
        pos[i * 3 + 2] = seed[i * 2 + 1] * spread + (still ? 0 : wind[1] * u * u * height * 0.25);
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.age.needsUpdate = true;
    },
  };
  api.update(0, 1);
  return api;
}

/**
 * Draw-call saver: merge every plain Mesh under `group` that shares a material into ONE mesh (positions baked
 * relative to `group`). Skips InstancedMesh, Points, Lines and any subtree flagged `userData.keepSeparate`
 * (animated sub-groups, scaled water volumes...). Call it on a static group right after building it.
 * Returns the group. Merged meshes are no longer individually addressable.
 */
export function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const dead = [];
  const visit = (o) => {
    if (o !== group && o.userData.keepSeparate) return;
    for (const c of o.children) visit(c);
    if (o !== group && o.isMesh && !o.isInstancedMesh && o.geometry && !Array.isArray(o.material) && !o.userData.fx && o.children.every((k) => !k.isMesh)) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const key = o.material.uuid;
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [] });
      buckets.get(key).geos.push(g);
      dead.push(o);
    }
  };
  visit(group);
  for (const o of dead) o.parent.remove(o);
  for (const { mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (merged) group.add(new THREE.Mesh(merged, mat));
  }
  return group;
}
