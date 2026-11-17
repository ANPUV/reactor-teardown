// kit/stage.js - renderer, light studio, quality tiers, orbit/zoom, fly-to, cutaway, x-ray, isolate, explode.
// One Stage instance lives for the page; machines are loaded into it with stage.load(instance).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { clamp, easeInOut, rad } from './util.js';

export const TIERS = {
  high: { name: 'high', pr: 2, shadow: 2048, hudHz: 30, detail: 1 },
  mid: { name: 'mid', pr: 1.5, shadow: 1024, hudHz: 20, detail: 0.6 },
  low: { name: 'low', pr: 1, shadow: 0, hudHz: 10, detail: 0.3 },
};
const ORDER = ['high', 'mid', 'low'];

export const DEFAULT_PRESETS = {
  iso: { az: 38, el: 24 },
  front: { az: 0, el: 6 },
  side: { az: 90, el: 6 },
  top: { az: 0, el: 80 },
};

// Patch a MeshStandardMaterial so alpha rises at silhouettes (rim): readable x-ray and glass.
function rimPatch(mat, base, gain, power) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float rimK = 1.0 - abs(dot(normalize(vViewPosition), normal));
       diffuseColor.a = clamp(${base.toFixed(3)} + ${gain.toFixed(3)} * pow(rimK, ${power.toFixed(2)}), 0.0, 1.0);
       #include <opaque_fragment>`
    );
  };
  mat.customProgramCacheKey = () => `rim${base}_${gain}_${power}`;
}

export class Stage {
  constructor(canvas, { tier = 'high', autoDrop = true, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.autoDrop = autoDrop;
    this.tierName = tier;
    this.listeners = {};
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.85;
    pm.dispose();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xc4c8cc, 0.45);
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.fill = new THREE.DirectionalLight(0xdfe9f2, 0.45);
    this.fill.position.set(-30, 20, -20);
    this.scene.add(this.hemi, this.key, this.key.target, this.fill);

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.07 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.world = new THREE.Group();
    this.scene.add(this.world);

    // view state
    this.view = { az: 38, el: 24, dist: 50, target: new THREE.Vector3() };
    this.tween = null;
    this.vel = { az: 0, el: 0 };
    this.autoFit = true;
    this.insets = { l: 0, r: 0, t: 0, b: 0 };
    this.fillFrac = 0.66;
    this.limits = { minDist: 0.3, maxDist: 400 };

    // modes
    this.mode = 'solid';
    this.explode = 0;
    this._explodeShown = 0;
    this.cut = { angle: 35, enabled: false };
    this.plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this.cutOrigin = new THREE.Vector3();
    this.focus = null;
    this.parts = new Map();
    this.inst = null;
    this.variants = new Map(); // base material -> {xray, ghost, sel}
    this.size = { w: 1, h: 1 };
    this.stats = { fps: 60, ms: 16, calls: 0, tris: 0 };
    this._slow = [];
    this._last = performance.now();
    this._raycaster = new THREE.Raycaster();
    this.presets = { ...DEFAULT_PRESETS };
    this.applyTier(tier);
    this._bindInput();
    this.resize();
  }

  on(ev, fn) {
    (this.listeners[ev] ||= []).push(fn);
  }
  emit(ev, ...a) {
    (this.listeners[ev] || []).forEach((f) => f(...a));
  }

