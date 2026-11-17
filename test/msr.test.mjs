import test from 'node:test';
import assert from 'node:assert/strict';
import { createModel, betaLost } from '../src/machines/msr/model.js';
import { spec } from '../src/machines/msr/spec.js';

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
  const eff = (100 * s.electricMW) / s.thermalMW;
  const rows = [
    ['Thermal power (MWt)', I.thermal.v, s.thermalMW, 0.02],
    ['Net electric (MWe)', I.electric.v, s.electricMW, 0.02],
    ['Core inlet (degC)', I.tin.v, s.Tin, 0.02],
    ['Core outlet (degC)', I.tout.v, s.Tout, 0.02],
    ['Fuel-salt flow (kg/s)', I.flow.v, s.flowKgs, 0.02],
    ['Efficiency (%)', 44.4, eff, 0.02],
    ['Salt volume in circuit (m3)', I.saltVolume.v, s.level * I.saltVolume.v, 0.001],
    ['Fissile inventory (kg U-233)', I.fissile.v, s.u233Kg, 0.001],
    ['Breeding ratio (ledger)', I.breeding.v, s.breedingNow, 0.02],
    ['Doubling time (y, compound, 80 % plant factor)', I.doubling.v, s.doublingYears, 0.1],
  ];
  console.log('\n  reference vs model (nominal, t = 600 s)');
  console.log('  ' + 'quantity'.padEnd(34) + 'reference'.padStart(11) + 'model'.padStart(11) + 'error'.padStart(9));
  for (const [q, ref, got, tol] of rows) {
    console.log('  ' + q.padEnd(34) + String(ref).padStart(11) + got.toFixed(3).padStart(11) + (((got - ref) / ref) * 100).toFixed(2).padStart(8) + '%');
    assert.ok(Math.abs(got - ref) / ref < tol, `${q}: ${got} vs ${ref}`);
  }
  assert.ok(Math.abs(s.powerPct - 100) < 1);
  assert.ok(Math.abs(s.rhoPcm) < 5, 'dynamic reactivity ~0 at nominal');
  console.log(`  beta_eff static ${(I.betaEff.v*1e3).toFixed(2)}e-3, in-core ${(s.betaCore*1e3).toFixed(2)}e-3; delayed neutrons lost to the loop: ${s.betaLostPct.toFixed(0)} %`);
});

test('rods: inserting lowers power; withdrawing raises it, then negative feedback levels it off', () => {
  let m = createModel();
  m.setControl('rods', 0.7);
  run(m, 600);
  assert.ok(m.state.powerPct < 90 && m.state.powerPct > 20, `inserted: ${m.state.powerPct}`);
  m = createModel();
  m.setControl('rods', 1.0);
  run(m, 40);
  const early = m.state.powerPct;
  run(m, 900);
  const late = m.state.powerPct;
  assert.ok(early > 100 && late > 100 && late < 118 && !m.state.scrammed, `early ${early} late ${late}`);
  run(m, 300);
  assert.ok(Math.abs(m.state.powerPct - late) < 1, 'settled');
});

test('load following: turbine demand moves power with the rods untouched', () => {
  const m = createModel();
  m.setControl('load', 0.6);
  run(m, 900);
  const s = m.state;
  console.log(`\n  load 60 %: power ${s.powerPct.toFixed(1)} %, Tin ${s.Tin.toFixed(1)}, Tout ${s.Tout.toFixed(1)}, Tavg ${s.Tavg.toFixed(1)}, rods ${s.rodPct.toFixed(1)} %`);
  assert.ok(Math.abs(s.powerPct - 60) < 4, `power ${s.powerPct}`);
  assert.equal(s.rodPct, 85);
  assert.ok(Math.abs(s.Tavg - 635) < 25, 'mean salt temperature nearly constant');
  assert.ok(s.Tout < I.tout.v - 20 && s.Tin > I.tin.v + 5, 'outlet falls, inlet rises');
  m.setControl('load', 1.0);
  run(m, 900);
  assert.ok(Math.abs(m.state.powerPct - 100) < 3 && !m.state.scrammed);
  assert.ok(m.state.electricMW > 0.95 * I.electric.v);
});

