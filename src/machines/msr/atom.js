// MSR atom view: a thermal neutron meets U-233 (fission), Th-232 (breeding chain), Pa-233, graphite/rods/xenon or leaves.
// Probabilities come from the live model: k_eff / nu for fission, the ledger for breeding, rods, xenon and Pa-233 for the rest.
import { A } from '../../kit/atomview.js';
import { clamp } from '../../kit/util.js';
import { spec } from './spec.js';

const NU = spec.items.nu.v;
const FY = 0.5;
const ALPHA = 0.09;

const species = {
  nt: { r: 3.6, color: '#2563eb', label: '' },
  nf: { r: 3.6, color: '#000000', label: '' },
  Th232: { r: 17, color: '#a3a3a3', label: '232' },
  Th233: { r: 17, color: '#c2410c', label: '233' },
  Pa233: { r: 17, color: '#7c3aed', label: '233' },
  U233: { r: 17, color: '#059669', label: '233' },
  U234: { r: 17, color: '#000000', label: '234' },
  frag: { r: 10, color: '#c2410c', label: '' },
  C: { r: 11, color: '#5b21b6', label: 'C' },
  rod: { r: 16, color: '#000000', label: 'B' },
  Xe: { r: 14, color: '#db2777', label: 'Xe' },
};

const fission = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  const nOut = rand() < NU - 2 ? 3 : 2;
  const ns = [];
  for (let i = 0; i < nOut; i++) {
    const a = -0.55 + (i / Math.max(1, nOut - 1)) * 1.1 + (rand() - 0.5) * 0.2;
    ns.push(A.move('nf', [0.5, y], [0.5 + 0.38 * Math.cos(a), y + 0.38 * Math.sin(a) * 1.4], 1.0, 1.9, { trail: true }));
  }
  return [
    A.move('nt', [0.02, y], [0.45, y], 0, 0.8, { trail: true }),
    A.hold('U233', [0.5, y], 0, 0.8),
    A.path('U234', [[0.8, 0.5, y, 1.0], [1.0, 0.5, y, 1.35], [1.1, 0.5, y, 1.0]], { ring: true }),
    A.move('frag', [0.5, y], [0.34, y - 0.33], 1.0, 2.0),
    A.move('frag', [0.5, y], [0.34, y + 0.33], 1.0, 2.0),
    ...ns,
    A.text('about 200 MeV', [0.5, y - 0.2], 1.1, 2.2, { size: 10 }),
  ];
};
// the breeding chain, drawn left to right with the real half-lives; the clock is compressed
const breed = (rand) => {
  const y = FY + (rand() - 0.5) * 0.15;
  return [
    A.move('nt', [0.02, y], [0.18, y], 0, 0.7, { trail: true }),
    A.hold('Th232', [0.2, y], 0, 0.8),
    A.path('Th233', [[0.8, 0.2, y, 1.0], [2.0, 0.2, y, 1.0]]),
    A.text('Th-233', [0.2, y - 0.22], 0.9, 2.0, { size: 10 }),
    A.path('Pa233', [[1.6, 0.5, y, 0.1, 0], [2.0, 0.5, y, 1.0, 1], [3.2, 0.5, y, 1.0]]),
    A.text(`${spec.items.halfTh233.v} min`, [0.35, y - 0.12], 1.4, 2.4, { size: 10 }),
    A.text('Pa-233', [0.5, y - 0.22], 2.0, 3.2, { size: 10 }),
    A.path('U233', [[2.8, 0.8, y, 0.1, 0], [3.2, 0.8, y, 1.0, 1], [4.2, 0.8, y, 1.0]]),
    A.text(`${spec.items.halfPa233.v} d`, [0.65, y - 0.12], 2.5, 3.4, { size: 10 }),
    A.text('U-233', [0.8, y - 0.22], 3.2, 4.2, { size: 10 }),
  ];
};
const u233capture = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  return [A.move('nt', [0.02, y], [0.45, y], 0, 0.9, { trail: true }), A.hold('U233', [0.5, y], 0, 1.0), A.path('U234', [[0.9, 0.5, y, 1.0], [2.0, 0.5, y, 1.0]]), A.text('U-233 + n gives U-234, no fission', [0.5, y - 0.22], 1.0, 2.1, { size: 10 })];
};
const paCapture = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  return [A.move('nt', [0.02, y], [0.45, y], 0, 0.9, { trail: true }), A.hold('Pa233', [0.5, y], 0, 2.0), A.text('Pa-233 captures it: a would-be U-233 is lost', [0.5, y - 0.22], 0.9, 2.1, { size: 10 })];
};
const rodHit = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  return [A.move('nt', [0.02, y], [0.45, y], 0, 0.9, { trail: true }), A.hold('rod', [0.5, y], 0, 1.8), A.text('absorbed in a control rod', [0.5, y - 0.22], 0.9, 1.9, { size: 10 })];
};
const xenonHit = (rand) => {
  const y = FY + (rand() - 0.5) * 0.2;
  return [A.move('nt', [0.02, y], [0.45, y], 0, 0.9, { trail: true }), A.hold('Xe', [0.5, y], 0, 1.8), A.text('absorbed by Xe-135', [0.5, y - 0.22], 0.9, 1.9, { size: 10 })];
};
const lost = (rand) => {
  const y = FY + (rand() - 0.5) * 0.3;
  return [A.move('nt', [0.02, y], [0.42, y], 0, 0.7, { trail: true }), A.hold('C', [0.5, y], 0, 1.4), A.move('nt', [0.42, y], [0.98, 0.1 + rand() * 0.15], 0.7, 1.6, { trail: true }), A.text('graphite scatters it; some leak out', [0.5, y + 0.2], 0.9, 1.6, { size: 10 })];
};

