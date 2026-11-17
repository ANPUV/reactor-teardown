// pwr/plant.js - containment, reactor pressure vessel stack, core and the fuel drill-down.
// World units: metres, y up, vessel axis on the y axis, basemat top at y = 0.
import * as THREE from 'three';
import { lathe, outline, mergeStatic } from '../../kit/util.js';
import { spec } from './spec.js';

const S = spec.items;
export const G = {
  pitch: S.pitch.v,
  coreH: S.activeHeight.v,
  coreY0: 4.0, // bottom of active fuel
  rpvBottom: 1.5,
  rpvRi: S.rpvID.v / 2, // 2.2
  rpvRo: S.rpvID.v / 2 + S.rpvWall.v / 100,
  shellTop: 12.3,
  headBase: 12.7,
  headRise: 2.2,
  crdmTop: 19.4,
  driveTop: 19.0,
  hotY: 10.3,
  coldY: 9.6,
  contRi: S.containmentID.v / 2,
  contWall: 1.3,
  contCyl: 38,
  contDome: 15,
  rodLen: 3.8,
};
G.coreY1 = G.coreY0 + G.coreH;
G.coreMid = G.coreY0 + G.coreH / 2;
G.contRo = G.contRi + G.contWall;
G.contTop = G.contCyl + G.contDome + G.contWall;
G.drillPos = new THREE.Vector3(0, 30, 0);

/** The 193-assembly pattern (all cells with i^2 + j^2 <= 61) and the 53 RCCA cells (both indices odd, plus centre). */
export function lattice() {
  const out = [];
  for (let i = -7; i <= 7; i++)
    for (let j = -7; j <= 7; j++) {
      if (i * i + j * j > 61) continue;
      const rcc = i === 0 && j === 0 ? true : Math.abs(i) % 2 === 1 && Math.abs(j) % 2 === 1;
      out.push({ i, j, x: i * G.pitch, z: j * G.pitch, r: Math.hypot(i, j) * G.pitch, rcc });
    }
  return out;
}
export const CELLS = lattice();
export const RCC_CELLS = CELLS.filter((c) => c.rcc);
export const yDome = (r) => G.headBase + G.headRise * Math.sqrt(Math.max(0, 1 - (r / G.rpvRo) ** 2));

const ellipseArc = (cx, cy, a, b, t0, t1, n) => Array.from({ length: n + 1 }, (_, k) => {
  const t = t0 + ((t1 - t0) * k) / n;
  return [cx + a * Math.cos(t), cy + b * Math.sin(t)];
});

export function buildContainment(M, seg) {
  const { contRi: ri, contRo: ro, contCyl: H, contDome: D } = G;
  const outer = ellipseArc(0, H, ro, D + G.contWall, 0, Math.PI / 2, 24);
  const inner = ellipseArc(0, H, ri, D, Math.PI / 2, 0, 24);
  const profile = [[ri, 0], [ro, 0], [ro, H], ...outer.slice(1), ...inner, [ri, 0]];
  const wall = lathe(profile, M.make('concrete', { color: 0xaab1b7 }), seg);
  const g = new THREE.Group();
  g.add(wall);
  // construction joints (thin rings) so the shell reads as a built structure
  const ringMat = M.make('concrete', { color: 0x8e969c });
  for (const y of [9, 19, 29]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(ro + 0.02, 0.12, 6, seg), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  // equipment hatch and penetrations (steam out, feedwater in)
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.4, 32), M.get('steel'));
  hatch.rotation.z = Math.PI / 2;
  const ha = (200 * Math.PI) / 180;
  hatch.position.set(Math.cos(ha) * (ro + 0.2), 7.5, Math.sin(ha) * (ro + 0.2));
  hatch.rotation.set(0, -ha, Math.PI / 2);
  g.add(hatch);
  for (const [y, z, r] of [[27, 0, 1.1], [3, -5.5, 0.7]]) {
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.0, 24), M.get('steel'));
    pen.rotation.z = Math.PI / 2;
    pen.position.set(ro + 0.2, y, z);
    g.add(pen);
  }
  return mergeStatic(g);
}

