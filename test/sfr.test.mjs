import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, TRIP_DTOUT } from '../src/machines/sfr/model.js';
import { spec, BURN } from '../src/machines/sfr/spec.js';

const I = spec.items;
const run = (m, seconds, accel = 1) => {
  const dt = (1 / 60) * accel;
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++) m.advance(dt);
};

test('reference vs model at nominal controls after 10 simulated minutes', () => {
  const m = createModel();
  run(m, 600);
  const s = m.state;
  const rows = [
    ['Thermal power (MWt)', I.thermal.v, s.thermalMW],
    ['Electric output (MWe)', I.electric.v, s.electricMW],
    ['Core inlet (degC)', I.tin.v, s.Tin],
    ['Core outlet (degC)', I.tout.v, s.Tout],
    ['Primary flow (kg/s)', I.flow.v, s.flowKgs],
    ['Secondary cold (degC)', I.secIn.v, s.secCold],
    ['Secondary hot (degC)', I.secOut.v, s.secHot],
    ['Steam temperature (degC)', I.steamTemp.v, s.steamTemp],
    ['Fissile fissioned (kg/day)', I.fissionedPerDay.v, s.fissionedKgDay],
    ['Pu-239 bred (kg/day)', I.bredPerDay.v, s.bredKgDay],
  ];
  console.log('\n  reference vs model (nominal, t = 600 s)');
  console.log('  ' + 'quantity'.padEnd(28) + 'reference'.padStart(11) + 'model'.padStart(11) + 'error'.padStart(9));
  for (const [q, ref, got] of rows) {
    console.log('  ' + q.padEnd(28) + String(ref).padStart(11) + got.toFixed(2).padStart(11) + (((got - ref) / ref) * 100).toFixed(2).padStart(8) + '%');
    assert.ok(Math.abs(got - ref) / ref < 0.02, `${q}: ${got} vs ${ref}`);
  }
  assert.ok(Math.abs(s.powerPct - 100) < 1);
  assert.ok(Math.abs(BURN.kgPerDay - 2.2) < 0.1, `kg/day ${BURN.kgPerDay}`);
  assert.ok(Math.abs(s.ledgerRatio - I.br.v) < 0.02);
  // 1 dollar = betaEff
  assert.ok(Math.abs(I.dollar.v - I.betaEff.v * 1e5) < 1);
});

test('inserting rods lowers power; withdrawing raises it a little, feedback levels it off', () => {
  let m = createModel();
  m.setControl('rods', 0.8);
  run(m, 400);
  const low = m.state.powerPct;
  assert.ok(low < 90 && low > 40, `inserted: ${low}`);
  m = createModel();
  m.setControl('rods', 1.0);
  run(m, 600);
  assert.ok(m.state.powerPct > 102 && m.state.powerPct < 118 && !m.state.scrammed, `withdrawn: ${m.state.powerPct}`);
  assert.ok(m.state.rhoPcm < 5 && m.state.rhoPcm > -5, 'feedback cancels the rod reactivity');
});

test('reactivity in dollars is rho / beta_eff and prompt jump is small for under 1 dollar', () => {
  const m = createModel();
  m.reactor.controls.extraRho = 100; // pcm = 0.27 $
  run(m, 0.05);
  assert.ok(Math.abs(m.state.rhoDollar - m.state.rhoPcm / 370) < 1e-9);
  assert.ok(m.state.n > 1.1 && m.state.n < 1.5, `prompt jump n=${m.state.n}`);
});

test('lower pump flow raises outlet temperature, power falls by feedback', () => {
  const m = createModel();
  m.setControl('flow', 0.8);
  run(m, 500);
  assert.ok(m.state.Tout > I.tout.v + 15 && !m.state.scrammed, `Tout=${m.state.Tout}`);
  assert.ok(m.state.powerPct < 99, `power ${m.state.powerPct}`);
  assert.ok(Math.abs(m.state.Tin - I.tin.v) < 1, 'inlet is held by the sink');
});