test('pump speed: slower pump keeps precursors in the core (positive reactivity), raises outlet temperature', () => {
  const m = createModel();
  assert.ok(betaLost(0.5) < betaLost(1));
  m.setControl('flow', 0.7);
  run(m, 1);
  assert.ok(m.state.rhoPcm > 0, `rho ${m.state.rhoPcm}`);
  run(m, 20);
  assert.ok(m.state.betaCore > 1.05 * (I.betaEff.v - betaLost(1)) && m.state.betaCore < I.betaEff.v, `betaCore ${m.state.betaCore}`);
  run(m, 600);
  assert.ok(m.state.Tout > I.tout.v + 10, `Tout ${m.state.Tout}`);
  assert.ok(!m.state.scrammed || /outlet|Overpower|period/i.test(m.state.tripReason));
});

test('SCRAM: power falls to decay heat, trip reason reported, turbine off', () => {
  const m = createModel();
  run(m, 10);
  m.scram('Manual SCRAM');
  assert.equal(m.state.tripReason, 'Manual SCRAM');
  run(m, 60);
  assert.ok(m.state.powerPct < 8 && m.state.powerPct > 3, `${m.state.powerPct}`);
  run(m, 3600);
  assert.ok(m.state.powerPct < 2.5 && m.state.powerPct > 0.5);
  assert.equal(m.state.electricMW, 0);
  assert.ok(m.state.Tin > I.liquidus.v, 'salt stays above freezing: ' + m.state.Tin);
});

test('freeze-plug drain: plug thaws, level falls, reactor goes deeply subcritical, decay heat moves to the tank; refill restores', () => {
  const m = createModel();
  run(m, 120);
  m.press('drain');
  assert.equal(m.state.drainMode, 'thawing');
  run(m, 30);
  assert.equal(m.state.level, 1);
  assert.ok(m.state.plugFrozen);
  run(m, 40);
  assert.ok(m.state.drainMode === 'draining' || m.state.drainMode === 'drained');
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /Freeze plug/);
  const t0 = m.state.time;
  let prev = 1;
  while (m.state.drainMode !== 'drained' && m.state.time - t0 < 400) {
    m.advance(1);
    assert.ok(m.state.level <= prev + 1e-12);
    prev = m.state.level;
  }
  assert.equal(m.state.drainMode, 'drained');
  assert.ok(m.state.time - t0 < I.drainTime.v + 15, 'drain time ' + (m.state.time - t0));
  assert.ok(m.state.rhoPcm < -5000, `rho ${m.state.rhoPcm}`);
  run(m, 60);
  assert.ok(m.state.powerPct < 6 && m.state.powerPct > 0.5);
  assert.ok(Math.abs(m.state.tankVolume - I.saltVolume.v) < 0.1);
  run(m, 1800);
  assert.ok(m.state.tankT > 400 && m.state.tankT < 1000, 'tank ' + m.state.tankT);
  assert.ok(m.state.tankMW > 5, 'decay heat in tank ' + m.state.tankMW);
  console.log(`\n  drained: tank ${m.state.tankT.toFixed(0)} degC, ${m.state.tankMW.toFixed(1)} MW, reactivity ${m.state.rhoPcm.toFixed(0)} pcm`);
  m.press('refill');
  assert.equal(m.state.drainMode, 'filling');
  run(m, I.refillTime.v + 5);
  assert.equal(m.state.level, 1);
  run(m, 60);
  assert.equal(m.state.drainMode, 'ready');
  assert.ok(m.state.plugFrozen);
  assert.ok(m.state.rhoLevelPcm > -1, 'level reactivity gone: ' + m.state.rhoLevelPcm);
  m.press('reset');
  assert.equal(m.state.scrammed, false);
  m.setControl('rods', 0.85);
  run(m, 300);
  assert.ok(m.state.powerPct > 1 && !m.state.scrammed, `restart power ${m.state.powerPct} ${m.state.tripReason}`);
  m.setControl('load', 1.0);
  let t = 0;
  while (m.state.powerPct < 90 && t < 6000) {
    run(m, 10);
    t += 10;
  }
  console.log(`  restart after refill: 90 % power ${t + 300} s after reset (rods to 85 %, then load to 100 %)`);
  assert.ok(m.state.powerPct >= 90 && !m.state.scrammed, `restart ${t} ${m.state.tripReason}`);
});

test('draining can be interrupted: refill during the drain', () => {
  const m = createModel();
  m.press('drain');
  run(m, 100);
  assert.equal(m.state.drainMode, 'draining');
  m.press('refill');
  run(m, 300);
  assert.equal(m.state.level, 1);
  assert.equal(m.state.drainMode, 'ready');
});

