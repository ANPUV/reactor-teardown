// kit/hud.js - instrument widgets (dial, bar, readout, strip chart), part card and control-deck widgets.
// Widgets are plain DOM/SVG/canvas, styled by style.css. Every widget exposes update(state).
import { h, svg, fmt, fmtSpec, clamp } from './util.js';
import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const COL = { ink: '#000000', muted: '#666666', hair: '#e5e5e5', hot: '#dc2626', cold: '#2563eb', steam: '#a3a3a3', plasma: '#db2777', accent: '#ff4500' };
const DASHES = [[], [7, 3], [2, 3], [8, 3, 2, 3], [4, 4]]; // series are told apart by dash as well as colour
export const SERIES_COLORS = { ink: COL.ink, hot: COL.hot, cold: COL.cold, steam: COL.steam, plasma: COL.plasma, muted: COL.muted, accent: COL.accent };

const A0 = 150; // dial start angle (deg, 0 = +x axis, clockwise positive in SVG)
const SWEEP = 240;
const polar = (cx, cy, r, a) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * dial({label, unit, min, max, decimals, get(state), zones:[{from,to,kind:'warn'|'alarm'}], mark})
 * mark = nominal value drawn as a tick.
 */
export function dial(o) {
  const cx = 60;
  const cy = 50;
  const r = 40;
  const val = svg('text', { x: cx, y: cy + 30, 'text-anchor': 'middle', class: 'dial-val' }, '\u2014');
  const unit = svg('text', { x: cx, y: cy + 41, 'text-anchor': 'middle', class: 'dial-unit' }, o.unit || '');
  const needle = svg('line', { x1: cx, y1: cy, x2: cx + r - 5, y2: cy, class: 'dial-needle' });
  const hub = svg('circle', { cx, cy, r: 3.5, class: 'dial-hub' });
  const frac = (v) => clamp((v - o.min) / (o.max - o.min), 0, 1);
  const kids = [svg('path', { d: arcPath(cx, cy, r, A0, A0 + SWEEP), class: 'dial-track' })];
  for (const z of o.zones || []) kids.push(svg('path', { d: arcPath(cx, cy, r, A0 + SWEEP * frac(z.from), A0 + SWEEP * frac(z.to)), class: 'dial-zone ' + (z.kind || 'warn') }));
  for (let i = 0; i <= 10; i++) {
    const a = A0 + (SWEEP * i) / 10;
    const [x0, y0] = polar(cx, cy, r + 2.5, a);
    const [x1, y1] = polar(cx, cy, r - (i % 5 === 0 ? 7 : 4), a);
    kids.push(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'dial-tick' + (i % 5 === 0 ? ' major' : '') }));
  }
  if (o.mark !== undefined) {
    const a = A0 + SWEEP * frac(o.mark);
    const [x0, y0] = polar(cx, cy, r + 6, a);
    const [x1, y1] = polar(cx, cy, r - 1, a);
    kids.push(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'dial-mark' }));
  }
  const lo = svg('text', { x: 20, y: 84, 'text-anchor': 'middle', class: 'dial-end' }, String(o.min));
  const hi = svg('text', { x: 100, y: 84, 'text-anchor': 'middle', class: 'dial-end' }, String(o.max));
  const s = svg('svg', { viewBox: '0 0 120 96', class: 'dial-svg', role: 'img', 'aria-label': o.label, 'data-t-aria': o.label }, ...kids, lo, hi, needle, hub, val, unit);
  const el = h('figure.gauge.dial', { 'data-gauge': o.id || '' }, s, h('figcaption', { 'data-t': o.label }, t(o.label)));
  let last = NaN;
  return {
    el,
    update(state) {
      const v = o.get(state);
      if (v === last) return;
      last = v;
      needle.setAttribute('transform', `rotate(${A0 + SWEEP * frac(v)} ${cx} ${cy})`);
      val.textContent = fmt(v, o.decimals ?? 0);
      el.dataset.zone = (o.zones || []).find((z) => v >= z.from && v <= z.to)?.kind || '';
    },
  };
}

/** bar({label, unit, min, max, decimals, get, mark}) */
export function bar(o) {
  const fill = h('i');
  const mark = o.mark !== undefined ? h('b.mark', { style: { left: clamp(((o.mark - o.min) / (o.max - o.min)) * 100, 0, 100) + '%' } }) : null;
  const val = h('span.val', '—');
  const el = h('div.gauge.bar', { 'data-gauge': o.id || '' }, h('div.row', h('span.lbl', { 'data-t': o.label }, t(o.label)), h('span.v', val, h('em', { 'data-t': o.unit || '' }, t(o.unit || '')))), h('div.track', fill, mark));
  return {
    el,
    update(state) {
      const v = o.get(state);
      fill.style.width = clamp(((v - o.min) / (o.max - o.min)) * 100, 0, 100) + '%';
      val.textContent = fmt(v, o.decimals ?? 0);
    },
  };
}

