// ORNL Molten-Salt Breeder Reactor (MSBR) - the Thorium tab. Implements CONTRACT.md.
import * as THREE from 'three';
import { spec, SOURCES } from './spec.js';
import { createModel } from './model.js';
import { atom } from './atom.js';
import { tour } from './tour.js';
import { fmt } from '../../kit/util.js';
import { t } from '../../kit/i18n.js';
import { G, radial, paintSalt } from './common.js';
import { buildVessel, buildHead, buildCore, buildRods, buildElementDrill } from './plant.js';
import { buildPumps, buildPiping, buildHX, buildCoolant, buildSG } from './loops.js';
import { buildPlug, buildTank, buildOffgas, buildChem, buildSideStream, buildTurbine, buildCondenser, buildTower, buildGrid } from './aux.js';

const I = spec.items;
const f = (label, key) => ({ label, spec: key });

const controls = [
  { type: 'slider', id: 'rods', label: 'Control rods', unit: '% withdrawn', min: 0, max: 100, step: 0.5, decimals: 1, key: 'rods', scale: 100, mark: 85, hint: 'Four rods. In normal running they stay put: the salt temperature does the regulating.' },
  { type: 'slider', id: 'flow', label: 'Fuel-salt pumps', unit: '% speed', min: 5, max: 110, step: 1, key: 'flow', scale: 100, mark: 100, hint: 'Slower pumps keep more delayed-neutron precursors in the core.' },
  { type: 'slider', id: 'load', label: 'Turbine load', unit: '%', min: 0, max: 110, step: 1, key: 'load', scale: 100, mark: 100, hint: 'Steam demand. Watch the power follow it with the rods untouched.' },
  { type: 'button', id: 'scram', label: 'SCRAM', kind: 'danger', hotkey: 'x', press: (m) => m.scram('Manual SCRAM'), hint: 'Drop all control rods now.' },
  { type: 'button', id: 'reset', label: 'Reset', hotkey: 'r', press: (m) => m.resetTrip(), disabled: (s) => !s.scrammed, hint: 'Re-arm the protection system. Turbine load returns to 5 %; withdraw the rods, then raise the load.' },
  { type: 'button', id: 'drain', label: 'DRAIN', kind: 'danger', hotkey: 'd', press: (m) => m.drain(), disabled: (s) => !['ready', 'filling', 'freezing'].includes(s.drainMode), hint: 'Cut the cooling to the freeze plug. It thaws and the fuel runs by gravity into the drain tank.' },
  { type: 'button', id: 'refill', label: 'REFILL', hotkey: 'f', press: (m) => m.refill(), disabled: (s) => s.level >= 1 || s.drainMode === 'filling' || s.drainMode === 'freezing', hint: 'Push the salt back from the drain tank, then refreeze the plug.' },
  { type: 'toggle', id: 'strip', label: 'Off-gas stripping', get: (m) => !!m.controls.strip, set: (m, v) => m.setControl('strip', v ? 1 : 0) },
  { type: 'toggle', id: 'pa', label: 'Pa-233 removal', get: (m) => !!m.controls.paOn, set: (m, v) => m.setControl('paOn', v ? 1 : 0) },
];

