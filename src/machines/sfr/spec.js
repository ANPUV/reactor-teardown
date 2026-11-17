// BN-800 (Beloyarsk 4) sodium-cooled fast breeder reference data. Every number on screen comes from here or from live state.
// Entry: { label, v, unit, approx?, src }.  src keys are resolved against SOURCES below.
export const SOURCES = {
  iaea: 'IAEA ARIS fast reactor database, BN-800 data sheet; IAEA-TECDOC fast reactor design summaries',
  rosatom: 'Rosatom / Beloyarsk NPP published BN-800 design data',
  nudat: 'Nuclear data: ENDF/B-VIII, ENSDF',
  teach: 'Teaching-model parameter (not a plant datum)',
  derived: 'Derived in spec.js from the other items shown (arithmetic in the card text)',
};

const e = (label, v, unit, src = 'iaea', approx = false) => ({ label, v, unit, src, approx });

const items = {
  thermal: e('Thermal power', 2100, 'MWt'),
  electric: e('Electric output (gross)', 880, 'MWe'),
  tin: e('Core inlet sodium temperature', 354, '°C'),
  tout: e('Core outlet sodium temperature', 547, '°C'),
  flow: e('Primary sodium flow', 8600, 'kg/s', 'derived', true),
  cp: e('Sodium specific heat', 1.27, 'kJ/(kg·K)', 'nudat', true),
  pressure: e('Primary pressure (cover gas)', 0.14, 'MPa', 'iaea', true),
  coverGas: e('Cover gas', 'Argon', ''),
  loops: e('Heat-transport loops', 3, ''),
  pumps: e('Primary sodium pumps', 3, ''),
  ihx: e('Intermediate heat exchangers', 6, ''),
  secIn: e('Secondary sodium, cold side', 309, '°C', 'iaea', true),
  secOut: e('Secondary sodium, hot side', 505, '°C', 'iaea', true),
  steamTemp: e('Steam temperature', 490, '°C', 'iaea', true),
  steamPressure: e('Steam pressure', 14, 'MPa', 'iaea', true),
  vesselD: e('Reactor vessel diameter', 12.9, 'm', 'iaea', true),
  vesselH: e('Reactor vessel height', 14.8, 'm', 'iaea', true),
  naInventory: e('Primary sodium inventory', '800–1000', 't', 'iaea', true),
  naMelt: e('Sodium melting point', 97.8, '°C', 'nudat'),
  naBoil: e('Sodium boiling point (1 atm)', 883, '°C', 'nudat'),
  assemblies: e('Fuel assemblies', 565, ''),
  zone1: e('Inner enrichment zone', 211, 'assemblies'),
  zone2: e('Middle enrichment zone', 156, 'assemblies'),
  zone3: e('Outer enrichment zone', 198, 'assemblies'),
  acrossFlats: e('Assembly width across flats', 94.5, 'mm', 'iaea', true),
  pitch: e('Assembly pitch', 100, 'mm', 'iaea', true),
  pinsPerAssembly: e('Fuel pins per assembly', 127, ''),
  pinOD: e('Fuel pin outer diameter', 6.9, 'mm', 'iaea', true),
  activeHeight: e('Active core height', 0.88, 'm'),
  coreDiameter: e('Core equivalent diameter', 2.56, 'm', 'iaea', true),
  puFraction: e('Plutonium in MOX fuel', '20–25', '% of heavy metal', 'iaea', true),
  blanketAsm: e('Radial blanket assemblies', 90, '', 'iaea', true),
  rods: e('Control and safety rods', 30, '', 'iaea', true),
  absorber: e('Absorber', 'Boron carbide (B₄C)', ''),
  br: e('Breeding ratio (design)', 1.0, '', 'iaea', true),
  brMax: e('Breeding ratio, full blankets (upper design range)', 1.2, '', 'iaea', true),
  brCore: e('Breeding share made inside the core', 0.6, '', 'teach', true),
  brBlanket: e('Breeding share made in the blanket', 0.4, '', 'teach', true),
  firstGrid: e('First grid connection', 2015, ''),
  nu: e('Neutrons per fast Pu-239 fission', 2.9, '', 'nudat', true),
  fissionMeV: e('Energy per fission', 200, 'MeV', 'nudat', true),
  alphaCap: e('Capture-to-fission ratio of Pu-239 (fast)', 0.06, '', 'teach', true),
  tU239: e('U-239 half-life', 23.5, 'min', 'nudat'),
  tNp239: e('Np-239 half-life', 2.36, 'd', 'nudat'),
  betaEff: e('Delayed neutron fraction βeff', 0.0037, '', 'teach', true),
  lambda: e('Prompt neutron lifetime Λ', 4.5e-7, 's', 'teach', true),
  alphaF: e('Fuel (Doppler) coefficient', -0.7, 'pcm/K', 'teach', true),
  alphaC: e('Coolant and expansion coefficient', -1.0, 'pcm/K', 'teach', true),
  dollar: e('One dollar of reactivity', 370, 'pcm', 'derived'),
  coolingNote: e('Heat sink at Beloyarsk', 'Reservoir (generic tower drawn)', '', 'rosatom', true),
};

// Fissile burn rate, derived: P / (E_fission) fissions per second, times 86 400 s, times 239 g/mol / N_A.
const MEV = 1.602176634e-13; // J
const NA = 6.02214076e23;
const fissionsPerS = (items.thermal.v * 1e6) / (items.fissionMeV.v * MEV);
const kgPerDay = (fissionsPerS * 86400 * 239) / NA / 1000;
export const BURN = { fissionsPerS, kgPerDay, MEV, NA, A: 239 };
items.fissionedPerDay = e('Fissile fissioned at full power', Math.round(kgPerDay * 100) / 100, 'kg/day', 'derived', true);
items.destroyedPerDay = e('Fissile destroyed (fission + capture)', Math.round(kgPerDay * (1 + items.alphaCap.v) * 100) / 100, 'kg/day', 'derived', true);
items.bredPerDay = e('Pu-239 bred at design breeding ratio', Math.round(kgPerDay * (1 + items.alphaCap.v) * items.br.v * 100) / 100, 'kg/day', 'derived', true);

export const spec = {
  id: 'sfr',
  name: 'Sodium-cooled fast breeder reactor',
  reference: 'BN-800 (Beloyarsk 4)',
  items,
  compare: {
    fuel: 'MOX (U–Pu oxide), about 20–25 % Pu',
    spectrum: 'Fast',
    coolant: 'Liquid sodium, pool design',
    moderator: 'None (fast neutrons)',
    tin: { k: 'tin' },
    tout: { k: 'tout' },
    pressure: { k: 'pressure' },
    thermal: { k: 'thermal' },
    electric: { k: 'electric' },
    betaEff: { k: 'betaEff' },
    lambda: { k: 'lambda' },
    heatSink: 'Reservoir (cooling pond) at Beloyarsk; a generic cooling tower is drawn',
    note: 'Breeds Pu-239 from U-238; breeding ratio about 1.0.',
  },
};
export default spec;
