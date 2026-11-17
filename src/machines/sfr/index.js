// BN-800 (Beloyarsk 4) sodium-cooled fast breeder: the Plutonium tab.
import * as THREE from 'three';
import { spec, SOURCES } from './spec.js';
import { createModel, TRIP_DTOUT } from './model.js';
import { atom } from './atom.js';
import { tour } from './tour.js';
import { fmt } from '../../kit/util.js';
import { G, polar, radialDir } from './geo.js';
import { buildPit, buildVessel, buildPool, buildCore, buildBlanket, buildRods, buildPlug, buildAssemblyDrill, buildPinDrill } from './reactor.js';
import { primaryPaths, buildPumps, buildIHX, buildSecondary, buildSteamGens, buildTurbine, buildCooling, buildGrid } from './loops.js';

const I = spec.items;
const f = (label, key) => ({ label, spec: key });

const controls = [
  { type: 'slider', id: 'rods', label: 'Control rods', unit: '% withdrawn', min: 0, max: 100, step: 0.5, decimals: 1, key: 'rods', scale: 100, mark: 88, hint: 'Rod position. Lower means more neutron absorption.' },
  { type: 'slider', id: 'flow', label: 'Primary pumps', unit: '% speed', min: 5, max: 110, step: 1, key: 'flow', scale: 100, mark: 100, hint: 'Speed of the three primary sodium pumps.' },
  { type: 'button', id: 'scram', label: 'SCRAM', kind: 'danger', hotkey: 'x', press: (m) => m.scram('Manual SCRAM'), hint: 'Drop every control rod now.' },
  { type: 'button', id: 'reset', label: 'Reset trip', hotkey: 'r', press: (m) => m.resetTrip(), disabled: (s) => !s.scrammed, hint: 'Re-arm the protection system. Rods stay in until you withdraw them.' },
];

const gauges = [
  { type: 'dial', id: 'power', label: 'Thermal power', unit: '% of full', min: 0, max: 120, mark: 100, zones: [{ from: 105, to: 118, kind: 'warn' }, { from: 118, to: 120, kind: 'alarm' }], get: (s) => s.powerPct },
  { type: 'dial', id: 'tout', label: 'Core outlet', unit: '°C', min: 300, max: 700, mark: I.tout.v, zones: [{ from: I.tout.v + 35, to: I.tout.v + TRIP_DTOUT, kind: 'warn' }, { from: I.tout.v + TRIP_DTOUT, to: 700, kind: 'alarm' }], get: (s) => s.Tout },
  { type: 'dial', id: 'tin', label: 'Core inlet', unit: '°C', min: 300, max: 400, mark: I.tin.v, get: (s) => s.Tin },
  { type: 'dial', id: 'rhod', label: 'Reactivity', unit: '$', min: -1, max: 1, mark: 0, decimals: 2, zones: [{ from: 0.5, to: 0.8, kind: 'warn' }, { from: 0.8, to: 1, kind: 'alarm' }], get: (s) => Math.max(-1, Math.min(1, s.rhoDollar)) },
  { type: 'readout', id: 'mwe', label: 'Electric output', unit: 'MWe', get: (s) => s.electricMW },
  { type: 'readout', id: 'flowk', label: 'Primary flow', unit: 'kg/s', get: (s) => s.flowKgs },
  { type: 'readout', id: 'rho', label: 'Reactivity', unit: 'pcm', get: (s) => s.rhoPcm, format: (v) => (v > 0 ? '+' : '') + fmt(v, 0) },
  { type: 'readout', id: 'margin', label: 'Margin to boiling', unit: 'K', get: (s) => s.marginK },
  { type: 'readout', id: 'burn', label: 'Pu burned', unit: 'kg/day', decimals: 2, get: (s) => s.burnedKgDay },
  { type: 'readout', id: 'bred', label: 'Pu bred', unit: 'kg/day', decimals: 2, get: (s) => s.bredKgDay },
];
const charts = [
  { type: 'strip', id: 'c-power', label: 'Power', series: [{ label: 'thermal %', color: 'ink', get: (s) => s.powerPct }, { label: 'electric %', color: 'steam', get: (s) => (100 * s.electricMW) / I.electric.v }], min: 0, max: 120, windowSec: 120, height: 52, span: 2 },
  { type: 'strip', id: 'c-temp', label: 'Sodium temperature', series: [{ label: 'outlet °C', color: 'hot', get: (s) => s.Tout }, { label: 'inlet °C', color: 'cold', get: (s) => s.Tin }], windowSec: 120, height: 52, span: 2 },
];