const gauges = [
  { type: 'dial', id: 'power', label: 'Thermal power', unit: '% of full', min: 0, max: 120, mark: 100, zones: [{ from: 105, to: 118, kind: 'warn' }, { from: 118, to: 120, kind: 'alarm' }], get: (s) => s.powerPct },
  { type: 'dial', id: 'tout', label: 'Core outlet', unit: '°C', min: 450, max: 800, mark: I.tout.v, zones: [{ from: 750, to: 764, kind: 'warn' }, { from: 764, to: 800, kind: 'alarm' }], get: (s) => s.Tout },
  { type: 'dial', id: 'tin', label: 'Core inlet', unit: '°C', min: 450, max: 750, mark: I.tin.v, zones: [{ from: 450, to: I.liquidus.v, kind: 'alarm' }, { from: I.liquidus.v, to: 520, kind: 'warn' }], get: (s) => s.Tin },
  { type: 'dial', id: 'level', label: 'Salt in circuit', unit: '%', min: 0, max: 100, mark: 100, zones: [{ from: 0, to: 99, kind: 'warn' }], get: (s) => s.levelPct },
  { type: 'readout', id: 'mwe', label: 'Electric output', unit: 'MWe', get: (s) => s.electricMW },
  { type: 'readout', id: 'rho', label: 'Reactivity', unit: 'pcm', get: (s) => s.rhoPcm, format: (v) => (v > 0 ? '+' : '') + fmt(v, 0) },
  { type: 'readout', id: 'beta', label: 'β_eff in core', unit: '× 10⁻³', get: (s) => s.betaCore * 1000, decimals: 2 },
  { type: 'readout', id: 'xe', label: 'Xenon-135 worth', unit: 'pcm', get: (s) => s.xenonPcm },
  { type: 'readout', id: 'pa', label: 'Pa-233 held up', unit: 'kg', get: (s) => s.paKg, decimals: 1 },
  { type: 'readout', id: 'net', label: 'U-233 net gain', unit: 'kg/day', get: (s) => s.netKgDay, decimals: 3, format: (v) => (v > 0 ? '+' : '') + fmt(v, 3) },
];
const charts = [
  { type: 'strip', id: 'c-power', label: 'Load following', series: [{ label: 'thermal %', color: 'ink', get: (s) => s.powerPct }, { label: 'electric %', color: 'steam', get: (s) => (100 * s.electricMW) / I.electric.v }, { label: 'rods %', color: 'muted', get: (s) => s.rodPct }], min: 0, max: 120, windowSec: 120, height: 40, span: 2 },
  { type: 'strip', id: 'c-temp', label: 'Salt temperature', series: [{ label: 'outlet °C', color: 'hot', get: (s) => s.Tout }, { label: 'inlet °C', color: 'cold', get: (s) => s.Tin }, { label: 'graphite °C', color: 'muted', get: (s) => s.Tgraphite }], windowSec: 120, height: 40, span: 2 },
];

