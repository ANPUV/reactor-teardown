// PWR model: kit/kinetics.js with Westinghouse 4-loop parameters + plant-level derived quantities.
import { Reactor, PCM } from '../../kit/kinetics.js';
import { spec } from './spec.js';

const I = spec.items;

// Saturation table (T degC -> p MPa), IAPWS-IF97 values, log-linear interpolation.
const SAT = [
  [200, 1.554], [220, 2.318], [240, 3.344], [250, 3.973], [260, 4.688], [270, 5.499], [280, 6.417],
  [285, 6.899], [290, 7.445], [300, 8.588], [310, 9.865], [320, 11.28], [330, 12.86],
];
export function satPressure(T) {
  if (T <= SAT[0][0]) return SAT[0][1] * Math.exp((T - SAT[0][0]) * 0.03);
  for (let i = 1; i < SAT.length; i++) {
    if (T <= SAT[i][0]) {
      const [t0, p0] = SAT[i - 1];
      const [t1, p1] = SAT[i];
      const f = (T - t0) / (t1 - t0);
      return Math.exp(Math.log(p0) * (1 - f) + Math.log(p1) * f);
    }
  }
  return SAT[SAT.length - 1][1];
}

export const params = {
  id: 'pwr',
  Pnom: I.thermal.v,
  PeNom: I.electric.v,
  Tin0: I.tin.v,
  Tout0: I.tout.v,
  Tf0: 640, // volume-averaged fuel temperature at full power (teaching value)
  Lambda: I.lambda.v,
  betaEff: I.betaEff.v,
  alphaF: I.alphaF.v,
  alphaC: I.alphaC.v,
  rod: { W: 0.07, x0: 0.88 },
  rodSpeed: 0.025,
  tauFuel: 6,
  tauCool: 8,
  xenon: { worth: 0.028, burn: 3.7 },
  sink: { mode: 'load', kappa: 1.0, tau: 25, tripLoad: 0.05, tauLoad: 15 },
  trip: { overpower: 1.18, period: 3, periodMinN: 0.02, dTout: 20, enabled: true },
};

export function createModel() {
  const reactor = new Reactor(params);
  const Tc0 = reactor.Tc0;
  const Ts0 = I.steamTemp.v;
  const UAsg = I.thermal.v / (Tc0 - Ts0); // MW/K, all four steam generators
  const state = {};

  function derive() {
    const s = reactor.s;
    const flow = Math.max(s.flow, reactor.p.flowMin);
    const Tavg = s.Tc;
    state.time = s.time;
    state.n = s.n;
    state.powerPct = (100 * s.power) / params.Pnom;
    state.fissionPct = (100 * s.powerFission) / params.Pnom;
    state.decayPct = (100 * s.powerDecay) / params.Pnom;
    state.thermalMW = s.power;
    state.electricMW = s.powerElectric;
    state.Tin = s.Tin;
    state.Tout = s.Tout;
    state.Tavg = Tavg;
    state.Tfuel = s.Tf;
    state.flowFrac = flow;
    state.flowKgs = I.flow.v * flow;
    state.rodPos = s.rodPos;
    state.rodPct = s.rodPos * 100;
    state.rhoPcm = s.rho / PCM;
    state.rhoRodPcm = s.rhoParts.rod / PCM;
    state.rhoFuelPcm = s.rhoParts.fuel / PCM;
    state.rhoCoolPcm = s.rhoParts.coolant / PCM;
    state.xenonPcm = s.rhoParts.xenon / PCM;
    state.xenon = s.xe;
    state.iodine = s.I;
    state.keff = s.keff;
    state.periodS = s.period;
    state.load = s.load;
    state.loadPct = s.load * 100;
    state.scrammed = s.scrammed;
    state.tripReason = s.tripReason;
    state.turbineOnline = s.turbineOnline;
    state.steamMW = s.steamPower;
    const ts = Tavg - s.steamPower / UAsg;
    state.steamTemp = ts;
    state.steamPressure = satPressure(ts);
    state.pressure = Math.min(17.2, Math.max(11, I.pressure.v + 0.03 * (Tavg - Tc0)));
    state.pzrLevel = Math.min(95, Math.max(15, 25 + (35 * (Tavg - 291.7)) / (Tc0 - 291.7)));
    state.status = s.scrammed ? 'TRIPPED' : s.n < 0.01 ? 'SHUTDOWN' : 'RUNNING';
    state.fissionsPerSec = (s.powerFission * 1e6) / (I.fissionMeV.v * 1e6 * 1.602176634e-19);
    state.turbineSpeed = s.powerElectric / params.PeNom; // visual rate: proportional to electric output
    state.kRho = s.rho;
    return state;
  }

  derive();

  const model = {
    id: 'pwr',
    reactor,
    state,
    controls: reactor.controls,
    params,
    reset() {
      reactor.reset();
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
      reactor.advance(simDt);
      derive();
    },
    step(dt) {
      model.advance(dt);
    },
  };
  return model;
}
export default createModel;
