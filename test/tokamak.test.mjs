import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, sigmaVcm3, tauIPB, K_PROF, greenwald, q95of } from '../src/machines/tokamak/model.js';
import { spec } from '../src/machines/tokamak/spec.js';

const I = spec.items;
const fresh = (o = {}) => createModel({ warm: false, auto: false, ...o });
const run = (m, seconds, accel = 1) => {
  const dt = (1 / 60) * accel;
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++) m.advance(dt);
};
/** start a pulse and run until burn has lasted `extra` s of flat-top (or the pulse ends). */
const toBurn = (m, extra = 200) => {
  m.press('start');
  let guard = 0;
  while (!(['flattop', 'burn'].includes(m.state.phase) && m.state.flatT > extra) && guard++ < 60 * 3000) {
    m.advance(1 / 20);
    if (m.state.status === 'TRIPPED') break;
  }
  return m;
};

test('Bosch-Hale <sigma v> check values', () => {
  const a = sigmaVcm3(10);
  const b = sigmaVcm3(20);
  console.log(`\n  <sigma v> D-T: 10 keV ${a.toExponential(3)} cm3/s (ref ~1.1e-16), 20 keV ${b.toExponential(3)} cm3/s (ref ~4.3e-16)`);
  assert.ok(Math.abs(a / 1.1e-16 - 1) < 0.05, `10 keV: ${a}`);
  assert.ok(Math.abs(b / 4.3e-16 - 1) < 0.05, `20 keV: ${b}`);
  assert.ok(sigmaVcm3(1) < sigmaVcm3(5) && sigmaVcm3(5) < sigmaVcm3(10));
  assert.ok(Number.isFinite(sigmaVcm3(0)) && Number.isFinite(sigmaVcm3(1e4)) && sigmaVcm3(0) >= 0);
});

test('reference point: 50 MW heating, 1e20, 15 MA, 5.3 T gives about 500 MW and Q about 10', () => {
  const m = toBurn(fresh(), 300);
  const s = m.state;
  const rows = [
    ['Fusion power (MW)', I.pfus.v, s.pFus, 0.05],
    ['Gain Q', I.q.v, s.Q, 0.06],
    ['Heating power (MW)', I.paux.v, s.pAux, 0.01],
    ['Density (1e20 m^-3)', I.dens.v, s.n, 0.01],
    ['Plasma current (MA)', I.ip.v, s.Ip, 0.001],
    ['Toroidal field (T)', I.bt.v, s.B, 0.001],
    ['Core temperature (M degC)', I.tcore.v, s.TcoreMk, 0.1],
    ['Confinement time (s)', I.tauE.v, s.tauE, 0.4],
    ['Triple product (1e21)', I.triple.v, s.triple / 1e21, 0.3],
    ['Neutron wall load (MW/m2)', 0.57, s.wallLoad, 0.1],
    ['q95', 3.0, s.q95, 0.05],
    ['beta_N', 1.8, s.betaN, 0.1],
  ];
  console.log('\n  reference vs model (burn, t_flat = 300 s)   K_PROF = ' + K_PROF);
  console.log('  ' + 'quantity'.padEnd(28) + 'reference'.padStart(11) + 'model'.padStart(11) + 'error'.padStart(9));
  for (const [q, ref, got, tol] of rows) {
    console.log('  ' + q.padEnd(28) + String(ref).padStart(11) + got.toFixed(2).padStart(11) + (((got - ref) / ref) * 100).toFixed(1).padStart(8) + '%');
    assert.ok(Math.abs(got - ref) / ref < tol, `${q}: ${got} vs ${ref}`);
  }
  assert.ok(s.alphaFrac > 0.5 && s.alphaFrac < 0.8);
  assert.ok(Math.abs(s.pAlpha / s.pFus - I.eAlpha.v / I.eDT.v) < 1e-6);
  assert.ok(s.status === 'RUNNING' && !s.scrammed);
});

