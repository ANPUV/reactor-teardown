// Tokamak atom view: D and T approach. Below fusion temperatures the Coulomb barrier turns them back;
// the share that fuses follows the live <sigma v>(T) (scaled for visibility).
import { A } from '../../kit/atomview.js';
import { clamp, fmt, fmtSci } from '../../kit/util.js';
import { t } from '../../kit/i18n.js';
import { spec } from './spec.js';
import { sigmaVcm3 } from './model.js';

const I = spec.items;
const SV10 = sigmaVcm3(10);
export const fuseShare = (T) => clamp((sigmaVcm3(Math.max(T, 0.2)) / SV10) * 0.4, 0, 0.95);

const species = {
  D: { r: 11, color: '#db2777', label: 'D' },
  T: { r: 13, color: '#2563eb', label: 'T' },
  He5: { r: 15, color: '#a3a3a3', label: '⁵He', ring: true },
  He4: { r: 12, color: '#7c3aed', label: '⁴He' },
  n: { r: 6, color: '#000000', label: 'n' },
};

const turnBack = (T) => (rand) => {
  const y = 0.5 + (rand() - 0.5) * 0.2;
  const reach = 0.3 + 0.13 * clamp(T / 20, 0, 1);
  return [
    A.move('D', [0.04, y], [reach, y], 0, 1.0, { trail: true }),
    A.move('D', [reach, y], [0.14, y - 0.26], 1.0, 1.9, { trail: true }),
    A.move('T', [0.96, y], [1 - reach, y], 0, 1.0, { trail: true }),
    A.move('T', [1 - reach, y], [0.86, y + 0.26], 1.0, 1.9, { trail: true }),
    A.text(t('Coulomb repulsion'), [0.5, y - 0.2], 0.7, 1.8, { size: 10 }),
  ];
};

const fuse = (rand) => {
  const y = 0.5 + (rand() - 0.5) * 0.12;
  const up = rand() < 0.5 ? -1 : 1;
  return [
    A.move('D', [0.04, y], [0.47, y], 0, 0.9, { trail: true }),
    A.move('T', [0.96, y], [0.53, y], 0, 0.9, { trail: true }),
    A.path('He5', [[0.9, 0.5, y, 0.8], [1.15, 0.5, y, 1.3], [1.3, 0.5, y, 1.0]]),
    A.move('He4', [0.5, y], [0.22, y - up * 0.3], 1.3, 2.4, { trail: true }),
    A.move('n', [0.5, y], [0.94, y + up * 0.32], 1.3, 2.0, { trail: true }),
    A.text(`${I.eAlpha.v} MeV`, [0.3, y - up * 0.16], 1.5, 2.6, { size: 10 }),
    A.text(`${I.eN.v} MeV`, [0.78, y + up * 0.16], 1.5, 2.6, { size: 10 }),
    A.text(`${I.eDT.v} ${t('MeV total')}`, [0.5, y + up * 0.26], 1.4, 2.6, { size: 10 }),
  ];
};

export const atom = {
  title: 'Atom view · D + T fusion',
  species,
  rate: (s) => (s.plasma && s.T > 0.2 ? 0.5 + 1.7 * clamp(s.T / 20, 0, 1) : 0),
  outcomes(s) {
    const p = fuseShare(s.T);
    return [
      { id: 'fuse', label: 'D + T fuse: He-4 + neutron', p, scene: fuse },
      { id: 'barrier', label: 'Coulomb barrier turns them back', p: 1 - p, scene: turnBack(s.T) },
    ];
  },
  stats: [
    { label: 'Ion temperature', get: (s) => fmt(s.T, 1) + ' keV' },
    { label: 'Reactivity ⟨σv⟩', get: (s) => (s.sigmaVcm3 > 0 ? fmtSci(s.sigmaVcm3, 1) + ' cm³/s' : '0') },
    { label: 'Fusion share (scaled)', get: (s) => fmt(fuseShare(s.T) * 100, 0) + ' %' },
    { label: 'Energy per reaction', get: () => I.eDT.v + ' MeV' },
  ],
};
export default atom;
