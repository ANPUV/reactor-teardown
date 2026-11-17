// kit/atomview.js - small 2D canvas particle engine for reaction cartoons.
//
// Machines pass a config; the engine spawns "events" at a visual rate derived from the model, picks an outcome
// from live probabilities, and plays that outcome's scene (a list of actors with keyframed paths).
//
// config = {
//   title, caption,
//   species: { n:{r:3, color:'#14202B', label:'n'}, U235:{r:14, color:'#5B6B78', label:'U-235', ring:true}, ... },
//   rate: (state) => events per second to DISPLAY (engine clamps to [0.25, 2.2]),
//   outcomes: (state) => [{ id, label, p, scene: (rand)=>actors[] }],
//   stats: [{ label, get:(state)=>string }],   // optional readouts under the canvas
// }
// actor = { sp:'n', keys:[{t, x, y, s?:scale, a?:alpha}], label?:'text', text?:'floating text', trail?:true, ring?:true }
//   - times t are seconds from event start; x,y are 0..1 of the canvas; linear interpolation between keys.
//   - an actor is drawn only between its first and last key (alpha fades in/out over 0.12 s unless a is given).
// Helper: A.move(sp, [x0,y0], [x1,y1], t0, t1, opts), A.hold(sp,[x,y],t0,t1,opts), A.text(str,[x,y],t0,t1)
import { clamp, rng } from './util.js';

export const A = {
  move: (sp, p0, p1, t0, t1, o = {}) => ({ sp, keys: [{ t: t0, x: p0[0], y: p0[1] }, { t: t1, x: p1[0], y: p1[1] }], ...o }),
  hold: (sp, p, t0, t1, o = {}) => ({ sp, keys: [{ t: t0, x: p[0], y: p[1] }, { t: t1, x: p[0], y: p[1] }], ...o }),
  path: (sp, pts, o = {}) => ({ sp, keys: pts.map(([t, x, y, s, a]) => ({ t, x, y, s, a })), ...o }),
  text: (str, p, t0, t1, o = {}) => ({ sp: '_text', text: str, keys: [{ t: t0, x: p[0], y: p[1] }, { t: t1, x: p[0], y: p[1] }], ...o }),
  /** n particles flying out from a point at random angles. */
  burst: (sp, p, t0, dur, count, dist, rand, o = {}) =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2 + rand() * 0.8;
      const d = dist * (0.8 + rand() * 0.5);
      return A.move(sp, p, [p[0] + Math.cos(a) * d * 0.6, p[1] + Math.sin(a) * d], t0, t0 + dur, o);
    }),
};

