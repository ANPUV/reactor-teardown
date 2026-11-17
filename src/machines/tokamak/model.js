// Tokamak 0-D model (PLAN 4.2). Pure JS, no three. Does not use kit/kinetics.
//
//   dW/dt = P_aux + P_ohm + P_alpha - W/tau_E - P_brem,   W = 3 n T V
//   P_fus = k_prof * n_D n_T <sigma v>(T) * 17.59 MeV * V,   P_alpha = P_fus * 3.5/17.59
//   tau_E = IPB98(y,2) with the total heating power
//
// The ONE calibration factor is K_PROF: a 0-D plasma with flat profiles under-counts reactions because the real
// n and T profiles are peaked (reaction rate goes as n^2 <sigma v>(T), both peak in the core). K_PROF is the
// ratio real/flat. It is chosen so the reference controls (50 MW heating, n = 1e20 m^-3, 15 MA, 5.3 T,
// 50:50 D:T) give about 500 MW of fusion power, Q about 10. Everything else is physics or a spec item.
import { spec } from './spec.js';

const I = spec.items;
const KEV = 1.602176634e-16; // J per keV
const MEV = 1.602176634e-13; // J per MeV
export const K_PROF = 1.3; // calibration factor, see header

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------- Bosch-Hale D-T reactivity
const BG = 34.3827;
const MRC2 = 1124656;
const C1 = 1.17302e-9;
const C2 = 1.51361e-2;
const C3 = 7.51886e-2;
const C4 = 4.60643e-3;
const C5 = 1.35e-2;
const C6 = -1.0675e-4;
const C7 = 1.366e-5;
/** <sigma v> for D-T in cm^3/s, T in keV. */
export function sigmaVcm3(T) {
  T = clamp(T, 0.2, 200);
  const th = T / (1 - (T * (C2 + T * (C4 + T * C6))) / (1 + T * (C3 + T * (C5 + T * C7))));
  const xi = Math.cbrt((BG * BG) / (4 * th));
  return C1 * th * Math.sqrt(xi / (MRC2 * T * T * T)) * Math.exp(-3 * xi);
}
/** <sigma v> in m^3/s. */
export const sigmaV = (T) => sigmaVcm3(T) * 1e-6;

// ---------------------------------------------------------------- plasma formulae
const R0 = I.R.v;
const A0 = I.a.v;
const V0 = I.volume.v;
const EPS = A0 / R0;
const KAPPA_A = V0 / (2 * Math.PI * Math.PI * R0 * A0 * A0); // IPB98 uses the volume-based elongation
const SHAPE_K = I.kappa.v;
const SHAPE_D = I.delta.v;

export const greenwald = (ip) => ip / (Math.PI * A0 * A0); // 1e20 m^-3, ip in MA
/** Edge safety factor q95 (ITER Physics Basis cylindrical-plus-shape fit). */
export function q95of(ip, B) {
  if (ip < 0.05) return 99;
  const k = SHAPE_K;
  const d = SHAPE_D;
  const shape = (1 + k * k * (1 + 2 * d * d - 1.2 * d * d * d)) / 2;
  const toro = (1.17 - 0.65 * EPS) / Math.pow(1 - EPS * EPS, 2);
  return ((5 * A0 * A0 * B) / (R0 * ip)) * shape * toro;
}
/** IPB98(y,2) energy confinement time in s; P in MW, n in 1e20 m^-3, M in amu. */
export function tauIPB(ip, B, n, P, M, H = I.h98.v) {
  const n19 = Math.max(n * 10, 0.05);
  return (
    0.0562 * H * Math.pow(Math.max(ip, 0.05), 0.93) * Math.pow(B, 0.15) * Math.pow(n19, 0.41) * Math.pow(Math.max(P, 1), -0.69) *
    Math.pow(R0, 1.97) * Math.pow(EPS, 0.58) * Math.pow(KAPPA_A, 0.78) * Math.pow(M, 0.19)
  );
}

// ---------------------------------------------------------------- model
const NOM = { heat: I.paux.v, fuel: 1.0, ip: I.ip.v, bt: I.bt.v, mix: 0.5 };
const LIM = { heat: [0, I.pinst.v], fuel: [0.1, 1.8], ip: [3, 17], bt: [3, 6.5], mix: [0.05, 0.95] };