export const atom = {
  title: 'Atom view · Th-232 to U-233',
  species,
  rate: (s) => (s.fissionPct < 0.5 ? 0 : 0.35 + 1.8 * clamp(s.fissionPct / 100, 0, 1.2)),
  outcomes(s) {
    const pf = clamp(s.keff / NU, 0.02, 0.6); // fissions per absorbed neutron (live k_eff)
    const pU = ALPHA * pf;
    const pTh = clamp(s.thCaptureRate * pf, 0, 0.7); // Th-232 captures per absorption (ledger breeding coefficient)
    const pPa = clamp(s.paCaptureFrac * pTh, 0, 0.3);
    const pXe = clamp(-s.xenonPcm / 1e5 * 6, 0, 0.5);
    const pRod = clamp(0.012 + 0.2 * (0.85 - s.rodPos), 0.004, 0.2);
    const pLost = 0.05;
    return [
      { id: 'fission', label: 'Fission of U-233', p: pf, scene: fission },
      { id: 'breed', label: 'Capture in Th-232 (breeds U-233)', p: pTh, scene: breed },
      { id: 'u233', label: 'Capture in U-233 (no fission)', p: pU, scene: u233capture },
      { id: 'pa', label: 'Capture in Pa-233 (lost)', p: pPa, scene: paCapture },
      { id: 'xe', label: 'Absorbed by Xe-135', p: pXe, scene: xenonHit },
      { id: 'rod', label: 'Absorbed in control rods', p: pRod, scene: rodHit },
      { id: 'lost', label: 'Graphite, structure, leakage', p: pLost, scene: lost },
    ];
  },
  stats: [
    { label: 'Fissions/s', get: (s) => (s.fissionsPerSec < 1e3 ? '0' : (s.fissionsPerSec / 1e19).toFixed(1) + ' × 10¹⁹') },
    { label: 'n per fission', get: () => 'ν = ' + NU.toFixed(2) },
    { label: 'Breeding ratio', get: (s) => (s.breedingNow > 0 ? s.breedingNow.toFixed(3) : '0') },
    { label: 'k_eff', get: (s) => s.keff.toFixed(4) },
  ],
};
export default atom;
