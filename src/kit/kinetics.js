// kit/kinetics.js - lumped reactor kinetics + thermal + decay heat + xenon. PURE JS, no three import.
// Used by every fission machine (pwr, sfr, msr). See CONTRACT.md "kinetics" for the parameter table.
//
// Units: power in MW, temperature in degC, time in s, reactivity as Delta-k/k (dimensionless).
// Coefficients are given in pcm/K (1 pcm = 1e-5 Delta-k/k).

export const PCM = 1e-5;

// Keepin thermal U-235 six-group delayed neutron data.
export const KEEPIN_BETA = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
export const KEEPIN_LAMBDA = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
const KEEPIN_SUM = KEEPIN_BETA.reduce((a, b) => a + b, 0);

/** Delayed-neutron fractions scaled so that they sum to betaEff (other fuels). */
export function scaleGroups(betaEff) {
  return KEEPIN_BETA.map((b) => (b * betaEff) / KEEPIN_SUM);
}

/** Rod worth S-curve. x = fraction withdrawn (0 inserted .. 1 withdrawn). */
export function rodS(x) {
  return x - Math.sin(2 * Math.PI * x) / (2 * Math.PI);
}

/** Way-Wigner decay power fraction t seconds after shutdown from tOp seconds of operation. */
export function wayWigner(t, tOp = 3e7) {
  t = Math.max(t, 1e-3);
  return 0.066 * (Math.pow(t, -0.2) - Math.pow(t + tOp, -0.2));
}

// Six-exponential fit to Way-Wigner (tOp = 3e7 s), valid ~1 s .. 1e5 s. Teaching fit, error < 3 % in range.
export const DECAY_TAU = [2, 20, 200, 2000, 20000, 200000];
export const DECAY_A = [0.02789, 0.0186, 0.01097, 0.00805, 0.00293, 0.00682];
export const DECAY_FRACTION = DECAY_A.reduce((a, b) => a + b, 0);

/** Xenon-135 / iodine-135 constants. */
export const XENON = {
  lambdaI: 2.93e-5, // 1/s (6.57 h half-life)
  lambdaX: 2.09e-5, // 1/s (9.14 h half-life)
  gammaI: 0.0639,
  gammaX: 0.0024,
};

