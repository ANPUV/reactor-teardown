// ITER tokamak - the fusion machine implementing CONTRACT.md.
import * as THREE from 'three';
import { spec, SOURCES } from './spec.js';
import { createModel } from './model.js';
import { atom } from './atom.js';
import { tour } from './tour.js';
import { fmt } from '../../kit/util.js';
import { t } from '../../kit/i18n.js';
import { Y0 } from './shapes.js';
import { buildCryostat, buildCS, buildTF, buildPF, buildVessel, buildBlanket, buildDivertor, phiSect, radial, SECT, FAN } from './structures.js';
import { buildPlasma } from './plasma.js';
import { tfFlow, csFlow, pfFlow, neutrons, buildNBI, buildECRH, buildICRH, buildPellet, buildHX } from './fx.js';

const I = spec.items;
const f = (label, key) => ({ label, spec: key });
const PHASES = {
  idle: 'Idle',
  magnetise: 'Magnets charging',
  breakdown: 'Breakdown',
  rampup: 'Current ramp-up',
  flattop: 'Flat-top heating',
  burn: 'Burn',
  rampdown: 'Ramp-down',
  mitigate: 'Mitigated shutdown',
  disruption: 'Disruption',
  tripped: 'Disrupted',
  winddown: 'Magnets discharging',
};

const controls = [
  { type: 'slider', id: 'heat', label: 'Heating power', unit: 'MW', min: 0, max: I.pinst.v, step: 1, decimals: 0, key: 'heat', scale: 1, mark: I.paux.v, hint: 'Neutral beam, electron cyclotron and ion cyclotron heating, shared in proportion.' },
  { type: 'slider', id: 'fuel', label: 'Density', unit: '×10²⁰', min: 0.1, max: 1.8, step: 0.01, decimals: 2, key: 'fuel', scale: 1, mark: I.dens.v, hint: 'Pellet fuelling target. Too high for the current and the plasma disrupts.' },
  { type: 'slider', id: 'ip', label: 'Plasma current', unit: 'MA', min: 3, max: 17, step: 0.1, decimals: 1, key: 'ip', scale: 1, mark: I.ip.v, hint: 'Driven by the central solenoid. Sets the confinement and the density limit.' },
  { type: 'slider', id: 'bt', label: 'Toroidal field', unit: 'T', min: 3, max: 6.5, step: 0.05, decimals: 2, key: 'bt', scale: 1, mark: I.bt.v, hint: 'Field on axis from the toroidal field coils.' },
  { type: 'slider', id: 'mix', label: 'Tritium share', unit: '%', min: 5, max: 95, step: 1, decimals: 0, key: 'mix', scale: 100, mark: 50, hint: 'D:T mix. Fusion is strongest at 50:50.' },
  { type: 'button', id: 'start', label: 'Start pulse', hotkey: 's', press: (m) => m.press('start'), disabled: (s) => s.phase !== 'idle', hint: 'Charge the magnets, break down the gas, ramp the current, heat.' },
  { type: 'button', id: 'mitigate', label: 'Mitigate', kind: 'danger', hotkey: 'm', press: (m) => m.press('mitigate'), disabled: (s) => !(s.plasma || s.phase === 'magnetise' || s.phase === 'breakdown') || s.phase === 'mitigate' || s.phase === 'disruption', hint: 'Shattered pellet: a fast, controlled radiative shutdown instead of a damaging disruption.' },
  { type: 'button', id: 'reset', label: 'Stop / reset', hotkey: 'r', press: (m) => m.press('reset'), disabled: (s) => s.phase === 'idle' || s.phase === 'winddown' || s.phase === 'mitigate' || s.phase === 'disruption', hint: 'End the pulse with a normal ramp-down, or re-arm the machine after a disruption.' },
  { type: 'toggle', id: 'auto', label: 'Auto pulse', get: (m) => !!m.controls.auto, set: (m, v) => m.setControl('auto', v) },
];