test('pulse phases run in order and the pulse ends in idle', () => {
  const m = fresh();
  assert.equal(m.state.phase, 'idle');
  assert.equal(m.state.status, 'SHUTDOWN');
  m.press('start');
  const seen = [];
  for (let i = 0; i < 20 * 700; i++) {
    m.advance(0.05);
    if (seen[seen.length - 1] !== m.state.phase) seen.push(m.state.phase);
  }
  console.log('\n  phases: ' + seen.join(' > '));
  assert.deepEqual(seen.filter((p) => p !== 'flattop' || true).slice(0, 5), ['magnetise', 'breakdown', 'rampup', 'flattop', 'burn']);
  assert.ok(seen.includes('rampdown') && seen[seen.length - 1] === 'idle');
  assert.equal(m.state.status, 'SHUTDOWN');
  assert.equal(m.state.Ip, 0);
  assert.equal(m.state.pFus, 0);
  assert.equal(m.state.endKind, 'ramp-down');
});

test('control directions', () => {
  const at = (set, extra = 120) => {
    const m = fresh();
    for (const [k, v] of Object.entries(set)) m.setControl(k, v);
    toBurn(m, extra);
    return m.state;
  };
  const ref = at({});
  const hot = at({ heat: 73 });
  const cold = at({ heat: 30 });
  assert.ok(hot.T > ref.T && ref.T > cold.T, `T ${cold.T} ${ref.T} ${hot.T}`);
  assert.ok(hot.pFus > ref.pFus && ref.pFus > cold.pFus);
  const dense = at({ fuel: 1.1 });
  const thin = at({ fuel: 0.7 });
  assert.ok(dense.pFus > ref.pFus && ref.pFus > thin.pFus, 'density raises fusion power');
  const lowT = at({ mix: 0.2 });
  const hiT = at({ mix: 0.8 });
  assert.ok(lowT.pFus < 0.75 * ref.pFus && hiT.pFus < 0.75 * ref.pFus, 'off-optimum D:T mix lowers fusion power');
  assert.ok(tauIPB(17, 5.3, 1, 100, 2.5) > tauIPB(15, 5.3, 1, 100, 2.5), 'more current, better confinement at equal loss power');
  assert.ok(tauIPB(15, 5.3, 1, 150, 2.5) < tauIPB(15, 5.3, 1, 100, 2.5), 'more loss power, worse confinement (power degradation)');
  const bigI = at({ ip: 17, fuel: 1.2 });
  assert.ok(bigI.pFus > ref.pFus, 'higher current allows more density and fusion power');
  const bigB = at({ bt: 6 });
  assert.ok(bigB.q95 > ref.q95);
  assert.ok(greenwald(15) > 1.19 && greenwald(15) < 1.20);
  assert.ok(Math.abs(q95of(15, 5.3) - 3) < 0.1);
});

test('limits end the pulse in a disruption with the broken limit named', () => {
  const m = fresh();
  toBurn(m, 60);
  m.setControl('fuel', 1.8);
  run(m, 60);
  assert.equal(m.state.status, 'TRIPPED');
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /Greenwald/);
  assert.ok(m.state.quenchMJ > 50);
  assert.equal(m.state.endKind, 'disruption');
  run(m, 5);
  assert.equal(m.state.plasma, false);
  assert.equal(m.state.Ip, 0);
  console.log('\n  disruption: ' + m.state.tripReason + ', stored energy dumped ' + m.state.quenchMJ.toFixed(0) + ' MJ');
  m.press('reset');
  run(m, 30);
  assert.equal(m.state.phase, 'idle');
  assert.equal(m.state.scrammed, false);

  const q = fresh();
  q.setControl('ip', 17);
  q.setControl('bt', 3.2);
  toBurn(q, 5);
  run(q, 120);
  assert.equal(q.state.status, 'TRIPPED');
  assert.match(q.state.tripReason, /q95/);
  console.log('  disruption: ' + q.state.tripReason);

});

test('beta limit (Troyon) can end a pulse', () => {
  const m = fresh();
  m.setControl('ip', 16);
  m.setControl('bt', 4.2);
  m.setControl('heat', 73);
  m.setControl('fuel', 1.25);
  toBurn(m, 5);
  run(m, 300);
  console.log('\n  beta test: ' + m.state.phase + ' ' + m.state.tripReason);
  assert.equal(m.state.status, 'TRIPPED');
  assert.match(m.state.tripReason, /Troyon/);
});

