import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, satPressure } from '../src/machines/pwr/model.js';
import { spec } from '../src/machines/pwr/spec.js';

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
    ['Primary pressure (MPa)', I.pressure.v, s.pressure],
    ['Primary flow (kg/s)', I.flow.v, s.flowKgs],
    ['Steam pressure (MPa)', I.steamPressure.v, s.steamPressure],
    ['Steam temperature (degC)', I.steamTemp.v, s.steamTemp],
  ];
  console.log('\n  reference vs model (nominal, t = 600 s)');
  console.log('  ' + 'quantity'.padEnd(26) + 'reference'.padStart(11) + 'model'.padStart(11) + 'error'.padStart(9));
  for (const [q, ref, got] of rows) {
    console.log('  ' + q.padEnd(26) + String(ref).padStart(11) + got.toFixed(2).padStart(11) + (((got - ref) / ref) * 100).toFixed(2).padStart(8) + '%');
    assert.ok(Math.abs(got - ref) / ref < 0.02, `${q}: ${got} vs ${ref}`);
  }
  assert.ok(Math.abs(s.powerPct - 100) < 1);
});

test('inserting rods lowers power; withdrawing raises it, then feedback levels it off', () => {
  let m = createModel();
  m.setControl('rods', 0.8);
  run(m, 400);
  const low = m.state.powerPct;
  assert.ok(low < 95 && low > 40, `inserted: ${low}`);
  m = createModel();
  m.setControl('rods', 1.0);
  run(m, 30);
  const early = m.state.powerPct;
  run(m, 600);
  const late = m.state.powerPct;
  assert.ok(early > 100, `withdrawn early: ${early}`);
  assert.ok(late < early + 0.5 && late > 100 && late < 118 && !m.state.scrammed, `levelled: ${late} (early ${early})`);
  run(m, 300);
  assert.ok(Math.abs(m.state.powerPct - late) < 1, 'settled');
});

test('lower pump flow raises outlet temperature', () => {
  const m = createModel();
  m.setControl('flow', 0.8);
  run(m, 400);
  assert.ok(m.state.Tout > I.tout.v + 3, `Tout=${m.state.Tout}`);
});

test('raising turbine load pulls inlet temperature down and power up (load following)', () => {
  const m = createModel();
  m.setControl('load', 0.9);
  run(m, 600);
  const p0 = m.state.powerPct;
  const tin0 = m.state.Tin;
  m.setControl('load', 1.0);
  run(m, 600);
  assert.ok(m.state.Tin < tin0, `Tin ${tin0} -> ${m.state.Tin}`);
  assert.ok(m.state.powerPct > p0 + 2, `P ${p0} -> ${m.state.powerPct}`);
  assert.ok(m.state.electricMW > 0.95 * I.electric.v);
});

test('SCRAM drops power to decay-heat level and falls; trip reason is reported', () => {
  const m = createModel();
  run(m, 10);
  m.scram('Manual SCRAM');
  assert.equal(m.state.scrammed, true);
  assert.equal(m.state.tripReason, 'Manual SCRAM');
  const out = [];
  let prev = 100;
  for (const t of [5, 30, 120, 600, 3600]) {
    const target = t;
    const already = m.state.time - 10;
    run(m, target - already);
    out.push([t, m.state.powerPct]);
    assert.ok(m.state.powerPct < prev, `monotone fall at ${t}`);
    prev = m.state.powerPct;
  }
  console.log('\n  after SCRAM: ' + out.map(([t, p]) => `${t}s ${p.toFixed(2)}%`).join(' | '));
  const at = (t) => out.find((o) => o[0] === t)[1];
  assert.ok(at(30) < 8 && at(30) > 3, `30 s: ${at(30)}`);
  assert.ok(at(600) < 3 && at(600) > 0.9, `600 s: ${at(600)}`);
  assert.equal(m.state.electricMW, 0);
});

test('protection trips report a reason', () => {
  let m = createModel();
  m.setControl('rods', 1);
  m.reactor.controls.extraRho = 600; // pcm, a deliberate big reactivity insertion
  run(m, 60);
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /Overpower|Short-period|outlet/);
  console.log('\n  trip reason: ' + m.state.tripReason);
  m = createModel();
  m.setControl('flow', 0.03);
  m.reactor.controls.flow = 0.03;
  run(m, 600);
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /outlet|Overpower|period/i);
});

test('xenon builds after shutdown and blocks an immediate restart', () => {
  const m = createModel();
  m.scram();
  run(m, 6 * 3600, 100);
  assert.ok(m.state.xenonPcm < -1500, `xenon ${m.state.xenonPcm}`);
});

test('saturation table sanity', () => {
  assert.ok(Math.abs(satPressure(285) - 6.9) < 0.05);
});
