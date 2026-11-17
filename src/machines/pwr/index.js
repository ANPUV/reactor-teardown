// Westinghouse 4-loop PWR - the reference machine implementing CONTRACT.md.
import * as THREE from 'three';
import { spec, SOURCES } from './spec.js';
import { createModel } from './model.js';
import { atom } from './atom.js';
import { tour } from './tour.js';
import { fmt, fmtSci } from '../../kit/util.js';
import { buildContainment, buildBasemat, buildRPV, buildHead, buildRCCA, buildCore, buildInternals, buildAssemblyDrill, buildRodDrill, buildPelletDrill, G } from './plant.js';
import { buildTower, buildCirculating, buildGrid } from './tertiary.js';
import { buildLegs, buildSteamGens, buildRCPs, buildPressurizer, buildSteamLines, buildTurbine, buildCondenser, hotPath, radial } from './loops.js';

const I = spec.items;
const f = (label, key) => ({ label, spec: key });

const controls = [
  { type: 'slider', id: 'rods', label: 'Control rods', unit: '% withdrawn', min: 0, max: 100, step: 0.5, decimals: 1, key: 'rods', scale: 100, mark: 88, hint: 'Rod cluster position. Lower = more neutron absorption.' },
  { type: 'slider', id: 'flow', label: 'Coolant pumps', unit: '% speed', min: 5, max: 110, step: 1, key: 'flow', scale: 100, mark: 100, hint: 'Reactor coolant pump speed.' },
  { type: 'slider', id: 'load', label: 'Turbine load', unit: '%', min: 0, max: 110, step: 1, key: 'load', scale: 100, mark: 100, hint: 'Steam demand from the grid.' },
  { type: 'button', id: 'scram', label: 'SCRAM', kind: 'danger', hotkey: 'x', press: (m) => m.scram('Manual SCRAM'), hint: 'Drop every control rod now.' },
  { type: 'button', id: 'reset', label: 'Reset trip', hotkey: 'r', press: (m) => m.resetTrip(), disabled: (s) => !s.scrammed, hint: 'Re-arm the protection system (rods stay in until you withdraw them).' },
];

const gauges = [
  { type: 'dial', id: 'power', label: 'Thermal power', unit: '% of full', min: 0, max: 120, mark: 100, zones: [{ from: 105, to: 118, kind: 'warn' }, { from: 118, to: 120, kind: 'alarm' }], get: (s) => s.powerPct },
  { type: 'dial', id: 'tout', label: 'Core outlet', unit: '°C', min: 250, max: 350, mark: I.tout.v, zones: [{ from: 335, to: 345, kind: 'warn' }, { from: 345, to: 350, kind: 'alarm' }], get: (s) => s.Tout },
  { type: 'dial', id: 'tin', label: 'Core inlet', unit: '°C', min: 250, max: 350, mark: I.tin.v, get: (s) => s.Tin },
  { type: 'dial', id: 'press', label: 'Primary pressure', unit: 'MPa', min: 12, max: 18, mark: I.pressure.v, decimals: 1, get: (s) => s.pressure },
  { type: 'readout', id: 'mwe', label: 'Electric output', unit: 'MWe', get: (s) => s.electricMW },
  { type: 'readout', id: 'flowk', label: 'Primary flow', unit: 'kg/s', get: (s) => s.flowKgs },
  { type: 'readout', id: 'rho', label: 'Reactivity', unit: 'pcm', get: (s) => s.rhoPcm, format: (v) => (v > 0 ? '+' : '') + fmt(v, 0) },
  { type: 'readout', id: 'period', label: 'Reactor period', unit: 's', get: (s) => s.periodS, format: (v) => (!isFinite(v) || v > 9999 ? '∞' : fmt(v, 0)) },
  { type: 'readout', id: 'decay', label: 'Decay heat', unit: '% of full power', get: (s) => s.decayPct, decimals: 1 },
  { type: 'readout', id: 'xe', label: 'Xenon-135 worth', unit: 'pcm', get: (s) => s.xenonPcm },
];
const charts = [
  { type: 'strip', id: 'c-power', label: 'Power', series: [{ label: 'thermal %', color: 'ink', get: (s) => s.powerPct }, { label: 'electric %', color: 'steam', get: (s) => (100 * s.electricMW) / I.electric.v }], min: 0, max: 120, windowSec: 120, height: 40, span: 2 },
  { type: 'strip', id: 'c-temp', label: 'Coolant temperature', series: [{ label: 'outlet °C', color: 'hot', get: (s) => s.Tout }, { label: 'inlet °C', color: 'cold', get: (s) => s.Tin }], windowSec: 120, height: 40, span: 2 },
];