test('mitigation (shattered pellet) shuts down without a trip', () => {
  const m = fresh();
  toBurn(m, 100);
  const W = m.state.W;
  m.press('mitigate');
  assert.equal(m.state.phase, 'mitigate');
  assert.equal(m.state.status, 'RUNNING');
  run(m, 2);
  assert.ok(m.state.T < 0.3 * (W / 40));
  run(m, 60);
  assert.equal(m.state.phase, 'idle');
  assert.equal(m.state.scrammed, false);
  assert.equal(m.state.endKind, 'mitigated');
  assert.ok(m.state.quenchMJ > 100);
});

test('auto pulse: opens burning, ends, idles, restarts; manual control stops the restart', () => {
  const m = createModel();
  assert.equal(m.state.phase, 'burn');
  assert.equal(m.state.plasma, true);
  assert.ok(m.state.pFus > 400 && m.state.pFus < 600, 'frame 0 already burns: ' + m.state.pFus);
  assert.equal(m.state.time, 0);
  let sawIdle = false;
  let restarted = false;
  for (let i = 0; i < 20 * 700; i++) {
    m.advance(0.05);
    if (m.state.phase === 'idle') sawIdle = true;
    if (sawIdle && m.state.phase === 'magnetise') restarted = true;
  }
  assert.ok(sawIdle && restarted, 'idle then restart');
  const n = createModel();
  n.press('mitigate');
  let idle = false;
  for (let i = 0; i < 20 * 100; i++) {
    n.advance(0.05);
    if (n.state.phase === 'idle') idle = true;
  }
  assert.ok(idle, 'mitigation ends in idle; auto pulse then restarts');
  const m2 = createModel();
  m2.setControl('heat', 60);
  assert.equal(m2.state.manual, true);
  run(m2, 5);
  assert.equal(m2.state.phase, 'burn');
  m2.reset();
  assert.equal(m2.state.phase, 'burn');
  assert.equal(m2.controls.heat, 50);
});

test('zero heating and cold start stay finite and fade out', () => {
  const m = fresh();
  m.setControl('heat', 0);
  toBurn(m, 30);
  run(m, 100, 10);
  assert.ok(Number.isFinite(m.state.T) && m.state.T < 3, 'no heating, no burn: T=' + m.state.T);
  assert.ok(m.state.pFus < 5);
});

test('paused model does not move', () => {
  const m = createModel();
  const t = m.state.time;
  m.advance(0);
  assert.equal(m.state.time, t);
});

test('fuzz: 10,000 random control changes at random accelerations stay finite and bounded', () => {
  const m = fresh({ auto: true });
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const accels = [1, 10, 100, 1000];
  const ids = ['start', 'mitigate', 'reset'];
  let trips = 0;
  let maxP = 0;
  let maxT = 0;
  for (let i = 0; i < 10000; i++) {
    const r = rnd();
    if (r < 0.2) m.setControl('heat', rnd() * 73);
    else if (r < 0.4) m.setControl('fuel', 0.1 + rnd() * 1.7);
    else if (r < 0.55) m.setControl('ip', 3 + rnd() * 14);
    else if (r < 0.7) m.setControl('bt', 3 + rnd() * 3.5);
    else if (r < 0.8) m.setControl('mix', 0.05 + rnd() * 0.9);
    else if (r < 0.9) m.press(ids[Math.floor(rnd() * 3)]);
    else m.setControl('auto', rnd() < 0.5);
    const a = accels[Math.floor(rnd() * 4)];
    const dt = (1 / 60) * a;
    for (let k = 0; k < 6; k++) m.advance(dt);
    const s = m.state;
    for (const key in s) if (typeof s[key] === 'number') assert.ok(Number.isFinite(s[key]), `${key}=${s[key]} at ${i}`);
    assert.ok(s.T >= 0 && s.T <= 120 && s.n >= 0 && s.n <= 3 && s.Ip >= 0 && s.Ip <= 18 && s.B >= 0 && s.B <= 7, 'bounded');
    assert.ok(s.pFus >= 0 && s.pFus < 20000);
    assert.ok(['RUNNING', 'TRIPPED', 'SHUTDOWN'].includes(s.status));
    if (s.status === 'TRIPPED') trips++;
    maxP = Math.max(maxP, s.pFus);
    maxT = Math.max(maxT, s.T);
  }
  console.log(`\n  fuzz ok: ${trips} TRIPPED samples, max P_fus ${maxP.toFixed(0)} MW, max T ${maxT.toFixed(1)} keV`);
});