function build(ctx) {
  const M = ctx.mats;
  const detail = ctx.quality.detail;
  const seg = detail >= 0.9 ? 64 : detail >= 0.5 ? 44 : 30;
  const root = new THREE.Group();

  const levelPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), G.saltTop);
  const vessel = buildVessel(M, seg, levelPlane);
  const head = buildHead(M, seg);
  const core = buildCore(M, detail);
  const rods = buildRods(M);
  const elem = buildElementDrill(M);
  const pumps = buildPumps(M, seg);
  const piping = buildPiping(M, seg, detail);
  const hx = buildHX(M, seg, detail);
  const coolant = buildCoolant(M, seg, detail);
  const sg = buildSG(M, seg, detail);
  const plug = buildPlug(M);
  const tank = buildTank(M, seg);
  const offgas = buildOffgas(M, seg, detail);
  const chem = buildChem(M, seg);
  const side = buildSideStream(M);
  piping.object.add(side.object);
  const turbine = buildTurbine(M, seg, detail);
  const condenser = buildCondenser(M, seg);
  const tower = buildTower(M, seg);
  const grid = buildGrid(M, seg);

  // in-vessel salt circulation: down the annulus, under the core, up through the channels, out at the top
  const wrap = (o) => {
    const g = new THREE.Group();
    g.add(o);
    return g;
  };

  const parts = [
    { id: 'vessel', label: 'Reactor vessel', group: 'Reactor', object: vessel.object, explodeOffset: [0, 0, 0], camera: { az: -45, el: 16 }, card: { title: 'Reactor vessel', text: 'A Hastelloy N pot holding the graphite core and the circulating fuel salt. The salt enters at the top, runs down the gap around the core, turns under it and rises through the channels. The vessel is not pressurised, so a break leaks salt rather than flashing steam.', facts: [f('Inner diameter', 'vesselID'), f('Height', 'vesselHeight'), f('Alloy', 'vesselMaterial'), f('Pressure', 'pressure'), f('Inlet', 'tin'), f('Outlet', 'tout'), { label: 'Salt in the circuit', live: (s) => fmt(s.levelPct, 0) + ' %' }] } },
    { id: 'vhead', label: 'Vessel head & rod drives', group: 'Reactor', object: wrap(head), explodeOffset: [0, 11, 0], camera: { az: -40, el: 24 }, card: { title: 'Vessel head & rod drives', text: 'The removable lid, with four drive housings for the control rods. Above the salt there is a cover gas of helium, where fission gases collect.', facts: [f('Control rods', 'rods'), f('Vessel alloy', 'vesselMaterial')] } },
    { id: 'core', label: 'Graphite moderator core', group: 'Reactor', badge: '×1412', object: core.object, explodeOffset: [0, 10, 0], camera: { az: -45, el: 24 }, card: { title: 'Graphite moderator core', text: 'Square graphite elements slow the neutrons. Salt runs up the gaps between them: about 13 % of the central zone and 37 % of the outer zone is salt, so the outer zone moderates less and the power is spread flatter. Graphite colour follows its temperature; it heats slowly and gives a small positive coefficient.', facts: [f('Elements', 'elements'), f('Element width', 'elementWidth'), f('Core diameter', 'coreDiameter'), f('Core height', 'coreHeight'), f('Salt, central zone', 'saltFracCentral'), f('Salt, outer zone', 'saltFracOuter'), f('Graphite coefficient', 'alphaGraphite'), { label: 'Graphite now', live: (s) => fmt(s.Tgraphite, 0) + ' °C' }] } },
    { id: 'element', label: 'One graphite element', group: 'Reactor', parent: 'core', reveal: 'isolate', noCut: true, object: elem.object, camera: { az: -35, el: 40, fill: 0.7 }, card: { title: 'Graphite elements (×7, shortened)', text: 'A 3 × 3 block at seven times life size. Each element is a square graphite bar; the gaps between neighbours are the channels where the fuel salt flows and fissions. Colour of the salt follows the live temperature.', facts: [f('Element width', 'elementWidth'), f('Salt, central zone', 'saltFracCentral'), f('Salt, outer zone', 'saltFracOuter'), { label: 'Salt now', live: (s) => fmt(s.Tavg, 0) + ' °C' }] } },
    { id: 'rods', label: 'Control rods', group: 'Reactor', badge: '×4', object: rods.object, explodeOffset: [0, 14, 0], camera: { az: -35, el: 20 }, card: { title: 'Control rods', text: 'Only four, because the salt itself does most of the regulating. The rods set the average salt temperature and shut the chain reaction down on a SCRAM; they do not follow the load.', facts: [f('Rods', 'rods'), { label: 'Position (withdrawn)', live: (s) => fmt(s.rodPct, 1) + ' %' }, { label: 'Rod worth in use', live: (s) => fmt(s.rhoRodPcm, 0) + ' pcm' }, { label: 'Salt feedback', live: (s) => fmt(s.rhoSaltPcm, 0) + ' pcm' }] } },
    { id: 'pumps', label: 'Fuel-salt pumps', group: 'Fuel-salt circuit', badge: '×4', object: pumps.object, spread: pumps.groups.map((g, k) => ({ object: g, offset: radial(k).map((v) => v * 4) })), camera: { az: -40, el: 20 }, card: { title: 'Fuel-salt pumps (4)', text: 'A vertical pump per loop, with a bowl where the salt has a free surface and helium bubbles are stripped out. Pump speed is a control: slowing it lets more delayed-neutron precursors decay inside the core, which adds a little reactivity.', facts: [f('Pumps', 'pumps'), f('Salt flow', 'flow'), { label: 'Speed', live: (s) => fmt(s.flowFrac * 100, 0) + ' %' }, { label: 'Flow now', live: (s) => fmt(s.flowKgs, 0) + ' kg/s' }, { label: 'Delayed fraction lost to loop', live: (s) => fmt(s.betaLostPct, 0) + ' %' }] } },
    { id: 'piping', label: 'Fuel-salt piping', group: 'Fuel-salt circuit', object: piping.object, spread: piping.groups.map((g, k) => ({ object: g, offset: radial(k).map((v) => v * 5.5) })), camera: { az: -40, el: 28 }, card: { title: 'Fuel-salt piping', text: 'Hot salt leaves the top of the vessel, passes through a pump to a heat exchanger and returns cooler. Pipe colour and the moving dots follow the live salt temperature and flow.', facts: [f('Inlet', 'tin'), f('Outlet', 'tout'), f('Pressure', 'pressure'), { label: 'Hot side', live: (s) => fmt(s.Tout, 1) + ' °C' }, { label: 'Cold side', live: (s) => fmt(s.Tin, 1) + ' °C' }] } },
    { id: 'hx', label: 'Primary heat exchangers', group: 'Fuel-salt circuit', badge: '×4', object: hx.object, spread: hx.groups.map((g, k) => ({ object: g, offset: radial(k).map((v) => v * 8) })), camera: { az: -40, el: 20 }, card: { title: 'Primary heat exchangers (4)', text: 'Fuel salt on the shell side hands its heat to a separate coolant salt inside the tubes. The extra loop keeps radioactive fuel salt out of the steam plant and puts a barrier between the fuel and water.', facts: [f('Units', 'hx'), f('Fuel salt in', 'tout'), f('Fuel salt out', 'tin'), f('Coolant salt', 'coolantSalt'), f('Coolant in', 'coolantIn'), f('Coolant out', 'coolantOut')] } },
    { id: 'coolant', label: 'Coolant-salt loop', group: 'Power conversion', object: coolant.object, explodeOffset: [0, 9, 0], camera: { az: -40, el: 30 }, card: { title: 'Coolant-salt loop', text: 'A non-radioactive salt carries the heat from the four heat exchangers to the steam generator and back. Its freezing point is below the fuel salt\'s, so a cold coolant can freeze fuel salt in the exchanger: the freezing margin is a real design limit.', facts: [f('Coolant salt', 'coolantSalt'), { label: 'Coolant in', live: (s) => fmt(s.coolantIn, 0) + ' °C' }, { label: 'Coolant out', live: (s) => fmt(s.coolantOut, 0) + ' °C' }, f('Fuel-salt freezing point', 'liquidus'), { label: 'Margin at core inlet', live: (s) => fmt(s.freezeMargin, 0) + ' K' }] } },
    { id: 'sg', label: 'Steam generator', group: 'Power conversion', object: sg.object, explodeOffset: [8, 0, 0], camera: { az: -35, el: 18 }, card: { title: 'Steam generator', text: 'Hot coolant salt flows around tubes of water that turns to supercritical steam: above the critical point there is no boiling, only a smooth change from water to steam. Tube colour shows the water heating along the length.', facts: [f('Steam temperature', 'steamTemp'), f('Steam pressure', 'steamPressure'), { label: 'Steam raised', live: (s) => fmt(s.steamMW, 0) + ' MW' }] } },
    { id: 'turbine', label: 'Turbine-generator', group: 'Power conversion', object: turbine.object, explodeOffset: [0, 7, 0], camera: { az: -25, el: 20 }, card: { title: 'Turbine-generator', text: 'High-pressure and low-pressure turbine sections on one shaft with the generator. The casing is cut open to show the blades. Shaft speed is drawn proportional to electric output so you can see it work; a real grid-connected machine turns at constant speed.', facts: [f('Net electric output', 'electric'), { label: 'Output now', live: (s) => fmt(s.electricMW, 0) + ' MWe' }, { label: 'Efficiency', live: (s) => (s.steamMW > 1 && s.electricMW > 0 ? fmt((100 * s.electricMW) / s.steamMW, 1) + ' %' : '—') }] } },
    { id: 'grid', label: 'Generator output & grid', group: 'Power conversion', object: grid.object, explodeOffset: [0, 4, -6], camera: { az: -30, el: 18 }, card: { title: 'Generator output & grid', text: 'The generator feeds a step-up transformer and a transmission line. Pulses on the conductors run faster and thicker as electric output rises, and stop when the turbine is tripped.', facts: [f('Net electric output', 'electric'), { label: 'Output now', live: (s) => fmt(s.gridMW, 0) + ' MWe' }] } },
    { id: 'condenser', label: 'Condenser', group: 'Heat rejection', object: condenser.object, explodeOffset: [0, 0, -7], camera: { az: -30, el: 24 }, card: { title: 'Condenser & circulating water', text: 'Exhaust steam condenses on tubes cooled by circulating water. The water is a separate loop that goes to the cooling tower. It never touches the salt or the steam.', facts: [f('Net electric output', 'electric'), { label: 'Heat rejected', live: (s) => fmt(s.rejectedMW, 0) + ' MW' }] } },
    { id: 'tower', label: 'Cooling tower', group: 'Heat rejection', object: tower.object, explodeOffset: [9, 0, 0], camera: { az: -35, el: 14 }, card: { title: 'Cooling tower (generic)', text: 'Warm circulating water is sprayed over fill and cooled by evaporation; the plume is clean water vapour. A generic arrangement: the MSBR was a paper design, so its heat-rejection plant was never built. At about 44 % efficiency it rejects less heat per unit of electricity than a water reactor at about a third.', facts: [f('Thermal power', 'thermal'), f('Net electric output', 'electric'), { label: 'Heat to the tower', live: (s) => fmt(s.rejectedMW, 0) + ' MW' }, { label: 'Efficiency now', live: (s) => (s.steamMW > 1 && s.electricMW > 0 ? fmt((100 * s.electricMW) / s.thermalMW, 1) + ' %' : '—') }] } },
    { id: 'plug', label: 'Freeze plug', group: 'Safety', object: plug.object, explodeOffset: [0, 0, 0], camera: { az: -40, el: 14, fill: 0.5 }, card: { title: 'Freeze plug', text: 'A short section of the drain line is kept below the salt\'s freezing point by cooling air, so a plug of solid salt seals it. Lose the cooling (or press DRAIN) and the plug warms and melts, and the fuel drains by gravity. Nothing has to be switched on to make it work.', facts: [f('Fuel-salt freezing point', 'liquidus'), f('Thaw time (model)', 'plugThaw'), f('Drain time (model)', 'drainTime'), { label: 'Plug now', live: (s) => fmt(s.plugT, 0) + ' °C, ' + t(s.plugFrozen ? 'frozen' : 'molten') }, { label: 'State', live: (s) => t(s.drainMode) }] } },
    { id: 'tank', label: 'Drain tank', group: 'Safety', object: tank.object, explodeOffset: [0, 0, -14], camera: { az: -40, el: 20 }, card: { title: 'Drain tank', text: 'A long, narrow tank, with no graphite, that holds all the fuel salt. Its shape and the missing moderator make a chain reaction impossible. Decay heat is carried off by cooling tubes hanging in the salt. The model compresses the drain and refill times; a real thaw takes longer.', facts: [f('Salt volume', 'saltVolume'), { label: 'Salt in tank', live: (s) => fmt(s.tankVolume, 1) + ' m³' }, { label: 'Tank salt', live: (s) => fmt(s.tankT, 0) + ' °C' }, { label: 'Decay heat in tank', live: (s) => fmt(s.tankMW, 1) + ' MW' }] } },
    { id: 'offgas', label: 'Off-gas system', group: 'Processing', object: offgas.object, explodeOffset: [0, 6, 0], camera: { az: -35, el: 24, fill: 0.9 }, card: { title: 'Off-gas system', text: 'Helium is bubbled through the salt in the pump bowls. Xenon-135 and krypton, which hardly dissolve, leave with the bubbles and go to delay beds. The PWR page shows what xenon does when it is not removed: switch stripping off and watch the reactor stall.', facts: [{ label: 'Stripping', live: (s) => t(s.stripOn ? 'on' : 'off') }, { label: 'Xenon-135 worth', live: (s) => fmt(s.xenonPcm, 0) + ' pcm' }] } },
    { id: 'chem', label: 'Chemical processing', group: 'Processing', object: chem.object, explodeOffset: [-8, 0, -4], camera: { az: -25, el: 22 }, card: { title: 'Chemical processing & Pa-233 decay tank', text: 'A small side stream of salt is processed continuously. Protactinium-233 is removed and held in a tank for several half-lives, so it decays to U-233 instead of capturing neutrons; the U-233 goes back to the core. The green bar shows the Pa-233 held up. The doubling time is compound, with the 80 % plant factor the design assumed.', facts: [f('Processing cycle', 'processDays'), f('Th-233 half-life', 'halfTh233'), f('Pa-233 half-life', 'halfPa233'), { label: 'Pa-233 in the tank', live: (s) => fmt(s.paTankKg, 1) + ' kg' }, { label: 'Pa-233 in the core', live: (s) => fmt(s.paCoreKg, 1) + ' kg' }, f('Breeding ratio (design)', 'breeding'), { label: 'Breeding ratio now', live: (s) => fmt(s.breedingNow, 3) }, { label: 'U-233 inventory', live: (s) => fmt(s.u233Kg, 1) + ' kg' }, f('Doubling time (design)', 'doubling'), f('Plant factor assumed for doubling time', 'plantFactor'), { label: 'Doubling time now', live: (s) => (isFinite(s.doublingYears) ? fmt(s.doublingYears, 1) + ' years' : '—') }] } },
  ];
  parts.forEach((p) => root.add(p.object));

  let rodLast = -1;
  let lastTime = -1;
  let tel = 0;
  function update(state, t, dt) {
    const run = state.time !== lastTime;
    lastTime = state.time;
    const d = run ? dt : 0;
    if (run) tel += dt;
    if (rodLast !== state.rodPos) {
      rods.setPos(state.rodPos);
      rodLast = state.rodPos;
    }
    levelPlane.constant = G.saltBot + (G.saltTop - G.saltBot) * state.level + 0.001;
    paintSalt(vessel.salt, state.Tavg, 0.5);
    core.update(state, d);
    paintSalt(elem.mat, state.Tavg, 0.6);
    pumps.update(state, d);
    piping.update(state, d, M);
    hx.update(state, d, M);
    coolant.update(state, d, M);
    sg.update(state, d, M);
    plug.update(state, d);
    tank.update(state, d);
    offgas.update(state, d);
    chem.update(state, d);
    side.update(state, d);
    turbine.update(state, d);
    condenser.update(state, d);
    tower.update(state, d);
    grid.update(state, d);
    void tel;
  }
  return {
    root,
    parts,
    update,
    defaultFit: ['vessel', 'core', 'plug', 'tank', 'pumps', 'hx'],
    defaultFill: 0.84,
    cutOrigin: [0, 0, 0],
    cutAngle: 345,
    defaultMode: 'cutaway',
    defaultView: { az: -30, el: 24 },
    presets: { site: { az: -30, el: 24, fit: 'all' }, iso: { az: -30, el: 24 }, front: { az: 0, el: 8 }, side: { az: 90, el: 8 }, top: { az: -30, el: 78 } },
    info: { elements: core.count },
  };
}