export function buildBasemat(M, seg) {
  const g = new THREE.Group();
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(G.contRo + 2, G.contRo + 2, 3, seg), M.make('concrete', { color: 0x8a939a }));
  mat.position.y = -1.5;
  g.add(mat);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, G.rpvBottom, 40, 1, true), M.make('concrete', { color: 0x7d868d }));
  ped.position.y = G.rpvBottom / 2;
  g.add(ped);
  // lower RPV cavity floor ring
  const deck = new THREE.Mesh(new THREE.RingGeometry(3.9, G.contRi, seg), M.make('concrete', { color: 0xb3b9be }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.01;
  g.add(deck);
  return g;
}

export function buildRPV(M, seg) {
  const { rpvRi: ri, rpvRo: ro } = G;
  const outerBottom = Array.from({ length: 15 }, (_, k) => {
    const t = (k / 14) * (Math.PI / 2);
    return [ro * Math.cos(t), 2.9 - 1.4 * Math.sin(t)]; // (ro,2.9) -> (0,1.5)
  });
  const innerBottom = Array.from({ length: 15 }, (_, k) => {
    const t = (k / 14) * (Math.PI / 2);
    return [ri * Math.sin(t), 2.9 - 1.18 * Math.cos(t)]; // (0,1.72) -> (ri,2.9)
  });
  const profile = [[ri, G.shellTop], [2.72, G.shellTop], [2.72, G.shellTop - 0.4], [ro, G.shellTop - 0.4], ...outerBottom, ...innerBottom, [ri, G.shellTop]];
  const shell = lathe(profile, M.make('steel', { color: 0x66727d }), seg);
  const g = new THREE.Group();
  g.add(shell);
  // nozzle stubs: 4 outlet (hot) + 4 inlet (cold). Instanced.
  const nozGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.3, 24);
  nozGeo.rotateZ(Math.PI / 2); // along x
  nozGeo.translate(ro + 0.35, 0, 0);
  const noz = new THREE.InstancedMesh(nozGeo, M.make('steel', { color: 0x66727d }), 8);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let n = 0;
  for (let k = 0; k < 4; k++) {
    const phi = ((45 + 90 * k) * Math.PI) / 180;
    for (const [t, y] of [[-0.9, G.hotY], [0.9, G.coldY]]) {
      const ang = phi + Math.atan2(t, ro);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
      m4.compose(new THREE.Vector3(0, y, 0), q, new THREE.Vector3(1, 1, 1));
      noz.setMatrixAt(n++, m4);
    }
  }
  g.add(noz);
  return g;
}

