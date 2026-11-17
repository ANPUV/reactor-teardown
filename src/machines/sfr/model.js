// SFR model: kit/kinetics.js with BN-800 parameters + circuits + breeding ledger.
//
// Heat sink decision (documented, see README of this machine in the report): FIXED. The primary inlet is held near
// 354 C by the secondary sodium and steam generators (a huge thermal mass: pool plus 3 loops), so the plant is
// reactor-led: electric output = 41.9 % of whatever heat the core makes. There is no turbine-load control; the
// controls are rods, primary pump flow, SCRAM and reset. This is what makes the inherent feedback visible: pull rods
// or slow the pumps and the outlet temperature, not the inlet, moves.
import { Reactor, PCM } from '../../kit/kinetics.js';
import { spec, BURN } from './spec.js';

const I = spec.items;
const LN2 = Math.LN2;
export const params = {
  id: 'sfr',
  Pnom: I.thermal.v,
  PeNom: I.electric.v,
  Tin0: I.tin.v,
  Tout0: I.tout.v,
  Tf0: 1000, // volume-averaged MOX temperature at full power (teaching value)
  Lambda: I.lambda.v,
  betaEff: I.betaEff.v,
  alphaF: I.alphaF.v,
  alphaC: I.alphaC.v,
  rod: { W: 0.04, x0: 0.88 },
  rodSpeed: 0.025,
  tauFuel: 5,
  tauCool: 3,
  tauPump: 6,
  xenon: null,
  sink: { mode: 'fixed', kappa: 1.0, tau: 30, tripLoad: 0.05, tauLoad: 15 },
  trip: { overpower: 1.18, period: 3, periodMinN: 0.02, dTout: 60, enabled: true },
};
export const TRIP_DTOUT = params.trip.dTout;

export function createModel() {
  const reactor = new Reactor(params);
  const state = {};
  const lam1 = LN2 / (I.tU239.v * 60);
  const lam2 = LN2 / (I.tNp239.v * 86400);
  const destroyNom = (BURN.kgPerDay * (1 + I.alphaCap.v)) / 86400; // kg/s at n = 1
  const G2 = I.thermal.v / (I.secOut.v - I.secIn.v); // MW/K secondary (constant secondary flow)
  const steamDrop = I.secOut.v - I.steamTemp.v;
  const led = { U: 0, Np: 0, burned: 0, bred: 0, captured: 0 };

  function ledgerReset() {
    const C = destroyNom * I.br.v;
    led.U = C / lam1;
    led.Np = C / lam2;
    led.burned = 0;
    led.bred = 0;
    led.captured = 0;
  }
  function ledgerStep(dt, n) {
    const destroy = destroyNom * n;
    const C = destroy * I.br.v;
    led.U = (led.U + dt * C) / (1 + lam1 * dt);
    led.Np = (led.Np + dt * lam1 * led.U) / (1 + lam2 * dt);
    led.bred += dt * lam2 * led.Np;
    led.burned += dt * destroy;
    led.captured += dt * C;
  }

  function derive() {
    const s = reactor.s;
    const flow = Math.max(s.flow, reactor.p.flowMin);
    state.time = s.time;
    state.n = s.n;
    state.powerPct = (100 * s.power) / params.Pnom;
    state.fissionPct = (100 * s.powerFission) / params.Pnom;
    state.decayPct = (100 * s.powerDecay) / params.Pnom;
    state.thermalMW = s.power;
    state.electricMW = s.powerElectric;
    state.rejectedMW = Math.max(0, s.steamPower - s.powerElectric);
    state.Tin = s.Tin;
    state.Tout = s.Tout;
    state.Tavg = s.Tc;
    state.Tfuel = s.Tf;
    state.flowFrac = flow;
    state.flowKgs = I.flow.v * flow;
    state.rodPos = s.rodPos;
    state.rodPct = s.rodPos * 100;
    state.rhoPcm = s.rho / PCM;
    state.rhoDollar = s.rho / I.betaEff.v;
    state.rhoRodPcm = s.rhoParts.rod / PCM;
    state.rhoFuelPcm = s.rhoParts.fuel / PCM;
    state.rhoCoolPcm = s.rhoParts.coolant / PCM;
    state.keff = s.keff;
    state.periodS = s.period;
    state.scrammed = s.scrammed;
    state.tripReason = s.tripReason;
    state.turbineOnline = s.turbineOnline;
    state.steamMW = s.steamPower;
    state.status = s.scrammed ? 'TRIPPED' : s.n < 0.01 ? 'SHUTDOWN' : 'RUNNING';
    state.marginK = I.naBoil.v - s.Tout;
    state.secCold = I.secIn.v;
    state.secHot = I.secIn.v + s.steamPower / G2;
    state.steamTemp = state.secHot - steamDrop;
    state.turbineSpeed = s.powerElectric / params.PeNom;
    // fission and breeding ledger
    state.fissionsPerSec = BURN.fissionsPerS * s.n;
    state.burnedKgDay = destroyNom * s.n * 86400;
    state.fissionedKgDay = BURN.kgPerDay * s.n;
    state.capturedKgDay = destroyNom * s.n * I.br.v * 86400;
    state.bredKgDay = lam2 * led.Np * 86400;
    state.breedingRatio = s.n > 0.005 ? I.br.v : 0;
    state.bladeKgDay = state.capturedKgDay * I.brBlanket.v; // blanket share of U-238 captures
    state.puBurnedKg = led.burned;
    state.puBredKg = led.bred;
    state.puNetKg = led.bred - led.burned;
    state.u239Kg = led.U;
    state.np239Kg = led.Np;
    state.ledgerRatio = led.burned > 1e-9 ? led.bred / led.burned : I.br.v;
    return state;
  }
  ledgerReset();
  derive();

  const model = {
    id: 'sfr',
    reactor,
    state,
    controls: reactor.controls,
    params,
    reset() {
      reactor.reset();
      ledgerReset();
      derive();
    },
    setControl(key, v) {
      if (key in reactor.controls) reactor.controls[key] = v;
    },
    scram(reason) {
      reactor.scram(reason || 'Manual SCRAM');
      derive();
    },
    resetTrip() {
      reactor.resetTrip();
      derive();
    },
    press(id) {
      if (id === 'scram') model.scram('Manual SCRAM');
      else if (id === 'reset') model.resetTrip();
    },
    advance(simDt) {
      if (!(simDt > 0)) return;
      reactor.advance(simDt);
      ledgerStep(simDt, reactor.s.n);
      derive();
    },
    step(dt) {
      model.advance(dt);
    },
  };
  return model;
}
export default createModel;