function build(ctx) {
  const M = ctx.mats;
  const detail = ctx.quality.detail;
  const seg = detail >= 0.9 ? 72 : detail >= 0.5 ? 48 : 32;
  const root = new THREE.Group();
  const wrap = (o) => {
    const g = new THREE.Group();
    g.add(o);
    return g;
  };
  const pit = buildPit(M, seg);
  const vessel = buildVessel(M, seg);
  const pool = buildPool(M, seg, primaryPaths());
  const core = buildCore(M);
  const blanket = buildBlanket(M);
  const rods = buildRods(M);
  const plug = buildPlug(M, seg);
  const pumps = buildPumps(M, seg);
  const ihx = buildIHX(M, seg);
  const sec = buildSecondary(M, seg);
  const sgs = buildSteamGens(M, seg);
  const turbine = buildTurbine(M, seg, detail);
  const cooling = buildCooling(M, seg);
  const grid = buildGrid(M, seg);
  const asm = buildAssemblyDrill(M);
  const pin = buildPinDrill(M);

  const tangentOut = (k) => {
    const a = G.loopAng[k];
    return polar(12, a + 35, 0).sub(polar(G.pumpR, a, 0)).toArray();
  };
  const radialOut = (k, j, d) => radialDir(G.loopAng[k] + (j ? G.ihxSplit : -G.ihxSplit)).map((v) => v * d);

  const parts = [
    { id: 'pit', label: 'Reactor pit & basemat', group: 'Reactor block', object: wrap(pit), explodeOffset: [0, 0, 0], camera: { az: -40, el: 24 }, card: { title: 'Reactor pit & biological shield', text: 'A thick concrete pit holds the main vessel and its guard vessel. The walls stop neutrons and gamma rays from reaching the hall, and the pit would hold sodium if both vessels leaked.', facts: [f('Vessel diameter', 'vesselD'), f('Vessel height', 'vesselH')] } },
    { id: 'vessel', label: 'Pool vessel & guard vessel', group: 'Reactor block', object: wrap(vessel), explodeOffset: [0, 0, 0], camera: { az: -40, el: 20 }, card: { title: 'Pool vessel & guard vessel', text: 'One steel tank holds the whole primary circuit: core, pumps, heat exchangers and hundreds of tonnes of sodium. A slightly larger guard vessel around it catches any leak, so the core always stays covered. An inner shell separates the hot pool from the cold pool.', facts: [f('Vessel diameter', 'vesselD'), f('Vessel height', 'vesselH'), f('Sodium inventory', 'naInventory'), f('Cover gas pressure', 'pressure'), f('Cover gas', 'coverGas')] } },
    { id: 'pool', label: 'Sodium pool & cover gas', group: 'Reactor block', object: pool.object, explodeOffset: [0, 0, 0], camera: { az: -40, el: 16 }, card: { title: 'Sodium pool & cover gas', text: 'Sodium is opaque, so the pools are drawn as tinted volumes. Sodium leaves the core into the hot pool, runs down through the heat exchangers into the cold pool, and the pumps push it back under the core. The free surface sits under argon at about atmospheric pressure, far below the boiling point.', facts: [f('Core inlet', 'tin'), f('Core outlet', 'tout'), f('Melting point', 'naMelt'), f('Boiling point', 'naBoil'), { label: 'Hot pool now', live: (s) => fmt(s.Tout, 0) + ' °C' }, { label: 'Cold pool now', live: (s) => fmt(s.Tin, 0) + ' °C' }, { label: 'Margin to boiling', live: (s) => fmt(s.marginK, 0) + ' K' }] } },
    { id: 'core', label: 'Core', group: 'Reactor core', badge: '×565', object: core.object, explodeOffset: [0, 13, 0], camera: { az: -40, el: 28 }, card: { title: 'Core: hexagonal MOX assemblies', text: 'There is no moderator, so neutrons stay fast and the core is small and dense. Wrapper tint marks the three enrichment zones, inner to outer. The band at fuel height shows live fuel temperature, hottest in the middle.', facts: [f('Fuel assemblies', 'assemblies'), f('Inner zone', 'zone1'), f('Middle zone', 'zone2'), f('Outer zone', 'zone3'), f('Active height', 'activeHeight'), f('Equivalent diameter', 'coreDiameter'), f('Pitch', 'pitch'), f('Plutonium', 'puFraction'), { label: 'Mean fuel temperature', live: (s) => fmt(s.Tfuel, 0) + ' °C' }] } },
    { id: 'assembly', label: 'One hexagonal assembly', group: 'Reactor core', parent: 'core', reveal: 'isolate', noCut: true, object: asm, camera: { az: -35, el: 36, fill: 0.7 }, card: { title: 'One fuel assembly (×14, truncated)', text: 'A hexagonal steel wrapper holds a bundle of fuel pins. A thin wire wound round each pin keeps them apart and mixes the sodium that flows up between them. A slice at fourteen times life size is shown.', facts: [f('Pins per assembly', 'pinsPerAssembly'), f('Width across flats', 'acrossFlats'), f('Pin diameter', 'pinOD')] } },
    { id: 'pin', label: 'One fuel pin', group: 'Reactor core', parent: 'core', reveal: 'isolate', noCut: true, object: pin, camera: { az: -30, el: 12, fill: 0.6 }, card: { title: 'One fuel pin (×60, shortened)', text: 'A stainless steel tube holds a stack of mixed uranium and plutonium oxide pellets, a spring and a gas plenum that collects fission gas. The spiral wire spaces it from its neighbours. Cladding is opened here so the pellets show.', facts: [f('Pin diameter', 'pinOD'), f('Active length', 'activeHeight'), f('Plutonium', 'puFraction')] } },
    { id: 'blanket', label: 'Radial breeding blanket', group: 'Reactor core', badge: '×90', object: blanket.object, explodeOffset: [0, 19, 0], camera: { az: -40, el: 30 }, card: { title: 'Radial breeding blanket', text: 'A ring of assemblies filled with depleted uranium oxide. Neutrons that leak out of the core are captured by U-238, which becomes Pu-239. The green glow follows the live capture rate here.', facts: [f('Blanket assemblies', 'blanketAsm'), f('Breeding ratio (design)', 'br'), f('Upper design range', 'brMax'), { label: 'Blanket captures now', live: (s) => fmt(s.bladeKgDay, 2) + ' kg/day' }] } },
    { id: 'rods', label: 'Control & safety rods', group: 'Reactor core', badge: '×30', object: rods.object, explodeOffset: [0, 23, 0], camera: { az: -35, el: 24 }, card: { title: 'Control & safety rods', text: 'Boron carbide absorbers slide in guide tubes among the fuel. Delayed neutrons are only a small fraction of the total here, so reactivity is measured in dollars, where one dollar equals that fraction. Above one dollar the chain runs on prompt neutrons alone.', facts: [f('Rods', 'rods'), f('Absorber', 'absorber'), f('One dollar', 'dollar'), { label: 'Position (withdrawn)', live: (s) => fmt(s.rodPct, 1) + ' %' }, { label: 'Reactivity now', live: (s) => fmt(s.rhoDollar, 3) + ' $' }, { label: 'Rod worth in use', live: (s) => fmt(s.rhoRodPcm, 0) + ' pcm' }] } },
    { id: 'plug', label: 'Rotating plug & refuelling machine', group: 'Reactor core', object: plug.object, explodeOffset: [0, 36, 0], camera: { az: -35, el: 26 }, card: { title: 'Rotating plug & refuelling machine', text: 'The roof carries two plugs that turn on sodium seals. Together with the arm of the refuelling machine they reach every assembly without opening the vessel. The central column over the core carries the rod drives. A simplified, concentric layout is drawn.', facts: [f('Cover gas', 'coverGas'), f('Cover gas pressure', 'pressure')] } },
    { id: 'pumps', label: 'Primary sodium pumps', group: 'Primary circuit', badge: '×3', object: pumps.object, spread: pumps.groups.map((g, k) => ({ object: g, offset: tangentOut(k) })), camera: { az: -40, el: 20 }, card: { title: 'Primary sodium pumps', text: 'Vertical pumps hang from the roof into the cold pool. The motor sits above, the impeller under the sodium. Each pump pushes sodium into the pressure plenum under the core. Shaft stripes and impellers turn with live flow.', facts: [f('Pumps', 'pumps'), f('Primary flow', 'flow'), { label: 'Pump speed', live: (s) => fmt(s.flowFrac * 100, 0) + ' %' }, { label: 'Flow now', live: (s) => fmt(s.flowKgs, 0) + ' kg/s' }] } },
    { id: 'ihx', label: 'Intermediate heat exchangers', group: 'Primary circuit', badge: '×6', object: ihx.object, spread: ihx.groups.map((g, i) => ({ object: g, offset: radialOut(Math.floor(i / 2), i % 2, 9.5) })), camera: { az: -40, el: 20 }, card: { title: 'Intermediate heat exchangers', text: 'Radioactive primary sodium flows down outside the tubes and gives its heat to clean secondary sodium flowing inside them. This extra loop is the reason the design is safe from the worst accident: if a steam generator leaks, water meets only non-radioactive sodium, never the primary.', facts: [f('Exchangers', 'ihx'), f('Primary in', 'tout'), f('Primary out', 'tin'), f('Secondary in', 'secIn'), f('Secondary out', 'secOut'), { label: 'Secondary hot now', live: (s) => fmt(s.secHot, 0) + ' °C' }] } },
    { id: 'secondary', label: 'Secondary sodium loop', group: 'Heat transport', object: sec.object, explodeOffset: [0, 6, 0], camera: { az: -40, el: 24 }, card: { title: 'Secondary sodium loop', text: 'Clean sodium carries the heat from the exchangers to the steam generators and back, driven by its own pumps. It is kept at a higher pressure than the primary side, so a small leak would push clean sodium into the pool, not the reverse.', facts: [f('Cold side', 'secIn'), f('Hot side', 'secOut'), f('Loops', 'loops'), { label: 'Hot side now', live: (s) => fmt(s.secHot, 0) + ' °C' }, { label: 'Heat carried', live: (s) => fmt(s.steamMW, 0) + ' MW' }] } },
    { id: 'sg', label: 'Steam generators', group: 'Heat transport', badge: '×3', object: sgs.object, spread: sgs.groups.map((g, k) => ({ object: g, offset: radialDir(G.loopAng[k]).map((v) => v * 5) })), camera: { az: -40, el: 20 }, card: { title: 'Steam generators', text: 'Hot secondary sodium flows down the shell while water runs up inside the tubes, heated in three stages: economiser, evaporator and superheater. Sodium and water react violently, which is why a clean sodium loop separates them from the reactor.', facts: [f('Steam temperature', 'steamTemp'), f('Steam pressure', 'steamPressure'), f('Loops', 'loops'), { label: 'Steam raised', live: (s) => fmt(s.steamMW, 0) + ' MW' }, { label: 'Steam temperature now', live: (s) => fmt(s.steamTemp, 0) + ' °C' }] } },
    { id: 'turbine', label: 'Turbine-generator', group: 'Heat transport', object: turbine.object, explodeOffset: [8, 10, 0], camera: { az: -25, el: 20 }, card: { title: 'Turbine-generator', text: 'Steam passes through high-pressure and low-pressure stages on one shaft with the generator. The casings are open on top so the blades show. Because the steam is hotter than in a water reactor, a larger share of the heat becomes electricity. The shaft turns in proportion to output here.', facts: [f('Electric output', 'electric'), f('Steam temperature', 'steamTemp'), { label: 'Output now', live: (s) => fmt(s.electricMW, 0) + ' MWe' }, { label: 'Efficiency', live: (s) => (s.steamMW > 1 && s.electricMW > 0 ? fmt((100 * s.electricMW) / s.steamMW, 1) + ' %' : '—') }] } },
    { id: 'cooling', label: 'Condenser & cooling tower', group: 'Heat rejection', object: cooling.object, explodeOffset: [6, 0, -10], camera: { az: -40, el: 22 }, card: { title: 'Condenser & cooling tower', text: 'Spent steam condenses on tubes cooled by circulating water, and that water gives its heat to the air in the tower as a plume of clean water vapour. It never touches the sodium or the reactor. A generic tower is drawn; the real Beloyarsk plant uses a reservoir.', facts: [f('Heat sink', 'coolingNote'), f('Thermal power', 'thermal'), f('Electric output', 'electric'), { label: 'Heat rejected now', live: (s) => fmt(s.rejectedMW, 0) + ' MW' }] } },
    { id: 'grid', label: 'Generator output & grid', group: 'Heat rejection', object: grid.object, explodeOffset: [0, 0, 10], camera: { az: -40, el: 22 }, card: { title: 'Generator output & grid', text: 'The generator feeds a transformer and a transmission line. Pulses on the line stand for electric output and thin out as it falls.', facts: [f('Electric output', 'electric'), f('First grid connection', 'firstGrid'), { label: 'Output now', live: (s) => fmt(s.electricMW, 0) + ' MWe' }] } },
  ];
  parts.forEach((p) => root.add(p.object));

  let rodLast = -1;
  function update(state, t, dt) {
    if (rodLast !== state.rodPos) {
      rods.setPos(state.rodPos);
      rodLast = state.rodPos;
    }
    core.update(state);
    blanket.update(state, t);
    pool.update(state, dt);
    pumps.update(state, dt);
    ihx.update(state);
    sec.update(state, dt);
    sgs.update(state, dt);
    turbine.update(state, dt);
    cooling.update(state, dt);
    grid.update(state, dt);
  }
  return {
    root,
    parts,
    update,
    defaultFit: ['pit', 'vessel', 'pool', 'core', 'blanket', 'rods', 'plug', 'ihx', 'pumps', 'secondary', 'sg', 'turbine', 'cooling'],
    defaultFill: 0.8,
    cutOrigin: [0, 0, 0],
    cutAngle: 310,
    defaultMode: 'cutaway',
    defaultView: { az: -40, el: 22 },
    presets: { iso: { az: -40, el: 22 }, front: { az: 0, el: 6 }, side: { az: 90, el: 8 }, top: { az: -40, el: 78 }, site: { az: -40, el: 22, fit: 'all' } },
  };
}