export function buildHead(M, seg) {
  const g = new THREE.Group();
  const rim = G.rpvRo;
  const pts = [[2.72, G.shellTop], [2.72, G.headBase]];
  for (let k = 0; k <= 20; k++) {
    const t = (k / 20) * (Math.PI / 2);
    pts.push([rim * Math.cos(t), G.headBase + G.headRise * Math.sin(t)]);
  }
  pts.push([0, G.headBase + G.headRise - 0.15]);
  for (let k = 20; k >= 0; k--) {
    const t = (k / 20) * (Math.PI / 2);
    pts.push([(rim - 0.22) * Math.cos(t), G.headBase + (G.headRise - 0.15) * Math.sin(t)]);
  }
  pts.push([2.2, G.headBase], [2.2, G.shellTop], [2.72, G.shellTop]);
  const dome = lathe(pts, M.make('steel', { color: 0x66727d }), seg);
  g.add(dome);
  // CRDM housings (one per RCCA): instanced, scaled to reach the common top
  const geo = new THREE.CylinderGeometry(0.17, 0.17, 1, 16);
  geo.translate(0, 0.5, 0);
  const hs = new THREE.InstancedMesh(geo, M.get('stainless'), RCC_CELLS.length);
  const geo2 = new THREE.CylinderGeometry(0.24, 0.24, 1.6, 16);
  const coils = new THREE.InstancedMesh(geo2, M.get('dark'), RCC_CELLS.length);
  const m = new THREE.Matrix4();
  RCC_CELLS.forEach((c, i) => {
    const y0 = yDome(c.r) - 0.1;
    const len = G.crdmTop - y0;
    m.compose(new THREE.Vector3(c.x, y0, c.z), new THREE.Quaternion(), new THREE.Vector3(1, len, 1));
    hs.setMatrixAt(i, m);
    m.makeTranslation(c.x, y0 + len * 0.55, c.z);
    coils.setMatrixAt(i, m);
  });
  g.add(hs, coils);
  // lifting lugs
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.5), M.get('steel'));
    lug.position.set(Math.cos(a) * 2.35, G.headBase + 0.5, Math.sin(a) * 2.35);
    g.add(lug);
  }
  return g;
}

export function buildRCCA(M) {
  const g = new THREE.Group();
  const rodGeo = new THREE.CylinderGeometry(0.075, 0.075, G.rodLen, 12);
  rodGeo.translate(0, G.rodLen / 2, 0);
  const rods = new THREE.InstancedMesh(rodGeo, M.get('absorber'), RCC_CELLS.length);
  const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.25, 12);
  hubGeo.translate(0, G.rodLen + 0.12, 0);
  const hubs = new THREE.InstancedMesh(hubGeo, M.get('stainless'), RCC_CELLS.length);
  const shGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
  shGeo.translate(0, 0.5, 0);
  const shafts = new THREE.InstancedMesh(shGeo, M.get('stainless'), RCC_CELLS.length);
  g.add(rods, hubs, shafts);
  const m = new THREE.Matrix4();
  let last = -1;
  function setPos(x /* fraction withdrawn */) {
    if (Math.abs(x - last) < 1e-5) return;
    last = x;
    const tip = G.coreY0 + 0.1 + x * G.coreH;
    RCC_CELLS.forEach((c, i) => {
      m.makeTranslation(c.x, tip, c.z);
      rods.setMatrixAt(i, m);
      hubs.setMatrixAt(i, m);
      const top = tip + G.rodLen + 0.25;
      m.compose(new THREE.Vector3(c.x, top, c.z), new THREE.Quaternion(), new THREE.Vector3(1, Math.max(0.01, G.driveTop - top), 1));
      shafts.setMatrixAt(i, m);
    });
    rods.instanceMatrix.needsUpdate = hubs.instanceMatrix.needsUpdate = shafts.instanceMatrix.needsUpdate = true;
  }
  setPos(S.rcca.v ? 0.88 : 0);
  return { object: g, setPos, tipOf: (x) => G.coreY0 + 0.1 + x * G.coreH };
}