const gauges = [
  { type: 'dial', id: 'q', label: 'Gain Q', unit: 'fusion / heating', min: 0, max: 20, mark: I.q.v, decimals: 1, zones: [], get: (s) => Math.min(s.Q, 99) },
  { type: 'dial', id: 'pfus', label: 'Fusion power', unit: 'MW', min: 0, max: 700, mark: I.pfus.v, zones: [{ from: 600, to: 700, kind: 'warn' }], get: (s) => s.pFus },
  { type: 'dial', id: 'temp', label: 'Ion temperature', unit: 'keV, average', min: 0, max: 30, decimals: 1, zones: [], get: (s) => s.T },
  { type: 'dial', id: 'gw', label: 'Density / Greenwald', unit: 'fraction', min: 0, max: 1.2, mark: 1, decimals: 2, zones: [{ from: 0.9, to: 1, kind: 'warn' }, { from: 1, to: 1.2, kind: 'alarm' }], get: (s) => s.fGW },
  { type: 'bar', id: 'triple', label: 'Triple product n·T·τ', unit: '×10²¹ keV·s/m³', min: 0, max: 4, mark: I.triple.v, decimals: 2, get: (s) => s.triple / 1e21 },
  { type: 'bar', id: 'alpha', label: 'Self-heating (alpha)', unit: '%', min: 0, max: 100, decimals: 0, get: (s) => s.alphaFrac * 100 },
  { type: 'readout', id: 'phase', label: 'Pulse phase', unit: '', get: (s) => s.phase, format: (v) => t(PHASES[v] || v) },
  { type: 'readout', id: 'tmk', label: 'Core temperature', unit: 'million °C', get: (s) => s.TcoreMk },
  { type: 'readout', id: 'n', label: 'Density', unit: '×10²⁰ m⁻³', decimals: 2, get: (s) => s.n },
  { type: 'readout', id: 'tau', label: 'τ_E (model)', unit: 's', decimals: 2, get: (s) => s.tauE },
  { type: 'readout', id: 'betan', label: 'β_N (limit 2.8)', unit: '', decimals: 2, get: (s) => s.betaN },
  { type: 'readout', id: 'q95', label: 'q95 (limit 2)', unit: '', decimals: 2, get: (s) => Math.min(s.q95, 99), format: (v, s) => (s.plasma ? fmt(v, 2) : '—') },
];
const charts = [
  { type: 'strip', id: 'c-power', label: 'Power (MW)', series: [{ label: 'fusion', color: 'plasma', get: (s) => s.pFus }, { label: 'heating', color: 'ink', get: (s) => s.pAux }], min: 0, max: 700, windowSec: 240, height: 34, span: 2 },
  { type: 'strip', id: 'c-temp', label: 'T (keV) and Q', series: [{ label: 'T keV', color: 'hot', get: (s) => s.T }, { label: 'Q', color: 'cold', get: (s) => Math.min(s.Q, 30) }], min: 0, max: 30, windowSec: 240, height: 34, span: 2 },
];