export default {
  id: 'sfr',
  tab: 'plutonium',
  title: 'Sodium-cooled fast breeder',
  short: 'SFR',
  spec,
  createModel,
  controls,
  gauges,
  charts,
  build,
  atom,
  tour,
  sources: [
    'BN-800 (Beloyarsk 4) design data: IAEA ARIS fast reactor database and published Rosatom / Beloyarsk NPP figures; values marked approximate are rounded or taught.',
    'Nuclear data: ENDF/B-VIII and ENSDF (half-lives, fast fission neutron yield).',
    'Breeding ledger: fissile burn rate from thermal power, 200 MeV per fission and 239 g/mol; breeding ratio about 1.0 as design value.',
  ],
  sourceLabels: SOURCES,
  modelNote: 'Point kinetics with six delayed groups scaled to MOX fuel, two thermal lumps (fuel and sodium), a fixed heat sink and a fissile breeding ledger with the U-239 and Np-239 chain. It leaves out spatial flux, burn-up, sodium voiding and the sodium-water reaction.',
  properNames: ['BN-800 (Beloyarsk 4)', 'BN-800', 'Beloyarsk 4', 'Beloyarsk', 'Rosatom', 'IAEA ARIS', 'MOX', 'ENDF/B-VIII', 'ENSDF'],
  tripReasons: ['Manual SCRAM', 'Overpower trip (> 118 %)', 'Short-period trip (< 3 s)', 'High outlet temperature (> 607 °C)'],
};