export function buildCore(M) {
  const g = new THREE.Group();
  const tube = new THREE.CylinderGeometry(0.1414, 0.1414, G.coreH, 4, 1, true);
  tube.rotateY(Math.PI / 4);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.5, side: THREE.DoubleSide });
  const asm = new THREE.InstancedMesh(tube, mat, CELLS.length);
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  CELLS.forEach((c, i) => {
    m.makeTranslation(c.x, G.coreMid, c.z);
    asm.setMatrixAt(i, m);
    asm.setColorAt(i, col.set(0x9aa3a0));
  });
  g.add(asm);
  const topGeo = new THREE.BoxGeometry(0.15, 0.2, 0.15);
  topGeo.translate(0, G.coreY1 + 0.1, 0);
  const botGeo = new THREE.CylinderGeometry(0.1, 0.06, 0.18, 4);
  botGeo.rotateY(Math.PI / 4);
  botGeo.translate(0, G.coreY0 - 0.09, 0);
  const tops = new THREE.InstancedMesh(topGeo, M.get('stainless'), CELLS.length);
  const bots = new THREE.InstancedMesh(botGeo, M.get('stainless'), CELLS.length);
  CELLS.forEach((c, i) => {
    m.makeTranslation(c.x, 0, c.z);
    tops.setMatrixAt(i, m);
    bots.setMatrixAt(i, m);
  });
  g.add(tops, bots);
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.74, 1.74, G.coreH, 48, 1, true), M.glow(0x3fb8ff, 0.1));
  glow.position.y = G.coreMid;
  glow.userData.fx = true;
  g.add(glow);
  // radial power shape: cos shape normalised to mean 1 over the 193 cells
  const Rext = 1.9;
  const shape = CELLS.map((c) => Math.cos((Math.PI / 2) * (c.r / Rext)));
  const mean = shape.reduce((a, b) => a + b, 0) / shape.length;
  const rel = shape.map((s) => s / mean);
  let lastKey = '';
  function update(state, M2, t = 0) {
    const key = Math.round(state.Tfuel / 4) + ':' + Math.round(state.Tavg) + ':' + Math.round(state.powerPct / 2);
    if (key !== lastKey) {
      lastKey = key;
      CELLS.forEach((c, i) => {
        const T = state.Tavg + (state.Tfuel - state.Tavg) * rel[i] * 1.0;
        M2.tempColor(T, 270, 900, col);
        asm.setColorAt(i, col);
      });
      asm.instanceColor.needsUpdate = true;
    }
    glow.material.opacity = Math.min(0.55, (0.01 + 0.24 * state.fissionPct / 100 + 0.02 * state.decayPct / 10) * (0.88 + 0.12 * Math.sin(t * 2.3)));
  }
  return { object: g, update, asm };
}

export function buildInternals(M, seg) {
  const g = new THREE.Group();
  const ro = 1.94;
  const ri = 1.88;
  const prof = [[ri, 2.9], [ro, 2.9], [ro, 12.0], [2.18, 12.0], [2.18, 12.2], [ri, 12.2], [ri, 2.9]];
  g.add(lathe(prof, M.make('stainless', { color: 0x8d99a3 }), seg));
  const disc = (r, y0, y1, mat) => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, y1 - y0, 48), mat);
    d.position.y = (y0 + y1) / 2;
    return d;
  };
  g.add(disc(1.9, 2.9, 3.15, M.get('steel')));
  g.add(disc(1.9, 3.7, G.coreY0 - 0.2 + 0.0, M.get('steel')));
  g.add(disc(1.9, G.coreY1 + 0.25, G.coreY1 + 0.45, M.get('steel')));
  g.add(disc(1.9, 11.4, 11.7, M.get('steel')));
  const col = new THREE.CylinderGeometry(0.1, 0.1, 3.1, 10);
  const guides = new THREE.InstancedMesh(col, M.make('stainless', { color: 0x7f8b95 }), RCC_CELLS.length);
  const m = new THREE.Matrix4();
  RCC_CELLS.forEach((c, i) => {
    m.makeTranslation(c.x, G.coreY1 + 0.45 + 1.55, c.z);
    guides.setMatrixAt(i, m);
  });
  g.add(guides);
  // support columns under the core
  const sc = new THREE.CylinderGeometry(0.11, 0.11, 0.55, 8);
  const cols = new THREE.InstancedMesh(sc, M.get('steel'), 16);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * 1.6, 3.4, Math.sin(a) * 1.6);
    cols.setMatrixAt(k, m);
  }
  g.add(cols);
  // baffle ring around the core
  const baffle = lathe([[1.74, G.coreY0], [1.84, G.coreY0], [1.84, G.coreY1], [1.74, G.coreY1], [1.74, G.coreY0]], M.get('stainless'), seg);
  g.add(baffle);
  return g;
}

