// PWR atom view: a thermal neutron meets U-235 (fission), U-238 (capture), a control rod or is lost.
import { A } from '../../kit/atomview.js';
import { clamp } from '../../kit/util.js';
import { spec } from './spec.js';

const NU = spec.items.nu.v;
const FY = 0.5;

const species = {
  nt: { r: 3.6, color: '#2B7FD9', label: '' },
  nf: { r: 3.6, color: '#14202B', label: '' },
  U235: { r: 17, color: '#5B6B78', label: '235' },
  U236: { r: 17, color: '#14202B', label: '236' },
  U238: { r: 17, color: '#8794A0', label: '238' },
  U239: { r: 17, color: '#5B6B78', label: '239' },
  frag: { r: 10, color: '#E4572E', label: '' },
  h2o: { r: 8, color: '#2B7FD9', label: 'H' },
  rod: { r: 16, color: '#14202B', label: 'Cd' },
};

const fission = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  const nOut = rand() < 0.43 ? 3 : 2;
  const ns = [];
  for (let i = 0; i < nOut; i++) {
    const a = -0.55 + (i / Math.max(1, nOut - 1)) * 1.1 + (rand() - 0.5) * 0.2;
    ns.push(A.move('nf', [0.5, y], [0.5 + 0.38 * Math.cos(a), y + 0.38 * Math.sin(a) * 1.4], 1.0, 1.9, { trail: true }));
  }
  return [
    A.move('nt', [0.02, y], [0.45, y], 0, 0.8, { trail: true }),
    A.hold('U235', [0.5, y], 0, 0.8),
    A.path('U236', [[0.8, 0.5, y, 1.0], [1.0, 0.5, y, 1.35], [1.1, 0.5, y, 1.0]], { ring: true }),
    A.move('frag', [0.5, y], [0.34, y - 0.33], 1.0, 2.0),
    A.move('frag', [0.5, y], [0.34, y + 0.33], 1.0, 2.0),
    ...ns,
    A.text('≈ 200 MeV', [0.5, y - 0.2], 1.1, 2.2, { size: 10 }),
    A.move('h2o', [0.82, y + 0.35], [0.82, y + 0.35], 0, 2.1),
  ];
};
const capture238 = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  return [
    A.move('nt', [0.02, y], [0.45, y], 0, 0.9, { trail: true }),
    A.hold('U238', [0.5, y], 0, 2.0),
    A.path('U239', [[0.9, 0.5, y, 1.0], [2.0, 0.5, y, 1.0]], {}),
    A.text('U-238 + n → Pu-239', [0.5, y - 0.22], 1.0, 2.1, { size: 10 }),
  ];
};
const rodHit = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  return [A.move('nt', [0.02, y], [0.45, y], 0, 0.9, { trail: true }), A.hold('rod', [0.5, y], 0, 1.8), A.text('absorbed in rod', [0.5, y - 0.22], 0.9, 1.9, { size: 10 })];
};
const lost = (rand) => {
  const y = FY + (rand() - 0.5) * 0.3;
  return [A.move('nt', [0.02, y], [0.42, y], 0, 0.7, { trail: true }), A.hold('h2o', [0.5, y], 0, 1.4), A.move('nt', [0.42, y], [0.98, 0.1 + rand() * 0.15], 0.7, 1.6, { trail: true }), A.text('leaks / captured', [0.5, y + 0.2], 0.9, 1.6, { size: 10 })];
};

export const atom = {
  title: 'Atom view · U-235 fission',
  species,
  rate: (s) => (s.powerPct < 0.5 ? 0 : 0.35 + 1.8 * clamp(s.fissionPct / 100, 0, 1.2)),
  outcomes(s) {
    const pf = clamp(s.keff / NU, 0.02, 0.6);
    const rest = 1 - pf;
    const rodW = 0.1 + 0.9 * clamp((0.88 - s.rodPos) / 0.88, 0, 1) * 1.6;
    const w = [0.27, rodW, 0.3];
    const sw = w.reduce((a, b) => a + b, 0);
    return [
      { id: 'fission', label: 'Fission of U-235', p: pf, scene: fission },
      { id: 'u238', label: 'Capture in U-238 (breeds Pu-239)', p: (rest * w[0]) / sw, scene: capture238 },
      { id: 'rod', label: 'Absorbed in control rods', p: (rest * w[1]) / sw, scene: rodHit },
      { id: 'lost', label: 'Other capture / leakage', p: (rest * w[2]) / sw, scene: lost },
    ];
  },
  stats: [
    { label: 'Fissions/s', get: (s) => (s.fissionsPerSec < 1e3 ? '0' : (s.fissionsPerSec / 1e20).toFixed(2) + ' × 10²⁰') },
    { label: 'n per fission', get: () => 'ν = ' + NU.toFixed(2) },
    { label: 'Per fission', get: () => '≈ ' + spec.items.fissionMeV.v + ' MeV' },
    { label: 'k_eff', get: (s) => s.keff.toFixed(4) },
  ],
};
export default atom;