function build(ctx) {
  const M = ctx.mats;
  const detail = ctx.quality.detail;
  const seg = detail >= 0.9 ? 72 : detail >= 0.5 ? 48 : 32;
  const root = new THREE.Group();

  const cryo = buildCryostat(M, seg);
  const cs = buildCS(M, seg);
  const tf = buildTF(M);
  const pf = buildPF(M, seg);
  const vv = buildVessel(M, detail);
  const blk = buildBlanket(M);
  const div = buildDivertor(M, seg);
  const plasma = buildPlasma(M, detail);
  const nbi = buildNBI(M);
  const ec = buildECRH(M);
  const ic = buildICRH(M);
  const pel = buildPellet(M);
  const hx = buildHX(M, { detail });
  const tfF = tfFlow(M, tf);
  const csF = csFlow(M, cs);
  const pfF = pfFlow(M, pf);
  const neu = neutrons(M, blk, plasma);
  tf.object.add(tfF.object);
  cs.object.add(csF.object);
  pf.object.add(pfF.object);
  neu.objects.forEach((o) => blk.object.add(o));
  // plasma, field lines and the strike-point glow ride with their parts
  const plasmaGroup = new THREE.Group();
  plasmaGroup.position.y = Y0;
  plasmaGroup.add(plasma.object);
  const plasmaPart = new THREE.Group();
  plasmaPart.add(plasmaGroup);

  const E = (o) => o; // explicit identity: part objects are used as built
  const radialOff = (deg, d) => radial((deg * Math.PI) / 180, d);
  const ph = (deg) => (deg * Math.PI) / 180;
  void ph;
  const parts = [
    { id: 'cryostat', label: 'Cryostat', group: 'Magnets and cryostat', object: E(cryo.object), explodeOffset: [0, 0, 0], spread: cryo.spread, camera: { az: -35, el: 20 }, card: { title: 'Cryostat', text: 'A stainless-steel vacuum jacket around the whole machine. The magnets must stay near absolute zero, so the cryostat keeps room heat and air away from them.', facts: [f('Diameter', 'cryoD'), f('Height', 'cryoH'), f('Mass', 'cryoMass'), f('Whole machine', 'mass'), f('Magnet temperature', 'cryoT')] } },
    { id: 'cs', label: 'Central solenoid', group: 'Magnets and cryostat', badge: '×6', object: cs.object, explodeOffset: [0, 0, 0], spread: cs.spread, noCut: true, camera: { az: -35, el: 14, fill: 0.62 }, card: { title: 'Central solenoid (6 modules)', text: 'A tall stack of superconducting coils on the machine axis. It works as the primary of a transformer: ramping its current induces the plasma current, which is the secondary and also heats the plasma.', facts: [f('Modules', 'csN'), f('Height', 'csH'), f('Width', 'csW'), f('Peak field', 'csField'), f('Conductor', 'csMat'), { label: 'Charge now', live: (s) => fmt(s.cs * 100, 0) + ' %' }] } },
    { id: 'tf', label: 'Toroidal field coils', group: 'Magnets and cryostat', badge: '×18', object: tf.object, explodeOffset: [0, 0, 0], spread: tf.spread, camera: { az: -35, el: 18 }, card: { title: 'Toroidal field coils (18)', text: 'D-shaped superconducting coils that make the main field running the long way around the torus. The D shape carries the load as tension; the cold helium flow is shown as slow grey dots, the current as blue pulses.', facts: [f('Coils', 'tfN'), f('Height', 'tfH'), f('Width', 'tfW'), f('Mass each', 'tfMass'), f('Peak field at winding', 'tfPeak'), f('Conductor', 'tfMat'), f('Temperature', 'cryoT'), { label: 'Field on axis now', live: (s) => fmt(s.B, 2) + ' T' }] } },
    { id: 'pf', label: 'Poloidal field coils', group: 'Magnets and cryostat', badge: '×6', object: pf.object, explodeOffset: [0, 0, 0], spread: pf.spread, camera: { az: -35, el: 16 }, card: { title: 'Poloidal field coils (6)', text: 'Rings around the machine that shape and position the plasma. With the plasma current they twist the toroidal field into helical field lines; the pitch of the particles follows the safety factor q.', facts: [f('Coils', 'pfN'), f('Largest diameter', 'pfD'), f('Conductor', 'pfMat'), { label: 'Excitation', live: (s) => fmt(s.pf * 100, 0) + ' %' }] } },
    { id: 'vv', label: 'Vacuum vessel', group: 'Vessel and first wall', badge: '×9', object: vv.object, explodeOffset: [0, 0, 0], spread: vv.spread, camera: { az: -35, el: 30 }, card: { title: 'Vacuum vessel (9 sectors)', text: 'A double-walled steel torus with the D-shaped cross-section. It is the first containment, holds the high vacuum, and carries the blanket, divertor and ports. Water between the walls helps remove heat.', facts: [f('Sectors', 'vvSectors'), f('Outer diameter', 'vvD'), f('Height', 'vvH'), f('Mass', 'vvMass')] } },
    { id: 'blanket', label: 'Blanket modules', group: 'Vessel and first wall', badge: '×440', object: blk.object, explodeOffset: [0, 0, 0], spread: blk.spread, camera: { az: -35, el: 28 }, card: { title: 'Blanket modules (440)', text: 'Armoured panels that line the vessel and absorb the neutrons and radiation. Most of the fusion energy, carried by the neutron, ends here as heat. Red sparks mark neutron hits; the tint follows the heat load.', facts: [f('Modules', 'blkN'), f('Module width', 'blkW'), f('Module length', 'blkL'), f('Mass each', 'blkMass'), f('First-wall armour', 'wallMat'), f('Neutron energy', 'eN'), { label: 'Neutron power in blanket', live: (s) => fmt(s.pNeutron, 0) + ' MW' }, { label: 'Neutron wall load', live: (s) => fmt(s.wallLoad, 2) + ' MW/m²' }] } },
    { id: 'divertor', label: 'Divertor', group: 'Vessel and first wall', badge: '×54', object: div.object, explodeOffset: [0, 0, 0], spread: div.spread, camera: { az: -35, el: 36 }, card: { title: 'Divertor (54 cassettes)', text: 'The exhaust at the bottom of the vessel. Field lines at the edge are led onto tungsten targets, which take the plasma heat and pump out helium ash and impurities. The glowing rings are the strike points.', facts: [f('Cassettes', 'divN'), f('Target heat flux', 'divLoad'), f('Armour', 'wallMat'), { label: 'Helium ash in plasma', live: (s) => fmt(s.fHe * 100, 1) + ' %' }, { label: 'Heat load now', live: (s) => fmt(s.divHeat * 100, 0) + ' %' }] } },
    { id: 'plasma', label: 'Plasma', group: 'Plasma', object: plasmaPart, explodeOffset: [0, 0, 0], highlight: false, camera: { az: -35, el: 24, fill: 0.7 }, card: { title: 'Plasma', text: 'Hot ionised deuterium-tritium gas held off the walls by magnetic fields. It must be hot, dense and well insulated at once: the product n·T·τ is the Lawson criterion. The hot core is nearly transparent; the cooler edge and the divertor legs glow. In this teaching model the confinement time comes out below the ITER design value; see About.', facts: [{ label: 'Ion temperature (avg)', live: (s) => fmt(s.T, 1) + ' keV' }, { label: 'Core temperature', live: (s) => fmt(s.TcoreMk, 0) + ' million °C' }, { label: 'Density', live: (s) => fmt(s.n, 2) + ' ×10²⁰ m⁻³' }, { label: 'Confinement time (model)', live: (s) => fmt(s.tauE, 2) + ' s' }, f('Energy confinement time (ITER design)', 'tauE'), { label: 'Fusion power', live: (s) => fmt(s.pFus, 0) + ' MW' }, { label: 'Alpha heating', live: (s) => fmt(s.pAlpha, 0) + ' MW' }, f('Major radius', 'R'), f('Minor radius', 'a'), f('Volume', 'volume'), f('Plasma current (goal)', 'ip')] } },
    { id: 'nbi', label: 'Neutral beam injector', group: 'Heating and fuelling', object: nbi.object, explodeOffset: radialOff(300, FAN), camera: { az: 150, el: 28 }, card: { title: 'Neutral beam injector', text: 'Accelerates deuterium ions, turns them back into fast neutral atoms so the magnetic field cannot stop them, and fires them tangentially into the plasma where they share their energy.', facts: [f('Beam power', 'pnbi'), f('Beam energy', 'enbi'), { label: 'Beam power now', live: (s) => fmt(s.pNBI, 1) + ' MW' }] } },
    { id: 'ecrh', label: 'Electron cyclotron launcher', group: 'Heating and fuelling', object: ec.object, explodeOffset: radialOff(340, FAN), camera: { az: 110, el: 26 }, card: { title: 'Electron cyclotron launcher', text: 'Microwave beams from gyrotrons, tuned to the frequency electrons circle the field lines. The energy goes to the electrons exactly where the beam is aimed, so it also helps to start the plasma and to control it.', facts: [f('Power', 'pec'), f('Frequency', 'fec'), { label: 'Power now', live: (s) => fmt(s.pEC, 1) + ' MW' }] } },
    { id: 'icrh', label: 'Ion cyclotron antenna', group: 'Heating and fuelling', object: ic.object, explodeOffset: radialOff(260, FAN), camera: { az: 100, el: 22 }, card: { title: 'Ion cyclotron antenna', text: 'Radio-frequency waves from an antenna at the wall, tuned to the frequency ions circle the field lines. The ions absorb the waves and heat the plasma.', facts: [f('Power', 'pic'), { label: 'Power now', live: (s) => fmt(s.pIC, 1) + ' MW' }] } },
    { id: 'pellet', label: 'Pellet injector', group: 'Heating and fuelling', object: pel.object, explodeOffset: radialOff(20, FAN), camera: { az: -20, el: 22 }, card: { title: 'Pellet injector', text: 'Fuel is fed in as frozen deuterium-tritium pellets shot through a guide tube. A pellet is deposited deeper than gas puffed at the edge. Dots flying in show the live fuelling rate.', facts: [{ label: 'Pellets per second (shown)', live: (s) => fmt(s.pelletRate, 1) + ' /s' }, { label: 'Density now', live: (s) => fmt(s.n, 2) + ' ×10²⁰ m⁻³' }, f('Density goal', 'dens')] } },
    { id: 'hx', label: 'Breeding blanket and heat extraction', group: 'Power-plant concept', object: hx.object, explodeOffset: [0, 1.5, 0], camera: { az: -150, el: 30 }, card: { title: 'Breeding blanket and heat extraction (concept)', text: 'Not built at ITER, which makes no electricity. A power plant would line the blanket with lithium, where a neutron makes tritium (n + Li-6 gives T + He-4 + 4.8 MeV), and carry the heat to a heat exchanger and steam turbine. Drawn here as a schematic loop.', facts: [f('Tritium breeding energy', 'eBreed'), f('Neutron share of fusion energy', 'nFrac'), { label: 'Heat to blanket', live: (s) => fmt(s.pNeutron, 0) + ' MW' }, { label: 'Coolant heat tint', live: (s) => fmt(s.blanketHeat * 100, 0) + ' %' }] } },
  ];
  parts.forEach((p) => root.add(p.object));
  void SECT;
  void phiSect;

  // ---- per-frame state to visuals
  const c = new THREE.Color();
  const cold = new THREE.Color(M.COLORS.cold);
  const hot = new THREE.Color(M.COLORS.hot);
  const baseBlk = new THREE.Color(0x46515b);
  const baseDiv = new THREE.Color(0x3a444e);
  let animT = 0;
  function update(s, t, dt) {
    animT += dt;
    // coil excitation: emissive tint by phase
    tf.mat.emissive.copy(cold).multiplyScalar(0.28 * Math.min(1, s.tf));
    cs.mat.emissive.copy(cold).multiplyScalar(0.28 * Math.min(1, s.cs));
    pf.mat.emissive.copy(cold).multiplyScalar(0.28 * Math.min(1, s.pf));
    // blanket and divertor heat tint; a disruption flashes the wall
    const q = s.quench;
    blk.mat.color.copy(baseBlk).lerp(hot, 0.22 * Math.min(1, s.blanketHeat));
    blk.mat.emissive.copy(hot).multiplyScalar(0.05 * Math.min(1, s.blanketHeat) + 0.7 * q);
    div.mat.color.copy(baseDiv).lerp(hot, 0.3 * Math.min(1, s.divHeat));
    div.mat.emissive.copy(hot).multiplyScalar(0.14 * Math.min(1, s.divHeat) + 0.8 * q);
    div.ringMat.opacity = Math.min(0.9, 0.9 * s.divHeat + q) * (s.plasma || q > 0.02 ? 1 : 0);
    plasma.update(s, dt);
    if (!lowFx) {
      tfF.update(s, dt);
      csF.update(s, dt);
      pfF.update(s, dt);
      hx.update(s, dt);
    }
    neu.update(s, dt);
    nbi.update(s, dt);
    ec.update(s, dt);
    ic.update(s, dt);
    pel.update(s, dt);
    void c;
    void t;
  }
  let lowFx = false;
  // pre-warm every particle system so the frozen first frame (dt = 0) is already populated
  for (let i = 0; i < 150; i++) update(ctx.state, 0, 1 / 30);
  const decor = [tfF.object, csF.object, pfF.object, hx.points];
  function setQuality(tier) {
    lowFx = tier === 'low';
    if (lowFx) decor.forEach((o) => (o.material.opacity = 0));
  }
  return {
    root,
    parts,
    update,
    setQuality,
    cutOrigin: [0, 0, 0],
    cutAngle: 325,
    defaultFit: ['cryostat', 'cs', 'tf', 'pf', 'vv', 'blanket', 'divertor', 'plasma'],
    defaultFill: 0.84,
    defaultMode: 'cutaway',
    defaultView: { az: -35, el: 20 },
    presets: { iso: { az: -35, el: 20 }, front: { az: -35, el: 4 }, side: { az: 55, el: 10 }, top: { az: -35, el: 80 } },
    info: { blanket: blk.count, divertor: div.count },
  };
}