// ------------------------------------------------------------------ fuel drill-down (magnified, shown only when isolated)
const MAG_ASM = 6;
const MAG_ROD = 60;
const MAG_PEL = 300;

/** One 17x17 assembly: a truncated slice with spacer grid, 264 fuel rods, 24 guide tubes, 1 instrument tube. */
export function buildAssemblyDrill(M) {
  const g = new THREE.Group();
  const p = 0.0126 * MAG_ASM; // rod pitch 12.6 mm, magnified
  const rodR = (S.rodOD.v / 1000 / 2) * MAG_ASM;
  const len = 1.5; // truncated length (magnified metres)
  const N = 17;
  // Standard Westinghouse 17x17 pattern: 24 guide tubes + 1 instrument tube (centre) + 264 fuel rods
  const GT = [[2, 5], [2, 8], [2, 11], [3, 3], [3, 13], [5, 2], [5, 5], [5, 8], [5, 11], [5, 14], [8, 2], [8, 5], [8, 11], [8, 14], [11, 2], [11, 5], [11, 8], [11, 11], [11, 14], [13, 3], [13, 13], [14, 5], [14, 8], [14, 11]];
  const isGT = (a, b) => GT.some(([x, y]) => x === a && y === b);
  const fuelCells = [];
  for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) if (!isGT(a, b) && !(a === 8 && b === 8)) fuelCells.push([a, b]);
  const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(rodR, rodR, len, 16), M.make('zircaloy', { color: 0xa9b3a0 }), fuelCells.length);
  const gtm = new THREE.InstancedMesh(new THREE.CylinderGeometry(rodR * 1.3, rodR * 1.3, len, 16), M.make('dark', { color: 0x2f3a44 }), GT.length);
  const m = new THREE.Matrix4();
  const off = (N - 1) / 2;
  fuelCells.forEach(([a, b], i) => rods.setMatrixAt(i, m.makeTranslation((a - off) * p, 0, (b - off) * p)));
  GT.forEach(([a, b], i) => gtm.setMatrixAt(i, m.makeTranslation((a - off) * p, 0, (b - off) * p)));
  const instr = new THREE.Mesh(new THREE.CylinderGeometry(rodR * 1.3, rodR * 1.3, len, 16), M.make('copper', { color: 0xb9743e }));
  g.add(rods, gtm, instr);
  const w = N * p;
  for (const y of [-0.5, 0.4]) {
    const grid = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, w), M.make('stainless', { color: 0x4f5a64, metalness: 0.5 }));
    grid.position.y = y;
    g.add(grid);
    outline(grid, { opacity: 0.6 });
  }
  g.position.copy(G.drillPos);
  g.userData.count = { fuel: fuelCells.length, guide: GT.length, instr: 1 };
  return g;
}

/** One fuel rod, magnified, cladding opened to show pellets, plenum spring and end plugs. */
export function buildRodDrill(M) {
  const g = new THREE.Group();
  const k = MAG_ROD;
  const R = (S.rodOD.v / 1000 / 2) * k; // outer radius
  const wall = 0.57e-3 * k;
  const pelR = (S.pelletD.v / 1000 / 2) * k;
  const pelH = (S.pelletH.v / 1000) * k;
  const n = 5;
  const L = 3.6;
  const mkClad = (r, color) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L, 40, 1, true, 0, Math.PI * 1.5), M.make('zircaloy', { color }));
    m.rotation.y = Math.PI * 0.25;
    return m;
  };
  g.add(mkClad(R, 0x8a9487), mkClad(R - wall, 0x6a7468));
  const pel = new THREE.InstancedMesh(new THREE.CylinderGeometry(pelR, pelR, pelH * 0.96, 32), M.make('graphite', { color: 0x2f353b, metalness: 0.15, roughness: 0.6 }), n);
  const m = new THREE.Matrix4();
  const y0 = -L / 2 + 0.35 + pelH / 2;
  for (let i = 0; i < n; i++) pel.setMatrixAt(i, m.makeTranslation(0, y0 + i * pelH, 0));
  g.add(pel);
  const top = y0 + (n - 1) * pelH + pelH / 2;
  const pts = [];
  for (let t = 0; t <= 1; t += 0.01) pts.push(new THREE.Vector3(Math.cos(t * 50) * pelR * 0.75, top + 0.04 + t * (L / 2 - 0.3 - top), Math.sin(t * 50) * pelR * 0.75));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.02, 6), M.get('stainless')));
  for (const y of [-L / 2, L / 2]) {
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.8, 0.28, 24), M.make('zircaloy', { color: 0x8a9487 }));
    plug.position.y = y;
    g.add(plug);
  }
  g.position.copy(G.drillPos);
  g.userData.dims = { R, pelR, pelH };
  return g;
}

