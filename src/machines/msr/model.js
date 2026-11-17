// MSBR model: kit/kinetics.js (liquid fuel, circulating precursors) + level / freeze-plug drain + Xe-135 with off-gas
// stripping + Pa-233 / U-233 ledger. Heat is made in the salt itself; graphite is the slow second thermal mass.
import { Reactor, PCM, DECAY_FRACTION, KEEPIN_LAMBDA, scaleGroups } from '../../kit/kinetics.js';
import { spec } from './spec.js';

const I = spec.items;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Teaching parameters not in the reference table
const T_CORE = 5.4; // s a salt element spends in core + plenums
const T_LOOP = 8.2; // s in pumps, piping and heat exchangers
const LEVEL_WORTH = 0.3; // dk/k lost when the circuit is empty (core fully voided)
const XE_WORTH = 0.02; // dk/k of unstripped equilibrium xenon (thermal flux, teaching value)
const XE_BURN = 3.7;
const STRIP = 1 / 600; // 1/s effective off-gas removal of dissolved xenon
const X = { lambdaI: 2.93e-5, lambdaX: 2.09e-5, gammaI: 0.0639, gammaX: 0.0024 };
const ALPHA_CAP = 0.09; // U-233 capture / fission
const NA = 6.02214076e23;
const E_FISS = 200e6 * 1.602176634e-19; // J
const KG_PER_FISSION = 233 / NA / 1000;
const LAM_PA = Math.LN2 / (I.halfPa233.v * 86400); // 1/s
const REMOVE = 1 / (I.processDays.v * 86400); // 1/s Pa removal to the decay tank
const K_CAP = 2.0e-8; // Pa-233 neutron capture rate per unit n (1/s)
const K_PA_RHO = 1.0 * PCM; // dk/k per kg Pa in core above nominal
const TANK_C_SALT = (I.saltVolume.v * I.density.v * I.cp.v) / 1e6; // MJ/K for all salt
const TANK_C_STEEL = 25;
const U_COOL = 0.15; // MW/K drain-tank cooling thimbles
const T_COOL = 300;
const T_PLUG_COLD = 430;
const KAPPA_RUN = 0.25;

export const params = {
  id: 'msr',
  Pnom: I.thermal.v,
  PeNom: I.electric.v,
  Tin0: I.tin.v,
  Tout0: I.tout.v,
  Tf0: 655, // mean graphite temperature (teaching value)
  Lambda: I.lambda.v,
  betaEff: I.betaEff.v,
  alphaF: I.alphaGraphite.v, // "fuel" lump of the kit = graphite
  alphaC: I.alphaSalt.v, // "coolant" lump = fuel salt
  rod: { W: 0.006, x0: 0.85 },
  rodSpeed: 0.02,
  scramTime: 3,
  tauFuel: 20, // graphite: large thermal mass
  tauCool: 9,
  tauPump: 6,
  fuelHeatFraction: 0.07, // ~7 % of heat is deposited in the graphite; the rest in the salt
  sink: { mode: 'load', kappa: KAPPA_RUN, tau: 30, tripLoad: 0.06, tauLoad: 12 },
  circulating: { tCore: T_CORE, tLoop: T_LOOP },
  source: 1e-6,
  trip: { overpower: 1.18, period: 3, periodMinN: 0.02, dTout: 60, enabled: true },
};

/** Fraction of delayed neutrons lost to the loop at pump speed `flow` (steady state of the kit's precursor model). */
export function betaLost(flow) {
  const beta = scaleGroups(params.betaEff);
  const a = flow / T_CORE;
  const b = flow / T_LOOP;
  let lost = 0;
  for (let i = 0; i < 6; i++) {
    const lam = KEEPIN_LAMBDA[i];
    lost += beta[i] * (1 - lam / (lam + a - (a * b) / (lam + b)));
  }
  return lost;
}
const LOST0 = betaLost(1);

const MODES = ['ready', 'thawing', 'draining', 'drained', 'filling', 'freezing'];

