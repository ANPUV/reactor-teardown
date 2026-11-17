// sfr/geo.js - shared dimensions (metres, y up, reactor axis on y, floor y = 0) and the hexagonal core lattice.
import * as THREE from 'three';
import { spec } from './spec.js';

const S = spec.items;
export const rad = (d) => (d * Math.PI) / 180;
export const G = {
  P: S.pitch.v / 1000, // 0.100 m
  asmR: S.acrossFlats.v / 1000 / Math.sqrt(3), // corner radius of the wrapper
  coreH: S.activeHeight.v,
  coreY0: 5.3,
  asm0: 3.9, // assembly foot (diagrid top)
  asmTop: 7.4,
  hotBase: 7.5,
  level: 14.4, // free sodium surface in the cold pool
  levelHot: 14.55,
  vesRo: S.vesselD.v / 2, // 6.45
  vesWall: 0.06,
  vesBot: 1.2,
  vesTop: 1.2 + S.vesselH.v, // 16.0
  guardR: 6.8,
  guardBot: 0.85,
  guardTop: 15.2,
  pitRi: 6.95,
  pitRo: 9.0,
  roofTop: 17.4,
  shellR: 3.9,
  shellTop: 14.9,
  ihxR: 4.7, // IHX axis radius
  ihxRad: 0.75,
  pumpR: 5.5,
  loopAng: [-95, -25, 45], // loop azimuths from +x toward +z (degrees)
  ihxSplit: 22,
  sgR: 15.5,
  TY: 4.6, // turbine axis height
  drill: new THREE.Vector3(0, 32, 0),
};
G.coreY1 = G.coreY0 + G.coreH;
G.vesRi = G.vesRo - G.vesWall;
export const polar = (r, deg, y) => new THREE.Vector3(r * Math.cos(rad(deg)), y, r * Math.sin(rad(deg)));
export const radialDir = (deg) => [Math.cos(rad(deg)), 0, Math.sin(rad(deg))];

/** Hexagonal lattice: 595 core cells (565 fuel + 30 rods) + 90 blanket cells, built from 60-degree orbits. */
function buildLattice() {
  const P = G.P;
  const cell = (q, r) => ({ q, r, x: P * (q + 0.5 * r), z: P * 0.8660254 * r });
  const rot = ([q, r]) => [-r, q + r];
  const orbits = new Map();
  for (let q = -20; q <= 20; q++)
    for (let r = -20; r <= 20; r++) {
      let c = [q, r];
      let best = c;
      for (let k = 0; k < 5; k++) {
        c = rot(c);
        if (c[0] < best[0] || (c[0] === best[0] && c[1] < best[1])) best = c;
      }
      const key = best.join(',');
      if (!orbits.has(key)) orbits.set(key, { rep: best, cells: [] });
    }
  for (const o of orbits.values()) {
    let c = o.rep;
    const seen = new Set();
    for (let k = 0; k < 6; k++) {
      if (!seen.has(c.join(','))) {
        seen.add(c.join(','));
        o.cells.push(cell(c[0], c[1]));
      }
      c = rot(c);
    }
    const rep = cell(o.rep[0], o.rep[1]);
    o.d = Math.hypot(rep.x, rep.z);
    o.ang = Math.atan2(rep.z, rep.x);
  }
  const list = [...orbits.values()].sort((a, b) => a.d - b.d || a.ang - b.ang);
  const centre = list.shift(); // the single central cell
  const six = list.filter((o) => o.cells.length === 6);
  const coreOrbits = six.slice(0, 99); // 1 + 99 * 6 = 595
  const blanketOrbits = six.slice(99, 114); // 15 * 6 = 90
  const rodRanks = [5, 20, 40, 62, 84];
  const rodSet = new Set(rodRanks);
  const fuelOrbits = coreOrbits.filter((o, i) => !rodSet.has(i));
  const rods = rodRanks.flatMap((i) => coreOrbits[i].cells);
  const zoneOf = (i) => (i < 35 ? 1 : i < 61 ? 2 : 3); // fuel orbit rank -> zone (211 / 156 / 198 with the centre cell in zone 1)
  const fuel = [{ ...centre.cells[0], zone: 1 }];
  fuelOrbits.forEach((o, i) => o.cells.forEach((c) => fuel.push({ ...c, zone: zoneOf(i) })));
  const blanket = blanketOrbits.flatMap((o) => o.cells);
  const Rmax = Math.max(...fuel.concat(rods).map((c) => Math.hypot(c.x, c.z)));
  return { fuel, rods, blanket, Rmax, Rblanket: Math.max(...blanket.map((c) => Math.hypot(c.x, c.z))) };
}
export const LAT = buildLattice();