export default {
  id: 'tokamak',
  tab: 'fusion',
  title: 'Tokamak (D-T fusion)',
  short: 'ITER',
  spec,
  createModel,
  controls,
  gauges,
  charts,
  build,
  atom,
  tour,
  sources: [
    'ITER Organization machine and project parameters (iter.org).',
    'D-T reactivity: Bosch and Hale, Nucl. Fusion 32 (1992) 611.',
    'Confinement scaling IPB98(y,2), Greenwald density limit and Troyon beta limit: ITER Physics Basis, Nucl. Fusion 39 (1999).',
  ],
  sourceLabels: SOURCES,
  properNames: ['ITER'],
  modelNote: 'A zero-dimensional power balance on the plasma thermal energy, with Bosch-Hale D-T reactivity, IPB98(y,2) confinement, bremsstrahlung and the Greenwald, Troyon and q95 limits that end a pulse in a disruption. One profile factor, K_PROF = 1.3, makes the reference controls give about 500 MW and Q about 10; as a consequence the confinement time comes out near 2.7 s against the ITER value of 3.7 s. The L-H transition and edge-localised modes are not modelled.',
  tripReasons: ['Greenwald density limit exceeded', 'Troyon beta limit exceeded (plasma pressure too high)', 'Edge safety factor q95 fell below 2 (current too high for the field)'],
};