test('large flow loss trips on high outlet temperature, far below boiling', () => {
  const m = createModel();
  m.setControl('flow', 0.3);
  run(m, 300);
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /outlet/i);
  assert.ok(m.state.marginK > 100, `margin ${m.state.marginK}`);
  assert.ok(TRIP_DTOUT > 0);
});

test('SCRAM drops power to decay-heat level and falls; trip reason is reported; breeding continues for days', () => {
  const m = createModel();
  run(m, 10);
  m.scram('Manual SCRAM');
  assert.equal(m.state.tripReason, 'Manual SCRAM');
  const out = [];
  let prev = 100;
  for (const t of [5, 30, 120, 600, 3600]) {
    run(m, t - (m.state.time - 10));
    out.push([t, m.state.powerPct]);
    assert.ok(m.state.powerPct < prev, `monotone fall at ${t}`);
    prev = m.state.powerPct;
  }
  console.log('\n  after SCRAM: ' + out.map(([t, p]) => `${t}s ${p.toFixed(2)}%`).join(' | '));
  const at = (t) => out.find((o) => o[0] === t)[1];
  assert.ok(at(30) < 9 && at(30) > 3, `30 s: ${at(30)}`);
  assert.ok(at(600) < 3 && at(600) > 0.9, `600 s: ${at(600)}`);
  assert.equal(m.state.electricMW, 0);
  // Np-239 keeps decaying into Pu-239 long after the fission stops
  const b0 = m.state.bredKgDay;
  assert.ok(b0 > 0.5 * I.bredPerDay.v, `bred/day after one hour ${b0}`);
  run(m, 5 * 86400, 1000);
  assert.ok(m.state.bredKgDay < b0 && m.state.bredKgDay > 0, 'decays slowly over days');
});

test('breeding ledger accumulates with time and tracks power', () => {
  const m = createModel();
  run(m, 86400, 1000);
  const days = m.state.time / 86400;
  assert.ok(Math.abs(m.state.puBurnedKg / days - I.destroyedPerDay.v) / I.destroyedPerDay.v < 0.02);
  assert.ok(Math.abs(m.state.puBredKg / days - I.bredPerDay.v) / I.bredPerDay.v < 0.02, `bred ${m.state.puBredKg}`);
  assert.ok(Math.abs(m.state.puNetKg) < 0.1 * m.state.puBurnedKg);
  const m2 = createModel();
  m2.setControl('rods', 0.8);
  run(m2, 3600);
  assert.ok(m2.state.burnedKgDay < m.state.burnedKgDay);
});

test('protection trips report a reason', () => {
  const m = createModel();
  m.reactor.controls.extraRho = 600;
  run(m, 60);
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /Overpower|Short-period|outlet/);
  console.log('\n  trip reason: ' + m.state.tripReason);
});

test('reset restores nominal and resetTrip re-arms', () => {
  const m = createModel();
  m.scram();
  run(m, 100);
  m.resetTrip();
  assert.equal(m.state.scrammed, false);
  m.reset();
  assert.equal(m.state.time, 0);
  assert.ok(Math.abs(m.state.powerPct - 100) < 1e-6);
});

test('fuzz: 10000 random control changes at random accelerations stay finite and bounded', () => {
  const m = createModel();
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const accels = [1, 10, 100, 1000];
  for (let i = 0; i < 10000; i++) {
    const r = rnd();
    if (r < 0.2) m.setControl('rods', rnd());
    else if (r < 0.4) m.setControl('flow', 0.03 + rnd() * 1.1);
    else if (r < 0.43) m.press('scram');
    else if (r < 0.5) m.press('reset');
    else if (r < 0.52) m.reactor.controls.extraRho = (rnd() - 0.5) * 400;
    else if (r < 0.53) m.reset();
    m.advance((1 / 60) * accels[Math.floor(rnd() * 4)]);
    for (const [k, v] of Object.entries(m.state)) if (typeof v === 'number' && k !== 'periodS') assert.ok(Number.isFinite(v), `${k}=${v} at ${i}`);
    assert.ok(m.state.Tout > -50 && m.state.Tout < 3000 && m.state.n >= 0 && m.state.n <= 50);
  }
});
