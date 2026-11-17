// SFR atom view: a fast neutron meets Pu-239 (fission), U-238 (capture, breeds Pu-239), Pu-239 (capture), a rod or is lost.
import { A } from '../../kit/atomview.js';
import { clamp, fmt } from '../../kit/util.js';
import { t } from '../../kit/i18n.js';
import { spec } from './spec.js';

const I = spec.items;
const NU = I.nu.v;
const FY = 0.5;
const AL = I.alphaCap.v;

const species = {
  nf: { r: 3.8, color: '#000000', label: '' },
  Pu239: { r: 17, color: '#7c3aed', label: 'Pu' },
  Pu240: { r: 17, color: '#5b21b6', label: 'Pu' },
  U238: { r: 17, color: '#737373', label: 'U' },
  U239: { r: 17, color: '#a3a3a3', label: 'U', labelColor: '#000000' },
  Np239: { r: 17, color: '#c2410c', label: 'Np' },
  Pu239new: { r: 17, color: '#059669', label: 'Pu' },
  frag: { r: 10, color: '#db2777', label: '' },
  na: { r: 8, color: '#2563eb', label: 'Na' },
  rod: { r: 16, color: '#000000', label: 'B' },
};

const fission = (rand) => {
  const y = FY + (rand() - 0.5) * 0.36;
  const cx = 0.3 + rand() * 0.4;
  const nOut = rand() < 0.9 ? 3 : 2;
  const ns = [];
  for (let i = 0; i < nOut; i++) {
    const a = -0.6 + (i / Math.max(1, nOut - 1)) * 1.2 + (rand() - 0.5) * 0.2;
    ns.push(A.move('nf', [cx, y], [cx + 0.3 * Math.cos(a), y + 0.4 * Math.sin(a) * 1.4], 1.0, 1.7, { trail: true }));
  }
  return [
    A.move('nf', [cx - 0.28, y], [cx - 0.05, y], 0, 0.7, { trail: true }),
    A.hold('Pu239', [cx, y], 0, 0.8),
    A.path('Pu240', [[0.8, cx, y, 1.0], [1.0, cx, y, 1.35], [1.1, cx, y, 1.0]], { ring: true }),
    A.move('frag', [cx, y], [cx - 0.16, y - 0.3], 1.0, 2.0),
    A.move('frag', [cx, y], [cx - 0.16, y + 0.3], 1.0, 2.0),
    ...ns,
    A.text(t('Pu-239 + n'), [cx, y - 0.2], 0.2, 1.0, { size: 10 }),
    A.text(t('≈ ' + I.fissionMeV.v + ' MeV, ' + fmt(NU, 1) + ' n'), [cx, y - 0.2], 1.1, 2.2, { size: 10 }),
  ];
};
const breed = (rand) => {
  const y = FY + (rand() - 0.5) * 0.36;
  const cx = 0.3 + rand() * 0.4;
  const s1 = 'U-239  β⁻ ' + I.tU239.v + ' min';
  const s2 = 'Np-239  β⁻ ' + I.tNp239.v + ' d';
  return [
    A.move('nf', [cx - 0.28, y], [cx - 0.05, y], 0, 0.7, { trail: true }),
    A.hold('U238', [cx, y], 0, 0.9),
    A.hold('U239', [cx, y], 0.9, 2.6),
    A.hold('Np239', [cx, y], 2.6, 4.3),
    A.hold('Pu239new', [cx, y], 4.3, 6.2),
    A.text(t('U-238 + n'), [cx, y - 0.22], 0.0, 0.9, { size: 10 }),
    A.text(t(s1), [cx, y - 0.22], 0.9, 2.6, { size: 10 }),
    A.text(t(s2), [cx, y - 0.22], 2.6, 4.3, { size: 10 }),
    A.text(t('Pu-239 bred'), [cx, y - 0.22], 4.3, 6.2, { size: 10, color: '#059669' }),
    A.text(t('times compressed'), [cx, y + 0.25], 0.9, 4.3, { size: 9, color: '#737373' }),
  ];
};
const puCapture = (rand) => {
  const y = FY + (rand() - 0.5) * 0.36;
  const cx = 0.3 + rand() * 0.4;
  return [
    A.move('nf', [cx - 0.28, y], [cx - 0.05, y], 0, 0.8, { trail: true }),
    A.hold('Pu239', [cx, y], 0, 0.9),
    A.hold('Pu240', [cx, y], 0.9, 2.0),
    A.text(t('Pu-240, no fission'), [cx, y - 0.22], 0.9, 2.1, { size: 10 }),
  ];
};
const rodHit = (rand) => {
  const y = FY + (rand() - 0.5) * 0.36;
  const cx = 0.3 + rand() * 0.4;
  return [A.move('nf', [cx - 0.28, y], [cx - 0.05, y], 0, 0.9, { trail: true }), A.hold('rod', [cx, y], 0, 1.8), A.text(t('absorbed in B₄C rod'), [cx, y - 0.22], 0.9, 1.9, { size: 10 })];
};
const lost = (rand) => {
  const y = FY + (rand() - 0.5) * 0.4;
  const cx = 0.3 + rand() * 0.4;
  return [A.move('nf', [cx - 0.28, y], [cx - 0.08, y], 0, 0.7, { trail: true }), A.hold('na', [cx, y], 0, 1.4), A.move('nf', [cx - 0.08, y], [Math.min(0.97, cx + 0.45), 0.08 + rand() * 0.15], 0.7, 1.6, { trail: true }), A.text(t('leaks or captured'), [cx, y + 0.22], 0.9, 1.6, { size: 10 })];
};

export const atom = {
  title: 'Atom view · Pu-239 breeding',
  species,
  rate: (s) => (s.fissionPct < 0.5 ? 0 : 0.35 + 1.8 * clamp(s.fissionPct / 100, 0, 1.2)),
  outcomes(s) {
    const pf = clamp(s.keff / NU, 0.02, 0.6);
    const pb = clamp((I.br.v * (1 + AL)) / NU, 0.05, 0.6);
    const pc = AL / NU;
    const rest = Math.max(0.05, 1 - pf - pb - pc);
    const rodW = 0.1 + 0.9 * clamp((0.88 - s.rodPos) / 0.88, 0, 1) * 1.6;
    const w = [rodW, 0.5];
    const sw = w[0] + w[1];
    return [
      { id: 'fission', label: 'Fission of Pu-239', p: pf, scene: fission },
      { id: 'breed', label: 'Capture in U-238 (breeds Pu-239)', p: pb, scene: breed },
      { id: 'pucap', label: 'Capture in Pu-239 (no fission)', p: pc, scene: puCapture },
      { id: 'rod', label: 'Absorbed in control rods', p: (rest * w[0]) / sw, scene: rodHit },
      { id: 'lost', label: 'Other capture or leakage', p: (rest * w[1]) / sw, scene: lost },
    ];
  },
  stats: [
    { label: 'Pu burned/day', get: (s) => fmt(s.burnedKgDay, 2) + ' kg' },
    { label: 'Pu bred/day', get: (s) => fmt(s.bredKgDay, 2) + ' kg' },
    { label: 'Breeding ratio', get: (s) => (s.breedingRatio ? '≈ ' + fmt(s.breedingRatio, 2) : '0') },
    { label: 'Bred − burned', get: (s) => (s.puNetKg >= 0 ? '+' : '') + fmt(s.puNetKg, 2) + ' kg' },
  ],
};
export default atom;