export function createModel() {
  const reactor = new Reactor({ ...params, hooks: { reactivity: (s, c) => hookRho(), afterStep: (s, h) => after(s, h) } });
  const state = {};
  const x = {}; // extended state (also copied to `state`)
  const XE0 = (X.lambdaX * (1 + XE_BURN)) / (X.lambdaX * (1 + XE_BURN) + STRIP);
  const D0 = ((params.Pnom * 1e6) / E_FISS) * KG_PER_FISSION; // kg/s fissioned at n = 1 (200 MeV per fission includes the decay-heat share)
  const PPROD = (I.breeding.v * (1 + ALPHA_CAP) * D0) / (1 - K_CAP / (LAM_PA + K_CAP + REMOVE));
  const CTH = PPROD / D0;
  const PC0 = PPROD / (LAM_PA + K_CAP + REMOVE);
  const PT0 = (REMOVE * PC0) / LAM_PA;

  function resetExt() {
    x.mode = 'ready';
    x.t = 0;
    x.level = 1;
    x.plugT = T_PLUG_COLD;
    x.Tt = 540;
    x.I = 1;
    x.xe = XE0;
    x.pc = PC0;
    x.pt = PT0;
    x.u = I.fissile.v;
    x.bred = 0;
    x.burned = 0;
    x.th = I.thorium.v;
    x.bredRate = LAM_PA * (PC0 + PT0);
    x.prodPa = PPROD;
    x.capPa = K_CAP * PC0;
    x.burnRate = (1 + ALPHA_CAP) * D0;
    x.rhoLevel = 0;
    x.rhoXe = 0;
    x.rhoPa = 0;
    x.strip = 1;
    x.paOn = 1;
  }
  resetExt();

  function hookRho() {
    const lvl = clamp((1 - x.level - 0.04) / 0.96, 0, 1);
    x.rhoLevel = -LEVEL_WORTH * lvl;
    x.rhoXe = -XE_WORTH * (x.xe - XE0);
    x.rhoPa = -K_PA_RHO * (x.pc - PC0);
    return LOST0 + x.rhoLevel + x.rhoXe + x.rhoPa;
  }

  function after(s, h) {
    const c = reactor.controls;
    reactor.p.sink.kappa = s.scrammed ? 1.2 : KAPPA_RUN; // stiff decay-heat removal after a trip keeps the salt above its freezing point
    // ---- freeze plug / level machine
    x.t += h;
    if (x.mode === 'thawing') {
      x.plugT += ((I.liquidus.v - T_PLUG_COLD) / I.plugThaw.v) * h;
      if (x.plugT >= I.liquidus.v) {
        x.mode = 'draining';
        reactor.scram('Freeze plug thawed: fuel draining');
      }
    } else if (x.mode === 'draining') {
      x.plugT = Math.min(620, x.plugT + 3 * h);
      const r = Math.max(0, Math.sqrt(x.level) - h / I.drainTime.v);
      x.level = r * r;
      if (x.level <= 1e-6) {
        x.level = 0;
        x.mode = 'drained';
      }
    } else if (x.mode === 'filling') {
      x.level = Math.min(1, x.level + h / I.refillTime.v);
      if (x.level >= 1) {
        x.mode = 'freezing';
      }
    } else if (x.mode === 'freezing') {
      x.plugT = Math.max(T_PLUG_COLD, x.plugT - ((620 - T_PLUG_COLD) / 45) * h);
      if (x.plugT <= T_PLUG_COLD) x.mode = 'ready';
    }
    const L = x.level;

    // ---- drain tank heat balance
    const mNew = 1 - L;
    const mOld = x.mPrev === undefined ? mNew : x.mPrev;
    const dm = mNew - mOld;
    x.mPrev = mNew;
    const C0 = mOld * TANK_C_SALT + TANK_C_STEEL;
    const C1 = mNew * TANK_C_SALT + TANK_C_STEEL;
    if (dm > 0) x.Tt = (x.Tt * C0 + dm * TANK_C_SALT * s.Tc) / (C0 + dm * TANK_C_SALT);
    const pTank = s.powerDecay * (1 - L);
    const heater = mNew > 0.001 ? clamp((540 - x.Tt) * 0.5, 0, 10) : 0;
    x.tankMW = pTank;
    if (mNew < 0.001) x.Tt += (540 - x.Tt) * (1 - Math.exp(-h / 600));
    else x.Tt = clamp(x.Tt + (h * (pTank + heater - U_COOL * (x.Tt - T_COOL))) / C1, 100, 1400);

    // ---- xenon and iodine (implicit)
    const n = s.n;
    x.I = (x.I + h * X.lambdaI * n) / (1 + h * X.lambdaI);
    const gI = X.gammaI / (X.gammaI + X.gammaX);
    const prod = X.lambdaX * (1 + XE_BURN) * ((1 - gI) * n + gI * x.I);
    const loss = X.lambdaX + XE_BURN * X.lambdaX * n + (c.strip ? STRIP : 0);
    x.xe = clamp((x.xe + h * prod) / (1 + h * loss), 0, 5);

    // ---- Pa-233 / U-233 ledger (kg)
    const dFiss = D0 * (s.powerFission / (params.Pnom * (1 - DECAY_FRACTION))); // kg/s of U-233 fissioned
    const destroyed = (1 + ALPHA_CAP) * dFiss;
    const prodPa = CTH * dFiss;
    const rem = c.paOn ? REMOVE : 0;
    const capK = K_CAP * n;
    x.pc = (x.pc + h * prodPa) / (1 + h * (LAM_PA + capK + rem));
    x.pt = (x.pt + h * rem * x.pc) / (1 + h * LAM_PA);
    const bredNow = LAM_PA * (x.pc + x.pt);
    x.u = Math.max(0, x.u + h * (bredNow - destroyed));
    x.th = Math.max(0, x.th - h * prodPa);
    x.bred += h * bredNow;
    x.burned += h * destroyed;
    x.prodPa = prodPa;
    x.capPa = capK * x.pc;
    x.bredRate = bredNow;
    x.burnRate = destroyed;
  }

  function derive() {
    const s = reactor.s;
    const L = x.level;
    const avail = smooth(0.1, 0.5, L);
    const flow = Math.max(s.flow, reactor.p.flowMin);
    const wFull = smooth(0.02, 0.4, L);
    const mix = (v) => wFull * v + (1 - wFull) * x.Tt;
    state.time = s.time;
    state.n = s.n;
    state.powerPct = (100 * s.power) / params.Pnom;
    state.fissionPct = (100 * s.powerFission) / params.Pnom;
    state.decayPct = (100 * s.powerDecay) / params.Pnom;
    state.thermalMW = s.power;
    state.electricMW = s.powerElectric;
    state.steamMW = s.steamPower;
    state.rejectedMW = Math.max(0, s.steamPower - s.powerElectric);
    state.Tin = mix(s.Tin);
    state.Tout = mix(s.Tout);
    state.Tavg = mix(s.Tc);
    state.Tgraphite = mix(s.Tf);
    state.flowFrac = flow * avail;
    state.flowKgs = I.flow.v * flow * avail;
    state.rodPos = s.rodPos;
    state.rodPct = s.rodPos * 100;
    state.load = s.load;
    state.loadPct = s.load * 100;
    const lost = betaLost(flow);
    const rhoDyn = s.rho - lost;
    state.rhoPcm = rhoDyn / PCM;
    state.keff = 1 / (1 - rhoDyn);
    state.rhoRodPcm = s.rhoParts.rod / PCM;
    state.rhoSaltPcm = s.rhoParts.coolant / PCM;
    state.rhoGraphitePcm = s.rhoParts.fuel / PCM;
    state.rhoLevelPcm = x.rhoLevel / PCM;
    state.betaCore = params.betaEff - lost; // in-core delayed fraction at the current pump speed
    state.betaLostPct = (100 * lost) / params.betaEff;
    state.periodS = s.period;
    state.scrammed = s.scrammed;
    state.tripReason = s.tripReason;
    state.turbineOnline = s.turbineOnline;
    state.turbineSpeed = s.powerElectric / params.PeNom;
    state.status = s.scrammed ? 'TRIPPED' : s.n < 0.01 ? 'SHUTDOWN' : 'RUNNING';
    // level / plug / tank
    state.level = L;
    state.levelPct = 100 * L;
    state.drainMode = x.mode;
    state.plugT = x.plugT;
    state.plugFrozen = x.plugT < I.liquidus.v;
    state.tankT = x.Tt;
    state.tankFill = 1 - L;
    state.tankVolume = (1 - L) * I.saltVolume.v;
    state.tankMW = x.tankMW || 0;
    state.freezeMargin = state.Tin - I.liquidus.v;
    // xenon
    state.xenonPcm = -XE_WORTH * x.xe / PCM;
    state.xenonRel = x.xe;
    state.stripOn = reactor.controls.strip ? 1 : 0;
    // ledger
    state.paOn = reactor.controls.paOn ? 1 : 0;
    state.paCoreKg = x.pc;
    state.paTankKg = x.pt;
    state.paKg = x.pc + x.pt;
    state.u233Kg = x.u;
    state.thKg = x.th;
    state.bredKgDay = x.bredRate * 86400;
    state.burnedKgDay = x.burnRate * 86400;
    state.netKgDay = (x.bredRate - x.burnRate) * 86400;
    state.breedingNow = x.burnRate > 1e-12 ? (x.prodPa - x.capPa) / x.burnRate : 0; // new U-233 per fissile atom destroyed, net of Pa-233 lost to capture
    // compound doubling time on ORNL's basis: ln 2 / (annual fissile yield), with the design plant factor
    const yieldPerYear = (I.plantFactor.v * state.netKgDay * 365.25) / Math.max(1, x.u);
    state.doublingYears = yieldPerYear > 1e-6 ? Math.LN2 / yieldPerYear : Infinity;
    state.yieldPctYear = 100 * yieldPerYear;
    state.bredCumKg = x.bred;
    state.burnedCumKg = x.burned;
    state.paCaptureFrac = x.prodPa > 1e-30 ? x.capPa / x.prodPa : 0;
    state.thCaptureRate = CTH; // Th-232 captures per fission (mass basis)
    state.fissionsPerSec = (s.powerFission * 1e6) / E_FISS;
    // secondary and steam sides (teaching)
    const sf = clamp(s.steamPower / params.Pnom, 0, 1.3);
    state.coolantIn = I.coolantIn.v + 0.0 * sf;
    state.coolantOut = I.coolantIn.v + (I.coolantOut.v - I.coolantIn.v) * sf;
    state.steamTemp = s.turbineOnline ? I.steamTemp.v : I.steamTemp.v - 120 * (1 - sf);
    state.gridMW = s.powerElectric;
    return state;
  }

  const controls = reactor.controls;
  controls.strip = 1;
  controls.paOn = 1;
  reactor.s.rho = LOST0;
  reactor.s.keff = 1 / (1 - LOST0);
  derive();

  const model = {
    id: 'msr',
    reactor,
    state,
    controls,
    params,
    reset() {
      reactor.reset();
      controls.strip = 1;
      controls.paOn = 1;
      resetExt();
      x.mPrev = undefined;
      reactor.s.rho = LOST0;
      derive();
    },
    setControl(key, v) {
      if (key in controls) controls[key] = v;
    },
    scram(reason) {
      reactor.scram(reason || 'Manual SCRAM');
      derive();
    },
    resetTrip() {
      reactor.resetTrip();
      controls.load = Math.min(controls.load, 0.05); // restart at low turbine load, then bring the load up
      derive();
    },
    canDrain: () => ['ready', 'filling', 'freezing'].includes(x.mode),
    canRefill: () => x.level < 1 && x.mode !== 'filling' && x.mode !== 'freezing',
    drain() {
      if (!model.canDrain()) return;
      x.mode = 'thawing';
      if (x.level < 1 && x.plugT < I.liquidus.v) x.plugT = Math.max(x.plugT, T_PLUG_COLD);
      derive();
    },
    refill() {
      if (!model.canRefill()) return;
      x.mode = 'filling';
      if (x.plugT < I.liquidus.v) x.plugT = I.liquidus.v + 1;
      derive();
    },
    press(id) {
      if (id === 'scram') model.scram('Manual SCRAM');
      else if (id === 'reset') model.resetTrip();
      else if (id === 'drain') model.drain();
      else if (id === 'refill') model.refill();
    },
    advance(simDt) {
      reactor.advance(simDt);
      derive();
    },
    step(dt) {
      model.advance(dt);
    },
    ext: x,
    constants: { LOST0, XE0, PC0, PT0, D0, CTH },
  };
  return model;
}
export default createModel;
void MODES;