function build(ctx) {
  const M = ctx.mats;
  const detail = ctx.quality.detail;
  const seg = detail >= 0.9 ? 52 : detail >= 0.5 ? 40 : 28;
  const root = new THREE.Group();
  const add = (o) => (root.add(o), o);

  const containment = buildContainment(M, seg + 12);
  const basemat = buildBasemat(M, seg + 12);
  const rpv = buildRPV(M, seg);
  const head = buildHead(M, seg);
  const rcca = buildRCCA(M);
  const core = buildCore(M);
  const internals = buildInternals(M, seg);
  const asmDrill = buildAssemblyDrill(M);
  const rodDrill = buildRodDrill(M);
  const pelDrill = buildPelletDrill(M);
  const legs = buildLegs(M, seg, detail);
  const sgs = buildSteamGens(M, seg, detail);
  const rcps = buildRCPs(M, seg);
  const hot0 = new THREE.CatmullRomCurve3(hotPath(0), false, 'catmullrom', 0.3);
  const pzr = buildPressurizer(M, seg, hot0);
  const steam = buildSteamLines(M, seg);
  const turbine = buildTurbine(M, seg, detail);
  const condenser = buildCondenser(M, seg);
  const tower = buildTower(M, seg, detail);
  const circ = buildCirculating(M, seg);
  const grid = buildGrid(M, seg);

  // core flow particles (cold up through the core and warming) live with the core part
  const wrap = (o) => {
    const g = new THREE.Group();
    g.add(o);
    return g;
  };
  const cont = wrap(containment);
  const parts = [
    { id: 'containment', label: 'Containment building', group: 'Structure', object: cont, explodeOffset: [0, 30, 0], camera: { az: -40, el: 22 }, card: { title: 'Containment building', text: 'A steel-lined concrete shell, the last barrier around the reactor. A large dry containment is sized so that the steam from a burst primary pipe cannot push the pressure past what the walls can take.', facts: [f('Inner diameter', 'containmentID'), f('Primary loops inside', 'loops')] } },
    { id: 'basemat', label: 'Basemat & reactor cavity', group: 'Structure', object: wrap(basemat), explodeOffset: [0, 0, 0], camera: { az: -40, el: 30 }, card: { title: 'Basemat & reactor cavity', text: 'The foundation slab and the pedestal that carries the vessel. The pit under the vessel can be flooded to cool a damaged core from outside.', facts: [f('Vessel height', 'rpvHeight')] } },
    { id: 'rpv', label: 'Reactor pressure vessel', group: 'Reactor vessel', object: wrap(rpv), explodeOffset: [0, 0, 0], camera: { az: -40, el: 14 }, card: { title: 'Reactor pressure vessel', text: 'A forged low-alloy steel pot holding the core at 15.5 MPa. Four cold-water inlets and four hot-water outlets; the water enters, runs down between wall and core barrel, turns at the bottom and rises through the core.', facts: [f('Inner diameter', 'rpvID'), f('Height with head', 'rpvHeight'), f('Wall thickness', 'rpvWall'), f('Pressure', 'pressure'), f('Inlet', 'tin'), f('Outlet', 'tout')] } },
    { id: 'head', label: 'Vessel head & rod drives', group: 'Reactor vessel', object: wrap(head), explodeOffset: [0, 17, 0], camera: { az: -35, el: 22 }, card: { title: 'Vessel head & rod drives', text: 'The removable lid. Each of the 53 magnetic jack drives sits on its own housing; coils lift and lower the drive rod in small steps, and cutting their power drops the rods by gravity.', facts: [f('Rod drives', 'rcca'), f('Pressure', 'pressure')] } },
    { id: 'rcca', label: 'Control rod clusters', group: 'Reactor vessel', badge: '×53', object: rcca.object, explodeOffset: [0, 34, 0], camera: { az: -35, el: 20 }, card: { title: 'Control rod clusters (RCCA)', text: 'Each cluster is 24 slender rodlets joined by a spider and hung on one drive rod. Inserted, they absorb neutrons and cut the chain reaction; withdrawn, they leave the core. On SCRAM all 53 fall in about two seconds.', facts: [f('Clusters', 'rcca'), f('Rodlets per cluster', 'rodlets'), f('Absorber', 'absorber'), { label: 'Position (withdrawn)', live: (s) => fmt(s.rodPct, 1) + ' %' }, { label: 'Rod worth in use', live: (s) => fmt(s.rhoRodPcm, 0) + ' pcm' }] } },
    { id: 'internals', label: 'Core barrel & internals', group: 'Reactor vessel', object: wrap(internals), explodeOffset: [0, 16, 0], camera: { az: -40, el: 18 }, card: { title: 'Core barrel & internals', text: 'The barrel hangs inside the vessel and guides the water: down the outside, up through the core. Plates above and below locate every assembly; guide tubes shelter the control rods when they are withdrawn.', facts: [f('Fuel assemblies held', 'assemblies'), f('Active height', 'activeHeight')] } },
    { id: 'core', label: 'Core', group: 'Reactor vessel', badge: '×193', object: core.object, explodeOffset: [0, 10, 0], camera: { az: -40, el: 28 }, card: { title: 'Core: 193 fuel assemblies', text: 'Colour follows fuel temperature, hottest near the middle where the neutron flux peaks. The blue glow is Cherenkov light from fast electrons in the water and scales with power.', facts: [f('Assemblies', 'assemblies'), f('Fuel rods', 'fuelRods'), f('Active height', 'activeHeight'), f('Equivalent diameter', 'coreDiameter'), f('Assembly pitch', 'pitch'), f('Enrichment', 'enrichment'), { label: 'Mean fuel temperature', live: (s) => fmt(s.Tfuel, 0) + ' °C' }] } },
    { id: 'assembly', label: 'One 17 × 17 assembly', group: 'Reactor vessel', parent: 'core', reveal: 'isolate', noCut: true, object: asmDrill, camera: { az: -35, el: 42, fill: 0.7 }, card: { title: 'One fuel assembly (×6, truncated)', text: 'A slice of one assembly at six times life size. 264 fuel rods fill a 17 × 17 lattice; 24 guide tubes take control rods or burnable absorbers, and the centre tube holds a detector. Spacer grids keep the rods 12.6 mm apart.', facts: [f('Lattice', 'lattice'), f('Fuel rods', 'rodsPerAssembly'), f('Guide tubes', 'guideTubes'), f('Instrument tube', 'instrTube'), f('Rod diameter', 'rodOD')] } },
    { id: 'rod', label: 'One fuel rod', group: 'Reactor vessel', parent: 'core', reveal: 'isolate', noCut: true, object: rodDrill, camera: { az: -30, el: 14, fill: 0.6 }, card: { title: 'One fuel rod (×40, shortened)', text: 'A zirconium-alloy tube sealed with helium, holding a stack of ceramic uranium dioxide pellets and a spring over an empty plenum that collects fission gas. Cladding is opened here so the pellets show.', facts: [f('Rod diameter', 'rodOD'), f('Active length', 'activeHeight'), f('Pellet diameter', 'pelletD'), f('Pellet height', 'pelletH')] } },
    { id: 'pellet', label: 'One fuel pellet', group: 'Reactor vessel', parent: 'core', reveal: 'isolate', noCut: true, object: pelDrill.object, camera: { az: -25, el: 22, fill: 0.62 }, card: { title: 'One pellet (×300, one quarter cut away)', text: 'Sintered UO₂ ceramic. Heat is made inside it, so the centre is far hotter than the rim. Colour shows the live radial temperature, drawn from the model with a teaching profile.', facts: [f('Diameter', 'pelletD'), f('Height', 'pelletH'), f('Enrichment', 'enrichment'), { label: 'Surface (clad side)', live: (s) => fmt(s.Tavg + 60, 0) + ' °C' }, { label: 'Centreline (approx.)', live: (s) => fmt(s.Tavg + 60 + (s.Tfuel * 1.55 - s.Tavg - 60), 0) + ' °C' }] } },
    { id: 'rcp', label: 'Reactor coolant pumps', group: 'Primary circuit', badge: '×4', object: rcps.object, spread: rcps.groups.map((g, k) => ({ object: g, offset: radial(k).map((v) => v * 4) })), camera: { az: -35, el: 20 }, card: { title: 'Reactor coolant pumps (4)', text: 'One vertical motor-driven pump per loop pushes water through the core. The heavy flywheel on top keeps the pump turning for a while after a power loss so flow coasts down gently.', facts: [f('Total primary flow', 'flow'), { label: 'Pump speed', live: (s) => fmt(s.flowFrac * 100, 0) + ' %' }, { label: 'Flow now', live: (s) => fmt(s.flowKgs, 0) + ' kg/s' }] } },
    { id: 'legs', label: 'Hot & cold legs', group: 'Primary circuit', object: legs.object, spread: legs.groups.map((g, k) => ({ object: g, offset: radial(k).map((v) => v * 3) })), camera: { az: -35, el: 28 }, card: { title: 'Hot & cold legs', text: 'Primary piping, about 0.7 m inside. The hot leg runs from the vessel outlet to the steam generator; the cold leg returns through the pump. Pipe colour follows the live coolant temperature, and the dots move with pump flow.', facts: [f('Inlet', 'tin'), f('Outlet', 'tout'), f('Pressure', 'pressure'), { label: 'Hot leg', live: (s) => fmt(s.Tout, 1) + ' °C' }, { label: 'Cold leg', live: (s) => fmt(s.Tin, 1) + ' °C' }] } },
    { id: 'sg', label: 'Steam generators', group: 'Primary circuit', badge: '×4', object: sgs.object, spread: sgs.groups.map((g, k) => ({ object: g, offset: radial(k).map((v) => v * 6) })), camera: { az: -35, el: 20 }, card: { title: 'Steam generators (4)', text: 'Hot primary water flows up and back down thousands of U-shaped tubes; secondary water boils on the outside. The two circuits never mix. Tube colour shows the primary water cooling as it goes.', facts: [f('Height', 'sgHeight'), f('U-tubes each', 'sgTubes'), f('Secondary pressure', 'steamPressure'), f('Secondary temperature', 'steamTemp'), { label: 'Steam pressure now', live: (s) => fmt(s.steamPressure, 2) + ' MPa' }] } },
    { id: 'pzr', label: 'Pressurizer', group: 'Primary circuit', object: pzr.object, explodeOffset: [6, 0, 0], camera: { az: -35, el: 22 }, card: { title: 'Pressurizer', text: 'A tank of water and steam on one hot leg. Electric heaters raise the pressure, a spray from the cold leg lowers it, and the steam bubble absorbs swings in water volume as the coolant warms and cools.', facts: [f('Volume', 'pzrVolume'), f('Pressure', 'pressure'), { label: 'Level now', live: (s) => fmt(s.pzrLevel, 0) + ' %' }, { label: 'Pressure now', live: (s) => fmt(s.pressure, 2) + ' MPa' }] } },
    { id: 'steam', label: 'Main steam & feedwater', group: 'Secondary circuit', object: steam.object, explodeOffset: [0, 0, 0], camera: { az: -20, el: 18 }, card: { title: 'Main steam & feedwater', text: 'Steam leaves the four steam generators, merges into one header and passes through the containment wall to the turbine. Feedwater from the condenser returns by the lower pipe. Steam carries no reactor water.', facts: [f('Steam pressure', 'steamPressure'), f('Steam temperature', 'steamTemp'), { label: 'Steam raised', live: (s) => fmt(s.steamMW, 0) + ' MW' }] } },
    { id: 'turbine', label: 'Turbine-generator', group: 'Secondary circuit', object: turbine.object, explodeOffset: [10, 6, 0], camera: { az: -25, el: 18 }, card: { title: 'Turbine-generator', text: 'One high-pressure and two low-pressure turbine sections on one shaft with the generator and exciter. Here the shaft speed is drawn proportional to electric output so you can see it work; a real grid-connected machine turns at constant speed.', facts: [f('Electric output', 'electric'), { label: 'Output now', live: (s) => fmt(s.electricMW, 0) + ' MWe' }, { label: 'Efficiency', live: (s) => (s.steamMW > 1 ? fmt((100 * s.electricMW) / s.steamMW, 1) + ' %' : '—') }] } },
    { id: 'condenser', label: 'Condenser', group: 'Secondary circuit', object: condenser.object, explodeOffset: [10, 0, 0], camera: { az: -25, el: 22 }, card: { title: 'Condenser', text: 'Spent steam condenses on thousands of tubes cooled by river, sea or cooling-tower water. The vacuum this creates is what lets the turbine extract so much work; the water is pumped back to the steam generators.', facts: [{ label: 'Heat rejected', live: (s) => fmt(Math.max(0, s.steamMW - s.electricMW), 0) + ' MW' }] } },
    { id: 'grid', label: 'Generator output & grid', group: 'Secondary circuit', object: grid.object, explodeOffset: [0, 0, 14], camera: { az: -25, el: 20 }, card: { title: 'Generator output & grid', text: 'The generator feeds a step-up transformer, which raises the voltage for the transmission line. The orange pulses along the wires are drawn in proportion to the electric output; they stop when the turbine trips.', facts: [f('Electric output', 'electric'), { label: 'Output now', live: (s) => fmt(s.electricMW, 0) + ' MWe' }] } },
    { id: 'circ', label: 'Circulating water & pump house', group: 'Tertiary circuit', object: circ.object, explodeOffset: [14, 0, -10], camera: { az: -30, el: 28 }, card: { title: 'Circulating water & pump house', text: 'Large pumps push cool water from the tower basin through the condenser tubes. The water leaves warmer and rises to the top of the tower. This loop is separate from the steam and from the reactor water.', facts: [{ label: 'Heat carried', live: (s) => fmt(Math.max(0, s.steamMW - s.electricMW), 0) + ' MW' }] } },
    { id: 'tower', label: 'Cooling tower', group: 'Tertiary circuit', object: tower.object, explodeOffset: [20, 0, -20], cutOrigin: [140, 0, -130], fitPoints: [[140, 150 + 50, -130]], camera: { az: -35, el: 20, fill: 0.7 }, card: { title: 'Cooling tower', text: 'Warm water from the condenser is sprayed over a packing and falls in the tower while air rises through it. Part of the water evaporates and carries the heat away. The plume is clean water vapour, not smoke, and it never touches the reactor water. Plants on a coast or large river often skip the tower and use once-through cooling.', facts: [f('Tower height', 'towerHeight'), f('Base diameter', 'towerBaseD'), f('Throat diameter', 'towerThroatD'), { label: 'Heat rejected (thermal \u2212 electric)', live: (s) => fmt(Math.max(0, s.steamMW - s.electricMW), 0) + ' MW' }, { label: 'Share of reactor heat', live: (s) => (s.steamMW > 1 ? fmt((100 * Math.max(0, s.steamMW - s.electricMW)) / s.steamMW, 0) + ' %' : '\u2014') }] } },
  ];
  parts.forEach((p) => root.add(p.object));

  const pelletState = { key: '' };
  let rodLast = -1;
  function update(state, t, dt) {
    if (rodLast !== state.rodPos) {
      rcca.setPos(state.rodPos);
      rodLast = state.rodPos;
    }
    core.update(state, M, t);
    legs.update(state, dt, M);
    sgs.update(state, dt, M);
    rcps.update(state, dt);
    pzr.update(state);
    steam.update(state, dt);
    turbine.update(state, dt);
    circ.update(state, dt);
    tower.update(state, dt);
    grid.update(state, dt);
    const k = Math.round(state.Tfuel / 3) + ':' + Math.round(state.Tavg / 2);
    if (pelletState.key !== k) {
      pelletState.key = k;
      pelDrill.paint(state, M);
    }
  }
  return {
    root,
    parts,
    update,
    cutOrigin: [0, 0, 0],
    cutAngle: 310,
    defaultMode: 'cutaway',
    defaultView: { az: -40, el: 22 },
    // default fit = the power block only; the tower is a backdrop. 'site' fits everything including the plume.
    defaultFill: 0.84,
    defaultFit: ['containment', 'basemat', 'rpv', 'head', 'rcca', 'internals', 'core', 'rcp', 'legs', 'sg', 'pzr', 'steam', 'turbine', 'condenser', 'grid'],
    presets: { iso: { az: -40, el: 22 }, front: { az: 0, el: 6 }, side: { az: -90, el: 8 }, top: { az: -40, el: 78 }, site: { az: -40, el: 24, fit: 'all' } },
    info: { assemblies: 193, rcca: 53, sgTubesDrawn: sgs.tubes },
  };
}

export default {
  id: 'pwr',
  tab: 'uranium',
  title: 'Pressurised water reactor',
  short: 'PWR',
  spec,
  createModel,
  controls,
  gauges,
  charts,
  build,
  atom,
  tour,
  sources: [
    'Westinghouse 4-loop PWR design data: typical FSAR values and the US NRC Westinghouse Technology Systems manual.',
    'Steam saturation table: IAPWS-IF97.',
    'Delayed-neutron data: Keepin, U-235 thermal six-group set.',
    'Decay heat: Way-Wigner correlation (fitted to six exponentials).',
    'Nuclear data: ENDF/B-VIII, ENSDF.',
  ],
  modelNote: 'Point kinetics with six delayed-neutron groups, fuel and coolant thermal lumps, a steam-generator heat sink that follows turbine load, decay heat and xenon-135.',
  properNames: ['Westinghouse 4-loop PWR'],
  sourceLabels: SOURCES,
  tripReasons: ['Manual SCRAM', 'Overpower trip (> 118 %)', 'Short-period trip (< 3 s)', 'High outlet temperature (> 345 \u00b0C)'],
};
void fmtSci;