export function createAtomView(canvas, config) {
  const ctx = canvas.getContext('2d');
  const rand = rng(7);
  let events = [];
  let acc = 0;
  let W = 0;
  let H = 0;
  let dpr = 1;
  const tally = {};
  let probs = [];
  let lastState = null;
  const INK = '#14202B';
  const MUTED = '#5B6B78';

  function size() {
    const w = canvas.clientWidth || 280;
    const hh = canvas.clientHeight || 170;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(hh * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(hh * dpr);
    }
    W = canvas.width;
    H = canvas.height;
  }

  function spawn(state) {
    const outs = config.outcomes(state).filter((o) => o.p > 0);
    if (!outs.length) return;
    const total = outs.reduce((a, o) => a + o.p, 0);
    let r = rand() * total;
    let pick = outs[0];
    for (const o of outs) {
      r -= o.p;
      if (r <= 0) {
        pick = o;
        break;
      }
    }
    const actors = pick.scene(rand).flat();
    const dur = Math.max(...actors.map((a) => a.keys[a.keys.length - 1].t)) + 0.3;
    events.push({ t: 0, actors, dur, label: pick.label, id: pick.id });
    tally[pick.id] = (tally[pick.id] || 0) + 1;
  }

  function sample(a, t) {
    const k = a.keys;
    if (t < k[0].t || t > k[k.length - 1].t) return null;
    let i = 0;
    while (i < k.length - 2 && t > k[i + 1].t) i++;
    const f = k[i + 1].t === k[i].t ? 1 : (t - k[i].t) / (k[i + 1].t - k[i].t);
    const lerp = (u, v, d) => (u === undefined ? d : v === undefined ? u : u + (v - u) * f);
    return { x: lerp(k[i].x, k[i + 1].x), y: lerp(k[i].y, k[i + 1].y), s: lerp(k[i].s ?? 1, k[i + 1].s ?? 1), a: lerp(k[i].a ?? 1, k[i + 1].a ?? 1) };
  }

  let drawnTexts = new Set();
  function drawActor(a, t, slot = 0) {
    const p = sample(a, t);
    if (!p) return;
    const t0 = a.keys[0].t;
    const t1 = a.keys[a.keys.length - 1].t;
    const fade = a.noFade ? 1 : clamp(Math.min((t - t0) / 0.12, (t1 - t) / 0.12), 0, 1);
    ctx.globalAlpha = clamp(p.a * (a.keys.some((k) => k.a !== undefined) ? 1 : fade), 0, 1);
    const x = p.x * W;
    const y = p.y * H;
    if (a.sp === '_text') {
      // one copy of a given text at a time; concurrent events are stacked one line apart; always inside the canvas
      if (drawnTexts.has(a.text)) return;
      drawnTexts.add(a.text);
      ctx.fillStyle = a.color || INK;
      ctx.font = `600 ${(a.size || 11) * dpr}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center';
      const tw = ctx.measureText(a.text).width;
      const tx = Math.min(W - tw / 2 - 4 * dpr, Math.max(tw / 2 + 4 * dpr, x));
      const ty = Math.min(H - 20 * dpr, Math.max(12 * dpr, y + slot * 14 * dpr));
      ctx.fillText(a.text, tx, ty);
      ctx.globalAlpha = 1;
      return;
    }
    const sp = config.species[a.sp] || { r: 4, color: INK };
    const r = sp.r * p.s * dpr;
    if (a.trail) {
      const k0 = sample(a, Math.max(t0, t - 0.25));
      if (k0) {
        ctx.strokeStyle = sp.color;
        ctx.globalAlpha *= 0.3;
        ctx.lineWidth = Math.max(1, r * 0.6);
        ctx.beginPath();
        ctx.moveTo(k0.x * W, k0.y * H);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = clamp(p.a * fade, 0, 1);
      }
    }
    if (a.ring || sp.ring) {
      ctx.strokeStyle = a.color || sp.color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.stroke();
    } else {
      ctx.fillStyle = a.color || sp.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    }
    const label = a.label ?? (a.noLabel ? '' : sp.label);
    if (label && r > 6 * dpr) {
      ctx.fillStyle = sp.labelColor || '#fff';
      if (a.ring || sp.ring) ctx.fillStyle = INK;
      ctx.font = `600 ${Math.min(11, r / dpr * 0.8) * dpr}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 0.5 * dpr);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.globalAlpha = 1;
  }

  function render() {
  ctx.clearRect(0, 0, W, H);
  drawnTexts = new Set();
  events.forEach((e, slot) => { for (const a of e.actors) drawActor(a, e.t, slot); });
  ctx.globalAlpha = 1;
  // probability strip along the bottom
  const total = probs.reduce((s, o) => s + o.p, 0) || 1;
  let x = 6 * dpr;
  const bw = W - 12 * dpr;
  ctx.font = `500 ${9 * dpr}px Inter, sans-serif`;
  ctx.textAlign = 'left';
  probs.forEach((o, i) => {
    const w = (o.p / total) * bw;
    ctx.fillStyle = i % 2 ? '#CBD3DA' : '#9AA7B1';
    if (events.some((e) => e.id === o.id)) ctx.fillStyle = '#000000';
    ctx.fillRect(x, H - 14 * dpr, Math.max(1, w - 1), 4 * dpr);
    x += w;
  });
  }

  const api = {
    config,
    tally,
    update(state, dt) {
      size();
      lastState = state;
      const rate = clamp(config.rate(state), 0, 2.2);
      probs = config.outcomes(state);
      acc += (rate < 0.02 ? 0 : Math.max(rate, 0.25)) * dt;
      while (acc >= 1 && events.length < 4) {
        acc -= 1;
        spawn(state);
      }
      if (acc > 3) acc = 0;
      for (const e of events) e.t += dt;
      events = events.filter((e) => e.t < e.dur);
      render();
    },
    /** A still of the most probable reaction at a mid-event moment (used while the simulation is frozen). */
    still(state) {
      size();
      lastState = state;
      probs = config.outcomes(state);
      const best = [...probs].sort((a, b) => b.p - a.p)[0];
      events = [];
      acc = 0;
      if (best && best.p > 0) {
        const actors = best.scene(rng(11)).flat();
        const dur = Math.max(...actors.map((a) => a.keys[a.keys.length - 1].t)) + 0.3;
        events.push({ t: Math.min(1.2, dur * 0.6), actors, dur, label: best.label, id: best.id });
      }
      render();
    },
    /** Current outcome probabilities for the legend: [{id,label,p (0..1)}] */
    legend() {
      const total = probs.reduce((s, o) => s + o.p, 0) || 1;
      return probs.map((o) => ({ id: o.id, label: o.label, p: o.p / total, active: events.some((e) => e.id === o.id) }));
    },
    reset() {
      events = [];
      acc = 0;
      for (const k in tally) delete tally[k];
    },
    get state() {
      return lastState;
    },
  };
  return api;
}