test('xenon: off-gas strips it; with stripping off it builds like a PWR', () => {
  const m = createModel();
  run(m, 3600, 100);
  assert.ok(Math.abs(m.state.xenonPcm) < 250, `stripped worth ${m.state.xenonPcm}`);
  const m2 = createModel();
  m2.scram();
  run(m2, 6 * 3600, 100);
  assert.ok(m2.state.xenonPcm > -200, 'no post-shutdown xenon peak when stripped: ' + m2.state.xenonPcm);
  const m3 = createModel();
  m3.setControl('strip', 0);
  run(m3, 8 * 3600, 100);
  console.log(`\n  xenon worth: stripped ${m.state.xenonPcm.toFixed(0)} pcm, unstripped after 8 h ${m3.state.xenonPcm.toFixed(0)} pcm, power ${m3.state.powerPct.toFixed(0)} %`);
  assert.ok(m3.state.xenonPcm < -1000, `${m3.state.xenonPcm}`);
  assert.ok(m3.state.powerPct < 60);
});

test('Pa-233 / U-233 ledger: breeding ratio 1.06 with removal, worse without; Pa decays to U-233 after SCRAM', () => {
  const m = createModel();
  run(m, 3600, 100);
  assert.ok(Math.abs(m.state.breedingNow - 1.06) < 0.02, `${m.state.breedingNow}`);
  assert.ok(m.state.netKgDay > 0.05 && m.state.netKgDay < 0.4, `net ${m.state.netKgDay}`);
  const u0 = m.state.u233Kg;
  const m2 = createModel();
  m2.setControl('paOn', 0);
  for (let i = 0; i < 20 * 86400 / 120; i++) m2.advance(120);
  console.log(`\n  Pa-233 in core: removal on ${m.state.paCoreKg.toFixed(1)} kg, off after 20 d ${m2.state.paCoreKg.toFixed(1)} kg; breeding ratio ${m2.state.breedingNow.toFixed(3)}; Pa poison ${(m2.state.rhoPcm).toFixed(0)} pcm`);
  assert.ok(m2.state.paCoreKg > 2 * m.state.paCoreKg);
  assert.ok(m2.state.breedingNow < m.state.breedingNow - 0.01);
  const m3 = createModel();
  m3.scram();
  for (let i = 0; i < 10 * 86400 / 120; i++) m3.advance(120);
  assert.ok(m3.state.u233Kg > u0 + 2, 'U-233 grows after shutdown as Pa decays');
  assert.ok(m3.state.burnedKgDay < 0.2 * m.state.burnedKgDay);
});

test('protection trips report a reason', () => {
  let m = createModel();
  m.setControl('rods', 1);
  m.reactor.controls.extraRho = 900;
  run(m, 120);
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /Overpower|Short-period|outlet/);
  console.log('\n  trip reason: ' + m.state.tripReason);
  m = createModel();
  m.reactor.controls.flow = 0.03;
  run(m, 900);
  assert.equal(m.state.scrammed, true);
  assert.match(m.state.tripReason, /outlet|Overpower|period/i);
});

test('fuzz: 10,000 random control changes at random accelerations stay finite and bounded', () => {
  const m = createModel();
  let seed = 12345;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const accels = [1, 10, 100, 1000];
  const acts = ['scram', 'reset', 'drain', 'refill'];
  for (let i = 0; i < 10000; i++) {
    const k = r();
    if (k < 0.2) m.setControl('rods', r());
    else if (k < 0.4) m.setControl('flow', 0.05 + r() * 1.2);
    else if (k < 0.6) m.setControl('load', r() * 1.1);
    else if (k < 0.65) m.setControl('strip', r() < 0.5 ? 0 : 1);
    else if (k < 0.7) m.setControl('paOn', r() < 0.5 ? 0 : 1);
    else if (k < 0.74) m.press(acts[Math.floor(r() * 4)]);
    m.advance((1 / 60) * accels[Math.floor(r() * 4)] * (r() < 0.05 ? 20 : 1));
    for (const [key, v] of Object.entries(m.state)) {
      if (typeof v === 'number') assert.ok(!Number.isNaN(v) && (Number.isFinite(v) || key === 'periodS' || key === 'doublingYears'), `${key}=${v} at ${i}`);
    }
    const s = m.state;
    assert.ok(s.powerPct < 5000 && s.Tout < 3000 && s.level >= 0 && s.level <= 1 && s.tankT < 1400, `bounds at ${i}`);
  }
});