// 3x3 linear solve (Cramer). Returns [x,y,z].
function solve3(a, b) {
  const [a11, a12, a13, a21, a22, a23, a31, a32, a33] = a;
  const det =
    a11 * (a22 * a33 - a23 * a32) - a12 * (a21 * a33 - a23 * a31) + a13 * (a21 * a32 - a22 * a31);
  const d = Math.abs(det) < 1e-30 ? 1e-30 : det;
  const x =
    (b[0] * (a22 * a33 - a23 * a32) - a12 * (b[1] * a33 - a23 * b[2]) + a13 * (b[1] * a32 - a22 * b[2])) / d;
  const y =
    (a11 * (b[1] * a33 - a23 * b[2]) - b[0] * (a21 * a33 - a23 * a31) + a13 * (a21 * b[2] - b[1] * a31)) / d;
  const z =
    (a11 * (a22 * b[2] - b[1] * a32) - a12 * (a21 * b[2] - b[1] * a31) + b[0] * (a21 * a32 - a22 * a31)) / d;
  return [x, y, z];
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Parameter set with defaults. Override anything via the argument.
 * Required: Pnom, Tin0, Tout0, Tf0, Lambda, betaEff.
 */
export function makeParams(o = {}) {
  const p = {
    id: 'generic',
    Pnom: 1000, // MW thermal
    PeNom: 330, // MW electric
    Tin0: 290, // degC core inlet
    Tout0: 320, // degC core outlet
    Tf0: 600, // degC mean fuel temperature at 100 %
    Lambda: 2e-5, // s prompt generation time
    betaEff: 0.0065,
    groupLambda: KEEPIN_LAMBDA,
    // reactivity coefficients, pcm/K
    alphaF: -2.5, // fuel (Doppler), acts on Tf
    alphaC: -30, // coolant/moderator, acts on Tc (mean coolant temperature)
    rod: { W: 0.07, x0: 0.85 }, // total worth (Delta-k/k) and nominal withdrawn fraction
    rodSpeed: 0.025, // fraction per s (normal drive)
    scramTime: 2.2, // s for full drop
    // thermal lumps
    tauFuel: 6, // s fuel lump time constant
    tauCool: 8, // s coolant lump (transit) time constant at nominal flow
    fuelHeatFraction: 1, // fraction of power deposited in the "fuel" lump; rest goes straight to the coolant
    tauPump: 4, // s flow-rate lag (pump inertia)
    flowMin: 0.03, // natural-circulation floor
    // heat sink: 'load' = steam generator driven by turbine load, 'fixed' = fixed inlet temperature
    sink: { mode: 'load', kappa: 1.0, tau: 25, tripLoad: 0.05, tauLoad: 15 },
    decay: true,
    xenon: null, // { worth: 0.028, burn: 3.7 } to enable
    source: 1e-7, // neutron source level in n/s (keeps a shut-down core from reading exactly 0)
    // protection
    trip: { overpower: 1.18, period: 3, periodMinN: 0.02, dTout: 30, enabled: true },
    // optional recirculating precursors (liquid fuel): { tCore, tLoop } seconds
    circulating: null,
    nCap: 50,
    maxStep: 0.05, // s max sub-step
    maxSteps: 4000,
    hooks: null, // { reactivity(state, controls) -> Delta-k/k, afterStep(state, dt) }
  };
  const merged = { ...p, ...o };
  merged.rod = { ...p.rod, ...(o.rod || {}) };
  merged.sink = { ...p.sink, ...(o.sink || {}) };
  merged.trip = { ...p.trip, ...(o.trip || {}) };
  merged.beta = o.beta || scaleGroups(merged.betaEff);
  merged.betaSum = merged.beta.reduce((a, b) => a + b, 0);
  return merged;
}

export class Reactor {
  constructor(params) {
    this.p = makeParams(params);
    this.controls = { rods: this.p.rod.x0, flow: 1, load: 1, extraRho: 0 }; // rods = target withdrawn fraction
    this.reset();
  }

  reset() {
    const p = this.p;
    const Tc0 = (p.Tin0 + p.Tout0) / 2;
    this.Tc0 = Tc0;
    this.dT0 = p.Tout0 - p.Tin0;
    this.G0 = p.Pnom / this.dT0; // MW/K  (mdot * cp at nominal)
    this.UA = (p.fuelHeatFraction * p.Pnom) / Math.max(1, p.Tf0 - Tc0);
    this.Cf = Math.max(1e-6, this.UA * p.tauFuel);
    this.Cc = p.tauCool * 2 * this.G0;
    this.eta = p.PeNom / p.Pnom;
    const s = {
      time: 0,
      n: 1,
      C: p.beta.map((b, i) => b / (p.Lambda * p.groupLambda[i])),
      L: p.beta.map(() => 0), // loop-side precursors if circulating
      Tf: p.Tf0,
      Tc: Tc0,
      Tin: p.Tin0,
      Tout: p.Tout0,
      h: DECAY_A.map((a) => a), // decay-heat groups at equilibrium (n = 1)
      I: 1,
      xe: 1,
      rodPos: p.rod.x0,
      flow: 1,
      load: 1,
      scrammed: false,
      tripReason: '',
      tripTime: -1,
      turbineOnline: true,
      period: Infinity,
      rho: 0,
      rhoParts: { rod: 0, fuel: 0, coolant: 0, xenon: 0, extra: 0 },
      promptCritical: false,
      power: p.Pnom,
      powerFission: p.Pnom * (1 - DECAY_FRACTION),
      powerDecay: p.Pnom * DECAY_FRACTION,
      powerElectric: p.PeNom,
      steamPower: p.Pnom,
      flowKgs: 0,
      nPrev: 1,
    };
    if (p.circulating) {
      // steady circulating precursor distribution
      const a = 1 / p.circulating.tCore;
      const b = 1 / p.circulating.tLoop;
      for (let i = 0; i < 6; i++) {
        const lam = p.groupLambda[i];
        const src = (p.beta[i] / p.Lambda) * 1; // production per unit n
        // solve: 0 = src - (lam + a) C + b L ; 0 = a C - (lam + b) L
        const C = src / (lam + a - (a * b) / (lam + b));
        s.C[i] = C;
        s.L[i] = (a * C) / (lam + b);
      }
    }
    this.s = s;
    this.controls.rods = p.rod.x0;
    this.controls.flow = 1;
    this.controls.load = 1;
    this.controls.extraRho = 0;
    this._refreshOutputs();
    return this;
  }

  get state() {
    return this.s;
  }

  scram(reason = 'Manual SCRAM') {
    const s = this.s;
    if (s.scrammed) return;
    s.scrammed = true;
    s.tripReason = reason;
    s.tripTime = s.time;
    s.turbineOnline = false;
    this.controls.rods = 0;
  }

  resetTrip() {
    const s = this.s;
    s.scrammed = false;
    s.tripReason = '';
    s.tripTime = -1;
    s.turbineOnline = true;
  }

  /** Advance by simDt simulated seconds (sub-stepped). */
  advance(simDt) {
    if (!(simDt > 0)) return;
    const p = this.p;
    let steps = Math.ceil(simDt / p.maxStep);
    if (steps > p.maxSteps) steps = p.maxSteps;
    const h = simDt / steps;
    for (let i = 0; i < steps; i++) this._step(h);
  }

  step(dt) {
    this.advance(dt);
  }

  _thermal(h, P, flow, load, Tf, Tc, Tin) {
    const steamLoad = load;
    // Implicit solve of the (Tf, Tc, Tin) lumps for given power P.
    const p = this.p;
    const Pf = p.fuelHeatFraction * P;
    const Pc = P - Pf;
    const G = Math.max(this.G0 * flow, 1e-6);
    const UA = this.UA;
    const a11 = this.Cf / h + UA;
    const a12 = -UA;
    const a22 = this.Cc / h + UA + 2 * G;
    const b1 = (this.Cf / h) * Tf + Pf;
    const b2 = (this.Cc / h) * Tc + Pc;
    let a32, a33, b3;
    if (p.sink.mode === 'fixed') {
      const ts = p.sink.tau / h;
      a32 = 0;
      a33 = ts + 1;
      b3 = ts * Tin + p.Tin0;
    } else {
      const ts = p.sink.tau / h;
      const q0 = (steamLoad * p.Pnom) / G;
      const k = p.sink.kappa;
      const a = (k * q0) / this.dT0;
      a32 = -(2 - a);
      a33 = ts + 2;
      b3 = ts * Tin - q0 * (1 - (k * this.Tc0) / this.dT0);
    }
    return solve3([a11, a12, 0, a12, a22, -2 * G, 0, a32, a33], [b1, b2, b3]);
  }

  _step(h) {
    const p = this.p;
    const s = this.s;
    const c = this.controls;

    // ---- actuators
    const rodTarget = s.scrammed ? 0 : clamp(c.rods, 0, 1);
    const speed = s.scrammed ? 1 / p.scramTime : p.rodSpeed;
    const dRod = rodTarget - s.rodPos;
    s.rodPos += clamp(dRod, -speed * h, speed * h);
    const flowT = clamp(c.flow, p.flowMin, 1.3);
    s.flow += (flowT - s.flow) * (1 - Math.exp(-h / p.tauPump));
    const loadT = s.scrammed ? p.sink.tripLoad : clamp(c.load, 0, 1.2);
    s.load += (loadT - s.load) * (1 - Math.exp(-h / p.sink.tauLoad));
    const flow = Math.max(s.flow, p.flowMin);

    // ---- xenon / iodine (normalised so n = 1 steady state gives I = Xe = 1)
    let rhoXe = 0;
    if (p.xenon) {
      const X = XENON;
      const gI = X.gammaI / (X.gammaI + X.gammaX);
      const gX = 1 - gI;
      const b = p.xenon.burn;
      const nn = s.n;
      s.I += h * X.lambdaI * (nn - s.I);
      s.xe += h * (X.lambdaX * (1 + b) * (gX * nn + gI * s.I) - X.lambdaX * s.xe - b * X.lambdaX * nn * s.xe);
      s.xe = clamp(s.xe, 0, 10);
      rhoXe = -p.xenon.worth * (s.xe - 1);
    }

    // ---- predict temperatures for the feedback term (use previous power)
    const Pold = p.Pnom * ((1 - DECAY_FRACTION) * s.n + s.h.reduce((a, b) => a + b, 0));
    const pred = this._thermal(h, Pold, flow, s.load, s.Tf, s.Tc, s.Tin);
    const rodRho = p.rod.W * (rodS(s.rodPos) - rodS(p.rod.x0));
    const fuelRho = p.alphaF * PCM * (pred[0] - p.Tf0);
    const coolRho = p.alphaC * PCM * (pred[1] - this.Tc0);
    let rho = rodRho + fuelRho + coolRho + rhoXe + c.extraRho * PCM;
    if (p.hooks && p.hooks.reactivity) rho += p.hooks.reactivity(s, c);

    // ---- point kinetics, backward Euler (see PLAN 4.1)
    const lam = p.groupLambda;
    const beta = p.beta;
    const den = new Array(6);
    const add = new Array(6);
    let a = 0;
    let b = 0;
    if (p.circulating) {
      a = flow / p.circulating.tCore;
      b = flow / p.circulating.tLoop;
    }
    for (let i = 0; i < 6; i++) {
      if (p.circulating) {
        const dl = 1 + h * (lam[i] + b);
        den[i] = 1 + h * (lam[i] + a) - (h * h * a * b) / dl;
        add[i] = (h * b * s.L[i]) / dl;
      } else {
        den[i] = 1 + h * lam[i];
        add[i] = 0;
      }
    }
    let sumNum = 0;
    let sumLB = 0;
    for (let i = 0; i < 6; i++) {
      sumNum += (lam[i] * (s.C[i] + add[i])) / den[i];
      sumLB += (lam[i] * beta[i]) / den[i];
    }
    // Denominator D = 1 - h(rho-beta)/L - h^2 sum(lam beta/den)/L = 1 + (h/L)(beta - h sumLB - rho).
    // D > 0 requires rho below rhoLim; above it (prompt critical) rho is clamped and n is capped.
    const betaStep = p.betaSum - h * sumLB;
    const rhoLim = 0.98 * betaStep;
    s.promptCritical = rho > rhoLim;
    if (s.promptCritical) rho = rhoLim;
    const Duse = 1 + (h / p.Lambda) * (betaStep - rho);
    let nNew = (s.n + h * sumNum + h * p.source) / Duse;
    nNew = clamp(nNew, 0, p.nCap);
    for (let i = 0; i < 6; i++) {
      s.C[i] = (s.C[i] + add[i] + (h * beta[i] * nNew) / p.Lambda) / den[i];
      if (p.circulating) {
        s.L[i] = (s.L[i] + h * a * s.C[i]) / (1 + h * (lam[i] + b));
      }
    }
    const dn = nNew - s.n;
    s.period = dn > 1e-12 ? (s.n * h) / dn : Infinity;
    s.nPrev = s.n;
    s.n = nNew;
    s.rho = rho;
    s.rhoParts.rod = rodRho;
    s.rhoParts.fuel = fuelRho;
    s.rhoParts.coolant = coolRho;
    s.rhoParts.xenon = rhoXe;
    s.rhoParts.extra = rho - rodRho - fuelRho - coolRho - rhoXe;

    // ---- decay-heat groups
    let hs = 0;
    for (let j = 0; j < DECAY_A.length; j++) {
      const k = h / DECAY_TAU[j];
      s.h[j] = (s.h[j] + k * DECAY_A[j] * s.n) / (1 + k);
      hs += s.h[j];
    }

    // ---- thermal with the new power
    const P = p.Pnom * ((1 - DECAY_FRACTION) * s.n + hs);
    const T = this._thermal(h, P, flow, s.load, s.Tf, s.Tc, s.Tin);
    s.Tf = clamp(T[0], 0, 4000);
    s.Tc = clamp(T[1], 0, 3000);
    s.Tin = clamp(T[2], 0, 3000);
    s.Tout = clamp(2 * s.Tc - s.Tin, 0, 3000);
    s.power = P;
    s.powerFission = p.Pnom * (1 - DECAY_FRACTION) * s.n;
    s.powerDecay = p.Pnom * hs;
    s.time += h;

    this._protect();
    if (p.hooks && p.hooks.afterStep) p.hooks.afterStep(s, h, this);
    this._refreshOutputs();
  }

  _refreshOutputs() {
    const p = this.p;
    const s = this.s;
    const G = this.G0 * Math.max(s.flow, p.flowMin);
    s.flowKgs = G; // MW/K here; machines scale to kg/s with their own cp (see model.js)
    const q = p.sink.mode === 'fixed' ? s.power : Math.max(0, s.load * p.Pnom * (1 + (p.sink.kappa * (s.Tc - this.Tc0)) / this.dT0));
    s.steamPower = q;
    s.powerElectric = s.turbineOnline ? this.eta * q : 0;
    s.keff = 1 / (1 - s.rho);
    s.rhoPcm = s.rho / PCM;
  }

  _protect() {
    const p = this.p;
    const s = this.s;
    const t = p.trip;
    if (!t.enabled || s.scrammed) return;
    if (s.n > t.overpower) this.scram(`Overpower trip (> ${Math.round(t.overpower * 100)} %)`);
    else if (s.n > t.periodMinN && s.period > 0 && s.period < t.period) this.scram(`Short-period trip (< ${t.period} s)`);
    else if (s.Tout > p.Tout0 + t.dTout) this.scram(`High outlet temperature (> ${Math.round(p.Tout0 + t.dTout)} °C)`);
  }
}