/** readout({label, unit, decimals, get, format(v)->string}) */
export function readout(o) {
  const val = h('span.val', '—');
  const el = h('div.gauge.readout', { 'data-gauge': o.id || '' }, h('span.lbl', { 'data-t': o.label }, t(o.label)), h('span.v', val, o.unit ? h('em', { 'data-t': o.unit }, t(o.unit)) : null));
  return {
    el,
    update(state) {
      const v = o.get(state);
      val.textContent = o.format ? o.format(v, state) : fmt(v, o.decimals ?? 0);
    },
  };
}

/**
 * strip({label, series:[{label,color,get,unit}], min?, max?, windowSec (sim seconds at x1), height})
 * The x window scales with time acceleration: window = windowSec * accel (shown in the caption).
 */
export function strip(o) {
  const canvas = h('canvas', { height: o.height || 96 });
  const cap = h('span.cap');
  const sw = (s, i) => { const c = SERIES_COLORS[s.color] || s.color || COL.ink; return svg('svg', { viewBox: '0 0 22 6' }, svg('line', { x1: 0, y1: 3, x2: 22, y2: 3, stroke: c, 'stroke-width': 2, 'stroke-dasharray': DASHES[i % DASHES.length].join(' ') })); };
  const legend = h('div.legend', ...o.series.map((s, i) => h('span', sw(s, i), h('i', { 'data-t': s.label, style: { fontStyle: 'normal' } }, t(s.label)))));
  const el = h('div.gauge.strip', { 'data-gauge': o.id || '' }, h('div.row', h('span.lbl', { 'data-t': o.label }, t(o.label)), cap), canvas, legend);
  const data = []; // {t, v:[...]}
  let lastT = -1e9;
  let win = o.windowSec || 120;
  let winT = win;
  const ctx = canvas.getContext('2d');
  function size() {
    const w = Math.max(60, Math.floor(canvas.parentElement ? canvas.parentElement.clientWidth || 240 : 240));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const hh = o.height || 96;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(hh * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(hh * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = hh + 'px';
    }
    return dpr;
  }
  const api = {
    el,
    clear() {
      data.length = 0;
      lastT = -1e9;
    },
    setAccel(a) {
      winT = (o.windowSec || 120) * Math.min(a, 100); // x1000 would show days; cap at x100 so traces stay readable
    },
    update(state) {
      const ts = state.time;
      if (ts < lastT) api.clear();
      // time base: the window eases toward its target so a change of acceleration zooms smoothly
      win *= Math.pow(winT / win, 0.12);
      if (Math.abs(win / winT - 1) < 0.01) win = winT;
      const lbl = win >= 7200 ? fmt(win / 3600, 1) + ' h' : win >= 120 ? fmt(win / 60, 0) + ' min' : fmt(win, 0) + ' s';
      const capTxt = t('last') + ' ' + lbl + ' sim';
      if (cap.textContent !== capTxt) cap.textContent = capTxt;
      if (ts - lastT >= Math.min(win, winT) / 300) {
        data.push({ t: ts, v: o.series.map((s) => s.get(state)) });
        lastT = ts;
        if (data.length > 1200) {
          const keep = [];
          for (let i = 0; i < data.length; i++) if (i % 2 === 0 || i > data.length - 300) keep.push(data[i]);
          data.length = 0;
          data.push(...keep);
        }
      }
      api.draw(ts);
    },
    draw(tNow) {
      const dpr = size();
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const pad = 4 * dpr;
      const t0 = tNow - win;
      let lo = o.min;
      let hi = o.max;
      if (lo === undefined || hi === undefined) {
        lo = Infinity;
        hi = -Infinity;
        for (const d of data) if (d.t >= t0) for (const v of d.v) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
        if (!isFinite(lo)) (lo = 0), (hi = 1);
        const m = (hi - lo) * 0.1 + 1e-6;
        lo = o.min ?? lo - m;
        hi = o.max ?? hi + m;
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = COL.hair;
      ctx.lineWidth = dpr;
      ctx.font = `${9 * dpr}px JetBrains Mono, monospace`;
      ctx.fillStyle = COL.muted;
      for (let i = 0; i <= 2; i++) {
        const y = pad + ((H - 2 * pad) * i) / 2;
        const lab = i !== 1 || H > 70 * dpr;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        if (lab) ctx.fillText(fmt(hi - ((hi - lo) * i) / 2, hi - lo < 5 ? 1 : 0), 3 * dpr, y + (i === 2 ? -3 : 10) * dpr);
      }
      o.series.forEach((s, k) => {
        ctx.strokeStyle = SERIES_COLORS[s.color] || s.color || COL.ink;
        ctx.lineWidth = 1.6 * dpr;
        ctx.setLineDash(DASHES[k % DASHES.length].map((d) => d * dpr));
        ctx.beginPath();
        let started = false;
        for (const d of data) {
          if (d.t < t0) continue;
          const x = ((d.t - t0) / win) * W;
          const y = H - pad - ((clamp(d.v[k], lo, hi) - lo) / (hi - lo)) * (H - 2 * pad);
          if (!started) (ctx.moveTo(x, y), (started = true));
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    },
  };
  api.setAccel(1);
  win = winT;
  return api;
}

/** Build a list of gauge widgets from machine descriptors. Returns {el, update(state), setAccel(a), strips}. */
export function buildGauges(descs) {
  const el = h('div.gauges');
  const items = [];
  const strips = [];
  for (const d of descs) {
    let w;
    if (d.type === 'dial') w = dial(d);
    else if (d.type === 'bar') w = bar(d);
    else if (d.type === 'strip') (w = strip(d)), strips.push(w);
    else w = readout(d);
    w.el.classList.add('span-' + (d.span || (d.type === 'dial' || d.type === 'readout' ? 1 : 2)));
    el.append(w.el);
    items.push(w);
  }
  return {
    el,
    strips,
    update(state) {
      for (const w of items) w.update(state);
    },
    setAccel(a) {
      strips.forEach((s) => s.setAccel(a));
    },
    clear() {
      strips.forEach((s) => s.clear());
    },
  };
}

/**
 * Part card. card = {title, text, facts:[{label, spec:'key'} | {label, live:(state)=>string}], sources?:[...]}
 * Returns {el, show(part, spec, sources), hide(), update(state)}
 */
export function partCard() {
  const el = h('aside.card', { hidden: true, role: 'region', 'aria-label': 'Part details' });
  let live = [];
  const api = {
    el,
    show(part, spec, srcMap = {}) {
      const c = part.card || {};
      el.hidden = false;
      el.innerHTML = '';
      live = [];
      const facts = h('dl.facts');
      for (const f of c.facts || []) {
        let value;
        if (f.spec) {
          const it = spec.items[f.spec];
          if (!it) continue;
          value = h('dd', (it.approx ? '≈ ' : '') + (typeof it.v === 'number' ? fmtSpec(it) : it.v), it.unit ? h('em', ' ' + t(it.unit)) : null);
          facts.append(h('dt', t(f.label || it.label)), value);
        } else if (f.live) {
          value = h('dd.live', '—');
          live.push([value, f]);
          facts.append(h('dt', t(f.label)), value);
        }
      }
      const srcs = [...new Set((c.facts || []).filter((f) => f.spec && spec.items[f.spec]).map((f) => srcMap[spec.items[f.spec].src] || spec.items[f.spec].src))];
      el.dataset.part = part.id;
      el.append(
        h('div.card-head', h('h3', t(c.title || part.label)), h('button.x', { type: 'button', 'aria-label': t('Close part card'), on: { click: () => api.onClose && api.onClose() } }, '×')),
        h('p', t(c.text || '')),
        facts,
        srcs.length ? h('p.src', t('Source') + ': ' + srcs.map(t).join('; ')) : document.createComment('')
      );
    },
    hide() {
      el.hidden = true;
      live = [];
    },
    update(state) {
      for (const [dd, f] of live) {
        const t = f.live(state);
        if (dd.textContent !== t) dd.textContent = t;
      }
    },
  };
  return api;
}

// ---------------------------------------------------------------- control deck

/**
 * buildControls(descs, model, {onAction}) -> {el, sync(state), byId}
 * descs: slider {id,label,unit,min,max,step,decimals,key,scale,get,set,mark,hint}
 *        button {id,label,kind:'danger'|'plain',hotkey,press(model),disabled(state)}
 *        toggle {id,label,get(model),set(model,bool)}
 */
export function buildControls(descs, model, { onChange } = {}) {
  const el = h('div.controls');
  const sl = h('div.sliders');
  const btns = h('div.btns');
  const byId = {};
  for (const d of descs) {
    if (d.type === 'slider') {
      const scale = d.scale ?? 1;
      const get = d.get || ((m) => m.controls[d.key] * scale);
      const set = d.set || ((m, v) => m.setControl(d.key, v / scale));
      const input = h('input', { type: 'range', min: d.min, max: d.max, step: d.step ?? 1, value: get(model), id: 'ctl-' + d.id, 'aria-label': t(d.label), 'data-t-aria': d.label });
      const val = h('output', { for: 'ctl-' + d.id });
      const markPos = d.mark !== undefined ? clamp(((d.mark - d.min) / (d.max - d.min)) * 100, 0, 100) : null;
      const row = h(
        'label.ctl.slider',
        { 'data-tour': 'ctl:' + d.id, title: t(d.hint || ''), 'data-t-title': d.hint || '' },
        h('span.top', h('span.lbl', { 'data-t': d.label }, t(d.label)), h('span.v', val, h('em', { 'data-t': d.unit || '' }, t(d.unit || '')))),
        h('span.rangewrap', input, markPos !== null ? h('i.mark', { style: { left: `calc(${markPos}% + ${(0.5 - markPos / 100) * 14}px)` } }) : null)
      );
      let dragging = false;
      const show = (v) => (val.textContent = fmt(v, d.decimals ?? 0));
      input.addEventListener('input', () => {
        dragging = true;
        set(model, Number(input.value));
        show(Number(input.value));
        onChange && onChange(d.id);
      });
      input.addEventListener('change', () => (dragging = false));
      input.addEventListener('pointerup', () => (dragging = false));
      show(get(model));
      sl.append(row);
      byId[d.id] = {
        el: row,
        input,
        setValue(v) {
          // programmatic (tour): animate through the same path as a user drag
          input.value = v;
          set(model, Number(input.value));
          show(Number(input.value));
          onChange && onChange(d.id);
        },
        sync() {
          if (dragging || document.activeElement === input) return;
          const v = get(model);
          if (Math.abs(Number(input.value) - v) > (d.step ?? 1) * 0.5) input.value = v;
          show(v);
        },
      };
    } else if (d.type === 'button') {
      const b = h('button.ctl.btn' + (d.kind ? '.' + d.kind : ''), { type: 'button', 'data-tour': 'ctl:' + d.id, title: t(d.hint || ''), 'data-t-title': d.hint || '', 'data-t-aria': d.label, 'aria-label': t(d.label), 'aria-keyshortcuts': d.hotkey || null }, h('span', { 'data-t': d.label }, t(d.label)), d.hotkey ? h('kbd', { 'aria-hidden': 'true' }, d.hotkey.toUpperCase()) : null);
      const fire = () => {
        d.press(model);
        onChange && onChange(d.id);
      };
      b.addEventListener('click', fire);
      b.addEventListener('pointerdown', () => b.classList.add('held'));
      const rel = () => b.classList.remove('held');
      b.addEventListener('pointerup', rel);
      b.addEventListener('pointerleave', rel);
      btns.append(b);
      byId[d.id] = { el: b, fire, sync: (state) => (b.disabled = !!(d.disabled && d.disabled(state))), hotkey: d.hotkey };
    } else if (d.type === 'toggle') {
      const b = h('button.ctl.toggle', { type: 'button', role: 'switch', 'aria-checked': 'false', 'data-tour': 'ctl:' + d.id, title: t(d.hint || ''), 'data-t-title': d.hint || '' }, h('span', { 'data-t': d.label }, t(d.label)), h('i'));
      const refresh = () => b.setAttribute('aria-checked', String(!!d.get(model)));
      b.addEventListener('click', () => {
        d.set(model, !d.get(model));
        refresh();
        onChange && onChange(d.id);
      });
      btns.append(b);
      refresh();
      byId[d.id] = { el: b, fire: () => b.click(), sync: refresh, setValue: (v) => (d.set(model, !!v), refresh()) };
    }
  }
  if (sl.children.length) el.append(sl);
  if (btns.children.length) el.append(btns);
  return {
    el,
    byId,
    sync(state) {
      for (const k in byId) byId[k].sync && byId[k].sync(state);
    },
  };
}

/** Time acceleration selector. Returns {el, set(a), onChange}. */
export function accelSelector(values = [1, 10, 100, 1000], onPick) {
  const el = h('div.accel', { role: 'radiogroup', 'aria-label': t('Time acceleration'), 'data-t-aria': 'Time acceleration', 'data-tour': 'accel' });
  const btns = values.map((v) => {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-v': v, on: { click: () => api.set(v, true) } }, '×' + v);
    return b;
  });
  el.append(...btns);
  const api = {
    el,
    value: 1,
    set(v, user) {
      api.value = v;
      btns.forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.v) === v)));
      onPick && onPick(v, user);
    },
  };
  return api;
}