/** One UO2 pellet, magnified; vertex-coloured radial temperature, one quarter cut away. */
export function buildPelletDrill(M) {
  const g = new THREE.Group();
  const R = (S.pelletD.v / 1000 / 2) * MAG_PEL;
  const H = (S.pelletH.v / 1000) * MAG_PEL;
  const rings = 14;
  const prof = [];
  const dish = 0.08 * H;
  for (let k = 0; k <= rings; k++) {
    const r = (R * k) / rings;
    prof.push([r, H / 2 - (r < R * 0.7 ? dish * (1 - (r / (R * 0.7)) ** 2) : 0) - (r > R * 0.95 ? ((r - R * 0.95) / (R * 0.05)) * 0.06 * H : 0)]);
  }
  prof.push([R, -H / 2 + 0.06 * H]);
  for (let k = rings; k >= 0; k--) {
    const r = (R * k) / rings;
    prof.push([r, -H / 2 + (r < R * 0.7 ? dish * (1 - (r / (R * 0.7)) ** 2) : 0) + (r > R * 0.95 ? ((r - R * 0.95) / (R * 0.05)) * 0.06 * H : 0)]);
  }
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48, 0, Math.PI * 1.5);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.1, roughness: 0.55, side: THREE.DoubleSide });
  const body = new THREE.Mesh(geo, mat);
  g.add(body);
  // two cut faces (radial gradient)
  const faces = [];
  for (const a of [0, Math.PI * 1.5]) {
    const pg = new THREE.PlaneGeometry(R, H * 0.9, 14, 1);
    pg.translate(R / 2, 0, 0);
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pg.attributes.position.count * 3), 3));
    const f = new THREE.Mesh(pg, mat);
    f.rotation.y = -a + Math.PI * 0;
    g.add(f);
    faces.push(pg);
  }
  const radial = (r) => 1 - (r / R) ** 2; // 1 at centre, 0 at surface
  const c = new THREE.Color();
  function paint(state, M2) {
    const Ts = state.Tavg + 60; // clad/pellet surface
    const Tcl = Ts + (state.Tfuel * 1.55 - Ts) * 1.0; // centreline ~ 1.5x mean for this teaching profile
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      const T = Ts + (Tcl - Ts) * radial(r) * 0.9;
      M2.tempColor(T, 270, 1500, c);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.attributes.color.needsUpdate = true;
    for (const pg of faces) {
      const p2 = pg.attributes.position;
      const col = pg.attributes.color;
      for (let i = 0; i < p2.count; i++) {
        const T = Ts + (Tcl - Ts) * radial(p2.getX(i));
        M2.tempColor(T, 270, 1500, c);
        col.setXYZ(i, c.r, c.g, c.b);
      }
      col.needsUpdate = true;
    }
    return { Tcl, Ts };
  }
  g.position.copy(G.drillPos);
  return { object: g, paint };
}
export { MAG_ASM, MAG_ROD, MAG_PEL };