export default {
  id: 'msr',
  tab: 'thorium',
  title: 'Molten-salt breeder reactor',
  short: 'MSBR',
  spec,
  createModel,
  controls,
  gauges,
  charts,
  build,
  atom,
  tour,
  sources: [
    'ORNL-4541, Conceptual Design Study of a Single-Fluid Molten-Salt Breeder Reactor (1971). A paper design: it was never built.',
    'Molten-Salt Reactor Experiment (MSRE), Oak Ridge: 7.4 MWt, critical in 1965, first reactor to run on U-233 in 1968, shut down in 1969.',
    'Nuclear data: ENDF/B-VIII, ENSDF. Kinetics, drain, xenon and Pa-233 ledger are teaching models.',
  ],
  sourceLabels: SOURCES,
  modelNote: 'Point kinetics with delayed-neutron precursors carried around the loop, thermal lumps for the salt and the graphite, a load-following heat sink, xenon with off-gas stripping, a Pa-233 and U-233 ledger and a freeze-plug drain. It leaves out spatial flux, the real salt chemistry, the secondary and steam dynamics, and the detailed drain-tank cooling.',
  properNames: ['ORNL', 'MSBR', 'MSRE', 'Hastelloy N', 'NaBF₄-NaF'],
  tripReasons: ['Manual SCRAM', 'Freeze plug thawed: fuel draining', 'Overpower trip (> 118 %)', 'Short-period trip (< 3 s)', 'High outlet temperature (> 764 °C)'],
};
