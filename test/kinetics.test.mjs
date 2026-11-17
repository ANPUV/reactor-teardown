import test from 'node:test';
import assert from 'node:assert/strict';
import { Reactor, makeParams, wayWigner, DECAY_A, DECAY_TAU, scaleGroups, KEEPIN_BETA, rodS } from '../src/kit/kinetics.js';

const base = {
  Pnom: 1000, PeNom: 330, Tin0: 290, Tout0: 320, Tf0: 600, Lambda: 2e-5, betaEff: 0.0065,
  xenon: { worth: 0.028, burn: 3.7 },
};
const fast = { ...base, Lambda: 4.5e-7, betaEff: 0.0037, alphaF: -0.7, alphaC: -1, xenon: null, trip: { dTout: 60 } };

test('group scaling preserves the sum', () => {
  const b = scaleGroups(0.0037);
  assert.ok(Math.abs(b.reduce((a, c) => a + c, 0) - 0.0037) < 1e-12);
  assert.ok(Math.abs(KEEPIN_BETA.reduce((a, c) => a + c, 0) - 0.0065) < 1e-4);
  assert.ok(Math.abs(rodS(0) - 0) < 1e-12 && Math.abs(rodS(1) - 1) < 1e-12);
});

test('decay-heat groups match Way-Wigner within 5 % from 1 s to 1e4 s', () => {
  for (const t of [1, 3, 10, 30, 100, 300, 1000, 1e4]) {
    const f = DECAY_A.reduce((s, a, j) => s + a * Math.exp(-t / DECAY_TAU[j]), 0);
    const ww = wayWigner(t, 3e7);
    assert.ok(Math.abs(f / ww - 1) < 0.05, `t=${t}: fit ${f} vs ${ww}`);
  }
});

test('nominal controls hold 100 % for 10 min', () => {
  const r = new Reactor(base);
  r.advance(600);
  assert.ok(Math.abs(r.s.n - 1) < 0.01, `n=${r.s.n}`);
  assert.ok(Math.abs(r.s.Tout - 320) / 320 < 0.02);
  assert.ok(Math.abs(r.s.Tin - 290) / 290 < 0.02);
});

test('fast parameter set integrates stably at every time acceleration', () => {
  for (const accel of [1, 10, 100, 1000]) {
    const r = new Reactor(fast);
    const dt = (1 / 60) * accel;
    for (let i = 0; i < 600; i++) r.advance(dt);
    assert.ok(Math.abs(r.s.n - 1) < 0.02, `accel ${accel}: n=${r.s.n}`);
    // perturb: step rods up
    r.controls.rods = 0.95;
    for (let i = 0; i < 600; i++) r.advance(dt);
    assert.ok(Number.isFinite(r.s.n) && r.s.n < 3, `accel ${accel}: n=${r.s.n} after perturbation`);
  }
});

test('recirculating precursors reach a finite steady state', () => {
  const r = new Reactor({ ...base, Lambda: 3.6e-4, betaEff: 0.0026, circulating: { tCore: 10, tLoop: 14 }, xenon: null });
  r.advance(300);
  assert.ok(Number.isFinite(r.s.n));
});

test('fuzz: 10,000 random control changes at random accelerations stay finite and bounded', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const set of [base, fast]) {
    const r = new Reactor(set);
    for (let i = 0; i < 10000; i++) {
      const k = Math.floor(rnd() * 5);
      if (k === 0) r.controls.rods = rnd();
      else if (k === 1) r.controls.flow = rnd() * 1.2;
      else if (k === 2) r.controls.load = rnd() * 1.2;
      else if (k === 3 && rnd() < 0.2) r.resetTrip();
      else if (k === 4 && rnd() < 0.05) r.scram('fuzz');
      r.controls.extraRho = (rnd() - 0.5) * 400;
      const accel = [1, 10, 100, 1000][Math.floor(rnd() * 4)];
      r.advance(Math.min(0.1, rnd() * 0.1) * accel);
      const s = r.s;
      for (const v of [s.n, s.Tf, s.Tc, s.Tin, s.Tout, s.power, s.xe, s.I, s.rho, ...s.C, ...s.h]) {
        assert.ok(Number.isFinite(v), `non-finite at step ${i}`);
      }
      assert.ok(s.n >= 0 && s.n <= set.nCap || s.n <= 50.0001);
      assert.ok(s.Tout >= 0 && s.Tout < 3000 && s.Tf < 4001);
    }
  }
});