  // ------------------------------------------------------------ tiers / size
  get tier() {
    return TIERS[this.tierName];
  }
  applyTier(name) {
    if (!TIERS[name]) return;
    this.tierName = name;
    const t = TIERS[name];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.pr));
    this.renderer.shadowMap.enabled = t.shadow > 0;
    this.key.castShadow = t.shadow > 0;
    if (t.shadow > 0) {
      this.key.shadow.mapSize.set(t.shadow, t.shadow);
      if (this.key.shadow.map) {
        this.key.shadow.map.dispose();
        this.key.shadow.map = null;
      }
    }
    this.ground.visible = t.shadow > 0;
    this._slow.length = 0;
    this.resize(true);
    this.emit('tier', name);
  }
  setInsets(i) {
    Object.assign(this.insets, i);
    this._updateViewOffset();
    if (this.autoFit) this.refit(220);
  }
  resize(force) {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (!force && w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._updateViewOffset();
    if (this.autoFit && this.parts.size) this.refit(0);
  }
  _updateViewOffset() {
    const { w, h } = this.size;
    const { l, r, t, b } = this.insets;
    const dx = (l - r) / 2;
    const dy = (t - b) / 2;
    this.camera.setViewOffset(w, h, -dx, -dy, w, h);
    this.camera.updateProjectionMatrix();
  }
  get freeRect() {
    const { w, h } = this.size;
    const { l, r, t, b } = this.insets;
    return { w: Math.max(50, w - l - r), h: Math.max(50, h - t - b) };
  }

  // ------------------------------------------------------------ machine load
  load(inst, { presets, cutOrigin, defaultView } = {}) {
    this.unload();
    this.inst = inst;
    this.world.add(inst.root);
    this.parts.clear();
    inst.root.updateMatrixWorld(true);
    for (const def of inst.parts) {
      const obj = def.object;
      const p = {
        id: def.id,
        def,
        object: obj,
        base: obj.position.clone(),
        off: new THREE.Vector3(...(def.explodeOffset || [0, 0, 0])),
        spread: (def.spread || []).map((sp) => ({ object: sp.object, base: sp.object.position.clone(), off: new THREE.Vector3(...sp.offset) })),
        meshes: [],
        box: new THREE.Box3(),
        state: '',
      };
      obj.traverse((o) => {
        if (o.isMesh || o.isPoints || o.isLine || o.isLineSegments) {
          p.meshes.push(o);
          if (!o.userData.fx && o.isMesh && !o.isInstancedMesh && !(o.material && o.material.transparent && o.material.opacity < 0.5)) {
            // only big meshes cast shadows: keeps the shadow pass cheap (draw-call budget)
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            const sc = o.getWorldScale(new THREE.Vector3());
            if (o.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) > 8) o.castShadow = true;
          }
          o.userData._mat0 = o.material;
          o.userData._cs = o.castShadow;
        }
      });
      this.parts.set(def.id, p);
    }
    this._measure();
    this.presets = { ...DEFAULT_PRESETS, ...(presets || {}) };
    this.fitIds = inst.defaultFit || null; // part ids the DEFAULT fit uses (CONTRACT: defaultFit); null = every part
    this.fitAll = false;
    this.fillFrac = inst.defaultFill || 0.66; // optional: share of the free area the default fit fills
    this.cutOrigin.set(...(cutOrigin || [0, 0, 0]));
    this._sceneRadius = this._allBox().getBoundingSphere(new THREE.Sphere()).radius;
    for (const p of this.parts.values()) {
      const sz = p.box.getSize(new THREE.Vector3());
      p.big = Math.max(sz.x, sz.z) > this._sceneRadius * 0.6;
    }
    const r = this._sceneRadius;
    this.limits = { minDist: 0.3, maxDist: Math.max(60, r * 8) };
    this.key.position.set(r * 0.25, r * 2.4, r * 0.35).add(this._allBox().getCenter(new THREE.Vector3()));
    this.key.target.position.copy(this._allBox().getCenter(new THREE.Vector3()));
    const sc = this.key.shadow.camera;
    sc.left = sc.bottom = -r * 1.25;
    sc.right = sc.top = r * 1.25;
    sc.near = 1;
    sc.far = r * 6;
    sc.updateProjectionMatrix();
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.05;
    this.ground.scale.setScalar(r * 8);
    this.ground.position.y = this._allBox().min.y - 0.02;
    this.mode = 'solid';
    this.focus = null;
    this.explode = 0;
    this._explodeShown = 0;
    this._applyExplode();
    this._applyVisuals();
    this._updateClip();
    if (defaultView) Object.assign(this.view, { az: defaultView.az ?? this.view.az, el: defaultView.el ?? this.view.el });
    this.autoFit = true;
    this.refit(0);
    this.emit('load', inst);
  }
  unload() {
    if (!this.inst) return;
    this.world.remove(this.inst.root);
    for (const p of this.parts.values()) for (const m of p.meshes) m.material = m.userData._mat0;
    this.parts.clear();
    this.inst = null;
  }
  _measure() {
    for (const p of this.parts.values()) {
      const obj = p.object;
      const prev = obj.visible;
      obj.visible = true;
      obj.position.copy(p.base);
      obj.parent && obj.parent.updateMatrixWorld(true);
      obj.updateMatrixWorld(true);
      for (const sp of p.spread) sp.object.position.copy(sp.base);
      obj.updateMatrixWorld(true);
      p.box = new THREE.Box3().setFromObject(obj);
      if (p.box.isEmpty()) p.box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
      p.samples = this._sample(p);
      obj.visible = prev;
    }
  }
  /** Sample world-space points of a part (explode 0) for tight camera fitting. [{pts:Float32Array, si:spreadIndex}] */
  _sample(p) {
    const out = [];
    const v = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const MAXP = 260;
    for (const mesh of p.meshes) {
      if (!mesh.geometry || mesh.userData.fx && mesh.isPoints) continue;
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      if (!pos) continue;
      let si = -1;
      for (let o = mesh; o; o = o.parent) {
        const k = p.spread.findIndex((sp) => sp.object === o);
        if (k >= 0) {
          si = k;
          break;
        }
        if (o === p.object) break;
      }
      const pts = [];
      const step = Math.max(1, Math.floor(pos.count / MAXP));
      const local = [];
      for (let i = 0; i < pos.count; i += step) local.push(new THREE.Vector3().fromBufferAttribute(pos, i));
      mesh.updateWorldMatrix(true, false);
      if (mesh.isInstancedMesh) {
        const cnt = mesh.count;
        const istep = Math.max(1, Math.floor(cnt / 40));
        const lstep = Math.max(1, Math.floor(local.length / 12));
        for (let k = 0; k < cnt; k += istep) {
          mesh.getMatrixAt(k, m);
          m.premultiply(mesh.matrixWorld);
          for (let i = 0; i < local.length; i += lstep) {
            v.copy(local[i]).applyMatrix4(m);
            pts.push(v.x, v.y, v.z);
          }
        }
      } else {
        for (const l of local) {
          v.copy(l).applyMatrix4(mesh.matrixWorld);
          pts.push(v.x, v.y, v.z);
        }
      }
      out.push({ pts: new Float32Array(pts), si });
    }
    if (p.def.fitPoints && p.def.fitPoints.length) out.push({ pts: new Float32Array(p.def.fitPoints.flat()), si: -1 });
    return out;
  }
  _points(list, e) {
    const out = [];
    for (const p of list) {
      for (const s of p.samples) {
        const o = p.off.clone();
        if (s.si >= 0) o.add(p.spread[s.si].off);
        o.multiplyScalar(e);
        for (let i = 0; i < s.pts.length; i += 3) out.push(new THREE.Vector3(s.pts[i] + o.x, s.pts[i + 1] + o.y, s.pts[i + 2] + o.z));
      }
    }
    return out;
  }
  /** Re-measure after a machine changed geometry (rare). */
  remeasure() {
    this._measure();
    this.refit(0);
  }
  _allBox() {
    const b = new THREE.Box3();
    for (const p of this.parts.values()) {
      if (p.def.reveal === 'isolate') continue;
      b.union(p.box);
    }
    return b;
  }

  // ------------------------------------------------------------ modes
  setMode(mode) {
    if (!['solid', 'cutaway', 'xray'].includes(mode)) return;
    this.mode = mode;
    this.cut.enabled = mode === 'cutaway';
    this._updateClip();
    this._applyVisuals();
    this.emit('mode', mode);
  }
  setCutAngle(deg) {
    this.cut.angle = ((deg % 360) + 360) % 360;
    this._updateClip();
    this.emit('cut', this.cut.angle);
  }
  _updateClip() {
    const a = rad(this.cut.angle);
    // plane through the vertical axis at cutOrigin; everything on the +normal side is kept
    // (normal points away from the camera-facing wedge so the near wedge is removed)
    const n = new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a));
    this.plane.setFromNormalAndCoplanarPoint(n, this.cutOrigin);
    const fp = this.focus && this.parts.get(this.focus);
    const off = fp && (fp.def.noCut || (fp.spread.length && !fp.def.clipIsolated));
    this.renderer.clippingPlanes = this.cut.enabled && !off ? [this.plane] : [];
    this.renderer.localClippingEnabled = true;
    this._applyLocalClip(!!off);
  }
  /** Parts that sit entirely on the kept side of the global plane can carry their own cut plane (def.cutOrigin). */
  _applyLocalClip() {
    for (const p of this.parts.values()) {
      if (!p.def.cutOrigin) continue;
      if (!p.localPlane) p.localPlane = new THREE.Plane();
      p.localPlane.setFromNormalAndCoplanarPoint(this.plane.normal, new THREE.Vector3(...p.def.cutOrigin).add(p.off.clone().multiplyScalar(this._explodeShown)));
      const on = this.cut.enabled && !(this.focus === p.id && p.def.noCut);
      const set = (m) => {
        const want = on ? [p.localPlane] : null;
        if ((m.clippingPlanes === null) !== (want === null)) m.needsUpdate = true;
        m.clippingPlanes = want;
      };
      for (const mesh of p.meshes) {
        const base = mesh.userData._mat0;
        for (const b of Array.isArray(base) ? base : [base]) {
          if (!b) continue;
          set(b);
          const v = this.variants.get(b);
          if (v) for (const k in v) set(v[k]);
        }
      }
    }
  }
  setExplode(v, immediate = false) {
    this.explode = clamp(v, 0, 1);
    if (immediate) this._explodeShown = this.explode;
    this.emit('explode', this.explode);
    if (this.autoFit) this._pendingFit = 0.12;
  }
  isolate(id) {
    if (id && !this.parts.has(id)) id = null;
    this.focus = id || null;
    this._updateClip();
    this._applyVisuals();
    this.emit('isolate', this.focus);
    if (this.focus) this.flyToPart(this.focus);
    else this.refit(500);
  }
  _applyExplode() {
    const e = this._explodeShown;
    for (const p of this.parts.values()) {
      p.object.position.copy(p.base).addScaledVector(p.off, e);
      for (const sp of p.spread) sp.object.position.copy(sp.base).addScaledVector(sp.off, e);
    }
  }
  /** Box of a part at explode value e, including per-sub-object spread. */
  _exBox(p, e) {
    const b = p.box.clone().translate(p.off.clone().multiplyScalar(e));
    for (const sp of p.spread) b.union(p.box.clone().translate(p.off.clone().add(sp.off).multiplyScalar(e)));
    return b;
  }
  partBox(id) {
    return this._exBox(this.parts.get(id), this._explodeShown);
  }

  // ------------------------------------------------------------ materials per state
  _variant(mat, kind) {
    let v = this.variants.get(mat);
    if (!v) this.variants.set(mat, (v = {}));
    if (v[kind]) return v[kind];
    let m;
    if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
      m = mat.clone();
      m.transparent = true;
      m.depthWrite = false;
      if (kind === 'xray') {
        m.opacity = 1;
        rimPatch(m, 0.09, 0.62, 1.6);
      } else if (kind === 'ghost') {
        m.opacity = 1;
        rimPatch(m, 0.02, 0.15, 2.6);
      } else if (kind === 'ghostbig') {
        m.opacity = 1;
        rimPatch(m, 0.004, 0.06, 3.2);
      } else if (kind === 'sel') {
        m = mat.clone();
        m.emissive = new THREE.Color(0xff4500);
        m.emissiveIntensity = 0.06;
      }
    } else {
      m = mat.clone();
      if (kind === 'xray') {
        m.transparent = true;
        m.opacity = mat.opacity * 0.7;
      } else if (kind === 'ghost' || kind === 'ghostbig') {
        m.transparent = true;
        m.opacity = mat.opacity * (kind === 'ghost' ? 0.08 : 0.03);
      }
    }
    m.userData._src = mat;
    v[kind] = m;
    if (mat.clippingPlanes) m.clippingPlanes = mat.clippingPlanes;
    return m;
  }
  _syncVariants() {
    for (const [src, v] of this.variants) {
      for (const k in v) {
        const m = v[k];
        if (src.color && m.color) m.color.copy(src.color);
        if (k !== 'sel' && src.emissive && m.emissive) {
          m.emissive.copy(src.emissive);
          m.emissiveIntensity = src.emissiveIntensity;
        }
        if (!m.isMeshStandardMaterial && src.opacity !== undefined) {
          m.opacity = src.opacity * (k === 'ghost' ? 0.08 : k === 'ghostbig' ? 0.03 : k === 'xray' ? 0.7 : 1);
        }
      }
    }
  }
  _applyVisuals() {
    const focus = this.focus;
    for (const p of this.parts.values()) {
      const hiddenReveal = p.def.reveal === 'isolate' && focus !== p.id;
      p.object.visible = !hiddenReveal && p.def.visible !== false;
      const ghost = !!focus && focus !== p.id;
      const multi = focus === p.id && p.spread.length && this.mode === 'cutaway' && !p.def.clipIsolated;
      const kind = ghost ? (p.big ? 'ghostbig' : 'ghost') : multi ? 'xray' : focus === p.id ? 'sel' : this.mode === 'xray' ? 'xray' : '';
      p.state = ghost ? 'ghost' : focus === p.id ? 'selected' : this.mode === 'xray' ? 'xray' : 'solid';
      for (const m of p.meshes) {
        if (m.userData.fx) m.visible = !ghost;
        m.castShadow = !!m.userData._cs && !ghost;
        const src = m.userData._mat0;
        if (!src) continue;
        if (m.userData.noVariant || !kind) {
          m.material = src;
          continue;
        }
        const pick = (s) => {
          if (kind === 'sel') return s.isMeshStandardMaterial && !s.transparent && p.def.highlight !== false && !m.isPoints && !m.isLine ? this._variant(s, 'sel') : s;
          return this._variant(s, kind);
        };
        m.material = Array.isArray(src) ? src.map(pick) : pick(src);
      }
    }
  }
  /** Machines that swap a mesh's material at runtime must call this afterwards (or set userData._mat0). */
  refreshMaterials() {
    for (const p of this.parts.values()) for (const m of p.meshes) m.userData._mat0 = m.userData._mat0 || m.material;
    this._applyVisuals();
  }

  // ------------------------------------------------------------ camera
  _dirOf(az, el) {
    const a = rad(az);
    const e = rad(el);
    return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
  }
  /**
   * Fit points into `fill` of the free canvas area. Returns {dist, target}. If `target` is given it is kept,
   * otherwise the target is re-centred so the projected bounding rectangle sits in the middle of the free area.
   */
  fitView(pts, az, el, fill, target) {
    const fixed = !!target;
    let c = target ? target.clone() : new THREE.Box3().setFromPoints(pts).getCenter(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(this.camera.fov, this.size.w / this.size.h, 0.01, 1e5);
    const dir = this._dirOf(az, el);
    const fr = this.freeRect;
    const q = new THREE.Vector3();
    const ext = (d) => {
      cam.position.copy(c).addScaledVector(dir, d);
      cam.lookAt(c);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (const p of pts) {
        q.copy(p).project(cam);
        if (q.z > 1) return null;
        x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
      }
      return { x0, x1, y0, y1 };
    };
    const fits = (d) => {
      const e = ext(d);
      if (!e) return false;
      const hx = fixed ? Math.max(Math.abs(e.x0), Math.abs(e.x1)) : (e.x1 - e.x0) / 2;
      const hy = fixed ? Math.max(Math.abs(e.y0), Math.abs(e.y1)) : (e.y1 - e.y0) / 2;
      return hx * this.size.w <= fill * fr.w && hy * this.size.h <= fill * fr.h;
    };
    let dist = 50;
    for (let iter = 0; iter < (fixed ? 1 : 3); iter++) {
      let lo = 0.2, hi = 4000;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) hi = mid; else lo = mid;
      }
      dist = hi;
      if (fixed) break;
      const e = ext(dist);
      if (!e) break;
      const mx = (e.x0 + e.x1) / 2;
      const my = (e.y0 + e.y1) / 2;
      const th = Math.tan(rad(this.camera.fov / 2));
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      c = c.clone().addScaledVector(right, mx * dist * th * cam.aspect).addScaledVector(up, my * dist * th);
    }
    return { dist, target: c };
  }
  _parts() {
    const all = [...this.parts.values()].filter((p) => p.def.reveal !== 'isolate');
    if (this.fitAll || !this.fitIds) return all;
    const sel = all.filter((p) => this.fitIds.includes(p.id));
    return sel.length ? sel : all;
  }
  refit(ms = 400) {
    if (!this.parts.size) return;
    if (this.focus) return this.flyToPart(this.focus, ms);
    const pts = this._points(this._parts(), this.explode);
    const f = this.fitView(pts, this.view.az, this.view.el, this.fillFrac);
    this.flyTo({ target: f.target, dist: f.dist }, ms);
  }
  flyToPart(id, ms = 700) {
    const p = this.parts.get(id);
    if (!p) return;
    const cam = p.def.camera || {};
    const pts = this._points([p], this.explode);
    const az = cam.az ?? this.view.az;
    const el = cam.el ?? this.view.el;
    const fixedT = cam.target ? new THREE.Vector3(...cam.target).add(p.off.clone().multiplyScalar(this.explode)) : null;
    const f = this.fitView(pts, az, el, cam.fill ?? 0.72, fixedT);
    this.autoFit = true;
    this.flyTo({ az, el, dist: cam.dist ?? f.dist, target: f.target }, ms);
  }
  /** Fly to a view {az, el, dist, target(Vector3|[x,y,z])}; any field may be omitted. */
  flyTo(v, ms = 700) {
    const to = {
      az: v.az ?? this.view.az,
      el: v.el ?? this.view.el,
      dist: v.dist ?? this.view.dist,
      target: v.target ? (v.target.isVector3 ? v.target.clone() : new THREE.Vector3(...v.target)) : this.view.target.clone(),
    };
    to.el = clamp(to.el, -10, 89);
    if (this.reducedMotion || ms <= 0) {
      this.view.az = to.az;
      this.view.el = to.el;
      this.view.dist = to.dist;
      this.view.target.copy(to.target);
      this.tween = null;
      return;
    }
    let daz = ((to.az - this.view.az + 540) % 360) - 180;
    this.tween = { t: 0, ms, from: { az: this.view.az, el: this.view.el, dist: this.view.dist, target: this.view.target.clone() }, to, daz };
  }
  preset(name, ms = 700) {
    const p = this.presets[name];
    if (!p) return;
    this.autoFit = true;
    this.fitAll = p.fit === 'all';
    const list = this.focus ? [this.parts.get(this.focus)] : this._parts();
    const pts = this._points(list, this.explode);
    const f = this.fitView(pts, p.az, p.el, this.focus ? 0.72 : this.fillFrac);
    this.flyTo({ az: p.az, el: p.el, dist: f.dist, target: f.target }, ms);
  }
  settle() {
    // finish tweens and explode easing instantly (deterministic screenshots)
    if (this.tween) {
      const t = this.tween;
      this.view.az = t.from.az + t.daz;
      this.view.el = t.to.el;
      this.view.dist = t.to.dist;
      this.view.target.copy(t.to.target);
      this.tween = null;
    }
    this._explodeShown = this.explode;
    this._applyExplode();
    this._applyLocalClip();
    if (this._pendingFit) {
      this._pendingFit = 0;
      this.refit(0);
    }
    this.vel.az = this.vel.el = 0;
  }
  resetView(ms = 0) {
    this.focus = null;
    this.fitAll = false;
    this.setMode(this.inst && this.inst.defaultMode ? this.inst.defaultMode : 'solid');
    this.setExplode(0, true);
    this.setCutAngle((this.inst && this.inst.cutAngle) ?? 35);
    this._applyVisuals();
    this.autoFit = true;
    this.view.az = (this.inst && this.inst.defaultView && this.inst.defaultView.az) ?? this.presets.iso.az;
    this.view.el = (this.inst && this.inst.defaultView && this.inst.defaultView.el) ?? this.presets.iso.el;
    this.refit(ms);
  }

  // ------------------------------------------------------------ input
  _bindInput() {
    const c = this.canvas;
    const ptrs = new Map();
    let moved = 0;
    let down = null;
    let pinch0 = 0;
    c.style.touchAction = 'none';
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, b: e.button, shift: e.shiftKey });
      moved = 0;
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      }
      this.tween = null;
      this.emit('input');
    });
    c.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 1) {
        if (p.b === 2 || p.b === 1 || p.shift) this._pan(dx, dy);
        else {
          this.vel.az = -dx * 0.35;
          this.vel.el = dy * 0.35;
          this.view.az += this.vel.az;
          this.view.el = clamp(this.view.el + this.vel.el, -10, 89);
        }
      } else if (ptrs.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch0) this._zoom(pinch0 / d);
        pinch0 = d;
        this._pan(dx / 2, dy / 2);
      }
      p.x = e.clientX;
      p.y = e.clientY;
      this.emit('input');
    });
    const up = (e) => {
      const had = ptrs.delete(e.pointerId);
      if (had && ptrs.size === 0 && down && moved < 6 && performance.now() - down.t < 450) this._click(e);
      pinch0 = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => ptrs.delete(e.pointerId));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this._zoom(Math.exp(e.deltaY * 0.0013));
        this.autoFit = false;
        this.tween = null;
        this.emit('input');
      },
      { passive: false }
    );
    c.addEventListener('dblclick', () => {
      this.autoFit = true;
      this.refit(500);
    });
  }
  _zoom(f) {
    this.view.dist = clamp(this.view.dist * f, this.limits.minDist, this.limits.maxDist);
    this.autoFit = false;
  }
  _pan(dx, dy) {
    const k = (2 * this.view.dist * Math.tan(rad(this.camera.fov / 2))) / this.size.h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.view.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.autoFit = false;
  }
  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    this._raycaster.setFromCamera(ndc, this.camera);
    const objs = [];
    for (const p of this.parts.values()) {
      if (!p.object.visible || p.state === 'ghost') continue;
      for (const m of p.meshes) if (m.isMesh && m.visible && !m.userData.fx && !(m.userData._mat0 && m.userData._mat0.opacity < 0.5 && m.userData._mat0.transparent)) objs.push(m);
    }
    const hits = this._raycaster.intersectObjects(objs, false);
    for (const h of hits) {
      if (this.cut.enabled && this.plane.distanceToPoint(h.point) < 0) continue;
      for (const p of this.parts.values()) if (p.meshes.includes(h.object)) return this.emit('pick', p.id);
    }
    this.emit('pick', null);
  }

  // ------------------------------------------------------------ frame
  frame(now = performance.now()) {
    const dt = Math.min(0.1, Math.max(0, (now - this._last) / 1000));
    const raw = now - this._last;
    this._last = now;
    // tween
    if (this.tween) {
      const t = this.tween;
      t.t += dt * 1000;
      const f = easeInOut(clamp(t.t / t.ms, 0, 1));
      this.view.az = t.from.az + t.daz * f;
      this.view.el = t.from.el + (t.to.el - t.from.el) * f;
      this.view.dist = t.from.dist + (t.to.dist - t.from.dist) * f;
      this.view.target.lerpVectors(t.from.target, t.to.target, f);
      if (t.t >= t.ms) this.tween = null;
    }
    // explode easing
    if (Math.abs(this._explodeShown - this.explode) > 1e-4) {
      this._explodeShown += (this.explode - this._explodeShown) * (1 - Math.exp(-dt * 12));
      if (Math.abs(this._explodeShown - this.explode) < 1e-3) this._explodeShown = this.explode;
      this._applyExplode();
      this._applyLocalClip();
    }
    if (this._pendingFit) {
      this._pendingFit -= dt;
      if (this._pendingFit <= 0) {
        this._pendingFit = 0;
        if (this.autoFit) this.refit(260);
      }
    }
    this._syncVariants();
    // camera
    const v = this.view;
    const dir = this._dirOf(v.az, v.el);
    this.camera.position.copy(v.target).addScaledVector(dir, v.dist);
    this.camera.near = Math.max(0.05, v.dist * 0.04);
    this.camera.far = v.dist + (this._sceneRadius || 100) * 6;
    this.camera.lookAt(v.target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    // stats / auto drop
    if (raw > 0 && raw < 400) {
      this.stats.ms += (raw - this.stats.ms) * 0.08;
      this.stats.fps = 1000 / this.stats.ms;
      this._slow.push([now, raw]);
      while (this._slow.length && now - this._slow[0][0] > 2000) this._slow.shift();
      if (this.autoDrop && this._slow.length > 30 && now - this._slow[0][0] > 1900) {
        const avg = this._slow.reduce((a, b) => a + b[1], 0) / this._slow.length;
        if (avg > 28) {
          const i = ORDER.indexOf(this.tierName);
          if (i < ORDER.length - 1) this.applyTier(ORDER[i + 1]);
        }
      }
    }
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
    return dt;
  }
}