export const params = {
  id: 'tokamak',
  kProf: K_PROF,
  tauN: 6, // s, density relaxation (pellet fuelling)
  tauHeat: 2, // s, heating systems ramp
  rampB: 0.7, // T/s
  rampIp: I.rampRate.v, // MA/s (compressed relative to ITER, flagged in spec)
  tauCQ: 0.5, // s, current quench time (real: tens of ms; stretched so it can be seen)
  tauMit: 0.3, // s, radiative thermal quench after a shattered pellet
  rateMit: 2.0, // MA/s controlled current decay after mitigation
  nRamp: 0.7, // density kept below this fraction of Greenwald during ramps
  burnTime: I.burn.v,
  autoIdle: 4, // s of idle before the next automatic pulse
  dBreak: 2, // s, breakdown
};

export function createModel(opts = {}) {
  const warmStart = opts.warm !== false;
  const controls = { ...NOM, auto: opts.auto !== false };
  const state = {};
  const m = {}; // internal
  const refHeat = I.paux.v + I.pfus.v * (I.eAlpha.v / I.eDT.v); // 150 MW total heating at the reference point

  function zero() {
    Object.assign(state, {
      time: 0,
      status: 'SHUTDOWN',
      scrammed: false,
      tripReason: '',
      phase: 'idle',
      phaseT: 0,
      plasma: false,
      manual: false, // visitor took control for this pulse
      endKind: 'none', // 'none' | 'ramp-down' | 'mitigated' | 'disruption'
      quenchMJ: 0,
      Ip: 0,
      B: 0,
      n: 0,
      nSet: 0,
      T: 0,
      Tmk: 0,
      TcoreMk: 0,
      fHe: 0,
      W: 0,
      pAux: 0,
      pOhm: 0,
      pFus: 0,
      pAlpha: 0,
      pBrem: 0,
      pNeutron: 0,
      tauE: 0,
      triple: 0,
      Q: 0,
      betaN: 0,
      q95: 99,
      fGW: 0,
      nGW: 0,
      wallLoad: 0,
      alphaFrac: 0,
      sigmaV: 0,
      sigmaVcm3: 0,
      flatT: 0,
      tf: 0,
      cs: 0,
      pf: 0,
      pNBI: 0,
      pEC: 0,
      pIC: 0,
      pelletRate: 0,
      blanketHeat: 0,
      divHeat: 0,
      flash: 0, // breakdown flash, decays
      breakFrac: 0,
      quench: 0, // 0 = steady, 1 = just disrupted, decays
      ipFrac: 0,
      q95Visual: 3,
    });
    m.ip0 = 0;
  }
  zero();

  function setPhase(p) {
    state.phase = p;
    state.phaseT = 0;
    if (p === 'idle') state.manual = false;
    state.status = ['idle', 'winddown'].includes(p) ? 'SHUTDOWN' : p === 'tripped' || p === 'disruption' ? 'TRIPPED' : 'RUNNING';
  }

  function trip(reason) {
    const s = state;
    s.scrammed = true;
    s.tripReason = reason;
    s.quenchMJ = s.W;
    s.endKind = 'disruption';
    s.quench = 1;
    m.ip0 = Math.max(s.Ip, 0.5);
    s.T = Math.min(s.T, 0.05); // thermal quench: the stored energy goes to the wall in milliseconds
    setPhase('disruption');
  }

  function mitigate() {
    const s = state;
    if (!s.plasma) {
      if (['magnetise', 'breakdown'].includes(s.phase)) {
        s.endKind = 'ramp-down';
        setPhase('winddown');
      }
      return;
    }
    if (['mitigate', 'disruption', 'tripped'].includes(s.phase)) return;
    s.quenchMJ = s.W;
    s.endKind = 'mitigated';
    setPhase('mitigate');
  }

  function derive() {
    const s = state;
    const ne = s.n * 1e20;
    s.nGW = greenwald(s.Ip);
    s.fGW = s.nGW > 1e-6 ? s.n / s.nGW : 0;
    s.q95 = s.plasma ? q95of(s.Ip, s.B) : 99;
    s.W = (3 * ne * V0 * s.T * KEV) / 1e6;
    const pMean = (s.W * 1e6) / (1.5 * V0); // mean pressure, 2 n T = W / (1.5 V)
    const beta = s.B > 0.1 ? (2 * 4e-7 * Math.PI * pMean) / (s.B * s.B) : 0;
    s.betaN = s.Ip > 0.3 ? (100 * beta * A0 * s.B) / s.Ip : 0;
    s.Tmk = s.T * I.kevK.v;
    s.TcoreMk = s.Tmk * I.tPeak.v;
    s.triple = ne * s.T * s.tauE;
    s.Q = s.pFus / Math.max(s.pAux, 0.5);
    s.wallLoad = (I.nFrac.v / 100) * s.pFus / I.firstWall.v;
    s.pNeutron = s.pFus - s.pAlpha;
    const pHeat = s.pAux + s.pOhm + s.pAlpha;
    s.alphaFrac = pHeat > 0.01 ? s.pAlpha / pHeat : 0;
    s.pNBI = (s.pAux * I.pnbi.v) / I.pinst.v;
    s.pEC = (s.pAux * I.pec.v) / I.pinst.v;
    s.pIC = (s.pAux * I.pic.v) / I.pinst.v;
    s.ipFrac = s.Ip / I.ip.v;
    s.tf = clamp(s.B / I.bt.v, 0, 1.3);
    s.q95Visual = clamp(s.q95, 1.5, 8);
  }

  function ramp(v, target, rate, h) {
    const d = target - v;
    const st = rate * h;
    return Math.abs(d) <= st ? target : v + Math.sign(d) * st;
  }

  /** One plasma energy / particle sub-step. */
  function plasmaStep(h, auxTarget, nSet, tauN = params.tauN) {
    const s = state;
    s.pAux += (auxTarget - s.pAux) * (1 - Math.exp(-h / params.tauHeat));
    s.nSet = nSet;
    s.n += (nSet - s.n) * (1 - Math.exp(-h / tauN));
    s.n = clamp(s.n, 0.005, 3);
    const T = clamp(s.T, 0.02, 120);
    const ne = s.n * 1e20;
    const dil = clamp(0.96 - 2 * s.fHe, 0.3, 1);
    const ni = ne * dil;
    const xT = controls.mix;
    const sv = sigmaV(T);
    const rate = params.kProf * ni * ni * (1 - xT) * xT * sv; // reactions /m^3 /s
    const eV = (V0 * MEV) / 1e6; // MW per (reactions/m^3/s)
    s.sigmaV = sv;
    s.sigmaVcm3 = sv * 1e6;
    s.pFus = rate * I.eDT.v * eV;
    s.pAlpha = rate * I.eAlpha.v * eV;
    s.pBrem = (5.35e-37 * I.zeff.v * ne * ne * Math.sqrt(T) * V0) / 1e6;
    const ipr = s.Ip / I.ip.v;
    s.pOhm = Math.min(25, 12 * ipr * ipr * Math.pow(T, -1.5));
    const pHeat = s.pAux + s.pOhm + s.pAlpha;
    const M = 2 * (1 - xT) + 3 * xT;
    const tau = clamp(tauIPB(s.Ip, s.B, s.n, pHeat - s.pBrem, M) /* loss power: heating minus radiated */, 0.01, 60);
    s.tauE = tau;
    const C = (3 * ne * V0 * KEV) / 1e6; // MJ per keV
    const S0 = pHeat - s.pBrem;
    const Sp = -1.5 * s.pOhm / T - 0.5 * s.pBrem / T; // d(source)/dT, negative: treated implicitly
    let Tn = ((C / h) * T + S0 - Sp * T) / (C / h - Sp + C / tau);
    if (!(Tn > 0)) Tn = 0.02;
    s.T = clamp(Tn, 0.02, 120);
    // helium ash: produced at the reaction rate, removed with tau_He = 5 tau_E
    const src = rate / ne;
    s.fHe = clamp((s.fHe + h * src) / (1 + h / (I.heMult.v * tau)), 0, 0.3);
    // slow thermal lumps for the blanket and divertor tint
    const bTarget = s.pNeutron / (I.pfus.v * (1 - I.eAlpha.v / I.eDT.v));
    s.blanketHeat += (bTarget - s.blanketHeat) * (1 - Math.exp(-h / 20));
    const dTarget = Math.max(0, pHeat - s.pBrem) / refHeat;
    s.divHeat += (dTarget - s.divHeat) * (1 - Math.exp(-h / 10));
    s.pelletRate = clamp(60 * (Math.max(0, nSet - s.n) / tauN + 0.03 * s.n), 0, 8);
  }

  function plasmaOff() {
    const s = state;
    s.plasma = false;
    s.T = 0;
    s.n = 0;
    s.nSet = 0;
    s.W = 0;
    s.pFus = s.pAlpha = s.pBrem = s.pOhm = s.pNeutron = 0;
    s.pAux = 0;
    s.tauE = 0;
    s.fHe = 0;
    s.Ip = 0;
    s.pelletRate = 0;
    s.sigmaV = s.sigmaVcm3 = 0;
  }

  function checkLimits() {
    const s = state;
    if (s.Ip < 1) return;
    if (s.fGW > I.gwLimit.v) return trip('Greenwald density limit exceeded');
    if (s.betaN > I.betaNLimit.v) return trip('Troyon beta limit exceeded (plasma pressure too high)');
    if (s.q95 < I.q95Limit.v) return trip('Edge safety factor q95 fell below 2 (current too high for the field)');
  }

  function step(h) {
    const s = state;
    s.time += h;
    s.phaseT += h;
    const ph0 = s.phase;
    s.quench = Math.max(0, s.quench - h / 3);
    s.flash = Math.max(0, s.flash - h / 0.7);
    s.breakFrac = ph0 === 'breakdown' ? Math.min(1, s.phaseT / params.dBreak) : 0;
    const ph = s.phase;
    let cs = s.cs;
    switch (ph) {
      case 'idle':
        s.B = ramp(s.B, 0, params.rampB, h);
        cs = ramp(cs, 0, 0.2, h);
        if (controls.auto && !s.manual && s.phaseT > params.autoIdle) startPulse();
        break;
      case 'winddown': {
        s.B = ramp(s.B, 0, params.rampB, h);
        cs = ramp(cs, 0, 0.2, h);
        s.pf = ramp(s.pf, 0, 0.3, h);
        if (s.B <= 0.01 && cs <= 0.01) setPhase('idle');
        break;
      }
      case 'tripped':
        s.B = ramp(s.B, 0, params.rampB, h);
        cs = ramp(cs, 0, 0.2, h);
        if (controls.auto && !s.manual && s.phaseT > params.autoIdle + 4) {
          s.scrammed = false;
          s.tripReason = '';
          setPhase('winddown');
        }
        break;
      case 'magnetise':
        s.B = ramp(s.B, controls.bt, params.rampB, h);
        cs = ramp(cs, 1, 0.2, h);
        s.pf = ramp(s.pf, 0.35, 0.1, h);
        if (Math.abs(s.B - controls.bt) < 0.01 && cs >= 0.999) setPhase('breakdown');
        break;
      case 'breakdown':
        s.B = ramp(s.B, controls.bt, params.rampB, h);
        if (s.phaseT >= params.dBreak) {
          s.plasma = true;
          s.Ip = 0.3;
          s.n = 0.03;
          s.T = 0.03;
          s.fHe = 0;
          s.tauE = 0.05;
          s.flash = 1;
          setPhase('rampup');
        }
        break;
      case 'rampup': {
        s.B = ramp(s.B, controls.bt, params.rampB, h);
        s.Ip = ramp(s.Ip, controls.ip, params.rampIp, h);
        derive();
        plasmaStep(h, 0, Math.max(0.03, Math.min(controls.fuel, params.nRamp * s.nGW)));
        cs = 1 - 0.1 * (s.Ip / controls.ip);
        s.pf = 0.35 + 0.65 * s.ipFrac;
        if (Math.abs(s.Ip - controls.ip) < 0.05) setPhase('flattop');
        break;
      }
      case 'flattop':
      case 'burn': {
        s.B = ramp(s.B, controls.bt, params.rampB * 0.4, h);
        s.Ip = ramp(s.Ip, controls.ip, params.rampIp, h);
        s.flatT += h;
        derive();
        plasmaStep(h, controls.heat, controls.fuel);
        cs = clamp(0.9 - 0.7 * (s.flatT / params.burnTime), 0.15, 1);
        s.pf = 0.35 + 0.65 * s.ipFrac;
        const want = s.Q >= 1 && s.pFus > 5 ? 'burn' : 'flattop';
        if (want !== s.phase && (want === 'burn' || s.Q < 0.6)) setPhase(want);
        if (s.flatT >= params.burnTime) {
          s.endKind = 'ramp-down';
          setPhase('rampdown');
        }
        break;
      }
      case 'rampdown': {
        s.Ip = ramp(s.Ip, 0, params.rampIp, h);
        derive();
        plasmaStep(h, 0, Math.max(0.02, Math.min(controls.fuel, 0.5 * s.nGW)), 1.5);
        cs = clamp(cs - 0.003 * h, 0.1, 1);
        s.pf = 0.35 + 0.65 * s.ipFrac;
        if (s.Ip <= 0.3) {
          plasmaOff();
          setPhase('winddown');
        }
        break;
      }
      case 'mitigate': {
        s.Ip = ramp(s.Ip, 0, params.rateMit, h);
        derive();
        plasmaStep(h, 0, s.n);
        s.T = Math.max(0.02, s.T * Math.exp(-h / params.tauMit)); // radiated by the shattered-pellet impurities
        s.pAux = 0;
        s.pf = 0.35 + 0.65 * s.ipFrac;
        if (s.Ip <= 0.3) {
          plasmaOff();
          setPhase('winddown');
        }
        break;
      }
      case 'disruption': {
        s.Ip *= Math.exp(-h / params.tauCQ);
        s.T = Math.max(0.02, s.T * Math.exp(-h / 0.05));
        s.n = Math.max(0.005, s.n * Math.exp(-h / 2));
        s.pAux = 0;
        s.pFus = s.pAlpha = s.pOhm = s.pBrem = 0;
        s.pNeutron = 0;
        s.W = 0;
        s.tauE = 0.01;
        s.blanketHeat *= Math.exp(-h / 20);
        s.divHeat = Math.max(s.divHeat, 0.9 * Math.min(1, s.quenchMJ / 350)) * Math.exp(-h / 3);
        if (s.Ip <= 0.2) {
          plasmaOff();
          setPhase('tripped');
        }
        break;
      }
      default:
    }
    s.cs = cs;
    if (!s.plasma) {
      s.blanketHeat *= Math.exp(-h / 20);
      s.divHeat *= Math.exp(-h / 10);
      s.pelletRate = 0;
    }
    derive();
    if (s.plasma && ['rampup', 'flattop', 'burn', 'rampdown'].includes(s.phase)) checkLimits();
    if (!Number.isFinite(s.T) || !Number.isFinite(s.n) || !Number.isFinite(s.Ip)) {
      // last-resort guard: cannot happen in the tested envelope, but never leak NaN to the UI
      plasmaOff();
      setPhase('winddown');
      derive();
    }
  }

  function startPulse() {
    const s = state;
    s.endKind = 'none';
    s.quenchMJ = 0;
    s.flatT = 0;
    s.scrammed = false;
    s.tripReason = '';
    setPhase('magnetise');
  }

  function warm() {
    // open in a running state: run one pulse silently up to a burning flat-top at the controls
    startPulse();
    for (let i = 0; i < 20000 && !(state.phase === 'burn' && state.flatT > 60); i++) step(0.05);
    state.time = 0;
    state.manual = false;
  }

  const model = {
    id: 'tokamak',
    state,
    controls,
    params,
    reset() {
      Object.assign(controls, NOM, { auto: opts.auto !== false });
      zero();
      derive();
      if (warmStart) warm();
    },
    setControl(key, v) {
      if (key === 'auto') {
        controls.auto = !!v;
        return;
      }
      if (!(key in LIM) || !Number.isFinite(v)) return;
      const nv = clamp(v, LIM[key][0], LIM[key][1]);
      if (Math.abs(nv - controls[key]) > 1e-9) state.manual = true;
      controls[key] = nv;
    },
    press(id) {
      const s = state;
      const before = s.phase;
      if (id === 'start') {
        if (s.phase === 'idle' || (s.phase === 'winddown' && !s.plasma)) startPulse();
      } else if (id === 'mitigate') mitigate();
      else if (id === 'reset') {
        if (s.phase === 'tripped' || s.phase === 'disruption') {
          if (s.phase === 'tripped') {
            s.scrammed = false;
            s.tripReason = '';
            setPhase('winddown');
          }
        } else if (['rampup', 'flattop', 'burn'].includes(s.phase)) {
          s.endKind = 'ramp-down';
          setPhase('rampdown');
        } else if (['magnetise', 'breakdown'].includes(s.phase)) {
          s.endKind = 'ramp-down';
          setPhase('winddown');
        }
      }
      if (s.phase !== before && s.phase !== 'idle') s.manual = true;
      derive();
    },
    scram(reason) {
      mitigate();
      void reason;
    },
    resetTrip() {
      model.press('reset');
    },
    advance(simDt) {
      if (!(simDt > 0)) return;
      simDt = Math.min(simDt, 600);
      const hMax = state.plasma ? 0.02 : 0.25;
      const h = Math.max(hMax, simDt / 3000);
      let left = simDt;
      while (left > 1e-9) {
        const d = Math.min(h, left);
        step(d);
        left -= d;
      }
    },
  };
  derive();
  if (warmStart) warm();
  derive();
  return model;
}
export default createModel;
