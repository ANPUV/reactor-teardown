// Reactor Teardown shell: tabs, routing, lazy machine construction, rails, deck, drawers, tour, debug API.
import registry from 'virtual:machines';
import dictAll from 'virtual:i18n';
import { t, setLang, getLang, registerDict, retranslate, missingStrings } from './kit/i18n.js';
import { Stage, TIERS } from './kit/stage.js';
import { buildGauges, buildControls, accelSelector, partCard } from './kit/hud.js';
import { Tour } from './kit/tour.js';
import { createAtomView } from './kit/atomview.js';
import { createMaterials } from './kit/materials.js';
import * as util from './kit/util.js';
import { h, fmt, fmtSpec, clamp } from './kit/util.js';

const TABS = [
  { route: 'uranium', id: 'pwr', label: 'Uranium', sub: 'Water-cooled PWR', ref: 'Westinghouse 4-loop PWR' },
  { route: 'plutonium', id: 'sfr', label: 'Plutonium', sub: 'Sodium fast breeder', ref: 'BN-800 (Beloyarsk 4)' },
  { route: 'thorium', id: 'msr', label: 'Thorium', sub: 'Molten-salt breeder', ref: 'ORNL MSBR design (ORNL-4541), MSRE heritage' },
  { route: 'fusion', id: 'tokamak', label: 'Fusion', sub: 'Tokamak', ref: 'ITER' },
];
const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
registerDict(dictAll);
for (const m of registry) registerDict(Object.fromEntries((m.properNames || []).map((x) => [x, x]))); // proper names stay as written
let storedLang = null;
try {
  storedLang = localStorage.getItem('rt-lang');
} catch (e) {}
setLang(params.get('lang') || storedLang || 'vi');
const phoneMQ = matchMQ('(max-width: 760px)');
const stackMQ = matchMQ('(max-width: 1180px)');
const reduced = matchMQ('(prefers-reduced-motion: reduce)');
function matchMQ(q) {
  return window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} };
}

// ------------------------------------------------------------------ stage
const lockTier = params.get('q') && TIERS[params.get('q')] ? params.get('q') : null;
const startTier = lockTier || (phoneMQ.matches ? 'mid' : 'high');
const stage = new Stage($('#gl'), { tier: startTier, autoDrop: !lockTier, reducedMotion: reduced.matches });
const mats = createMaterials();

// ------------------------------------------------------------------ state
const sessions = new Map();
let cur = null; // active session
let paused = false;
let accel = 1;
let simClock = 0;
let uiTick = 0;
const card = partCard();
$('#card-slot').append(card.el);
card.onClose = () => isolate(null);
let prevAccel = 1;
const accelUI = accelSelector([0, 1, 10, 100, 1000], (v) => {
  accel = v;
  paused = v === 0;
  if (v > 0) prevAccel = v;
  cur && cur.gauges.setAccel(Math.max(1, v));
});
accelUI.set(params.get('run') === '1' || params.get('tour') === '1' ? 1 : 0); // frozen on load unless ?run=1 / ?tour=1
$('#accel-slot').append(accelUI.el);

// ------------------------------------------------------------------ tabs
const tabsEl = $('#tabs');
TABS.forEach((tb, i) => {
  const missing = !registry.find((m) => m.id === tb.id);
  const a = h('a', { href: '#' + tb.route, role: 'tab', 'data-route': tb.route, 'aria-keyshortcuts': String(i + 1), title: tb.sub + ' \u00b7 ' + tb.ref }, h('span', { 'data-t': tb.label }, t(tb.label)), missing ? h('small', { 'data-t': 'coming soon' }, t('coming soon')) : null);
  if (missing) a.classList.add('soon');
  tabsEl.append(a);
});

function routeTab() {
  const r = location.hash.replace('#', '') || 'uranium';
  return TABS.find((t) => t.route === r) || TABS[0];
}

// ------------------------------------------------------------------ session (one per machine, built lazily)
function buildSession(tab) {
  const def = registry.find((m) => m.id === tab.id);
  if (!def) return { tab, soon: true };
  const model = def.createModel();
  const inst = def.build({ mats, kit: { util }, spec: def.spec, model, state: model.state, quality: { tier: stage.tierName, detail: stage.tier.detail }, tier: stage.tierName });
  const gauges = buildGauges([...(def.gauges || []), ...(def.charts || [])]);
  const controls = buildControls(def.controls || [], model, { onChange: () => paused && accelUI.set(prevAccel || 1) }); // operating a control at x0 unfreezes the sim
  const atom = def.atom ? createAtomView($('#atom'), def.atom) : null;
  const s = { tab, def, model, inst, gauges, controls, atom, partButtons: new Map(), partsEl: null, defaultMode: inst.defaultMode || 'cutaway', defaultExplode: 0 };
  s.partsEl = buildPartsList(s);
  gauges.setAccel(Math.max(1, accel));
  return s;
}

function buildPartsList(s) {
  const ul = h('ul.parts');
  let group = null;
  for (const p of s.inst.parts) {
    if (p.listed === false) continue;
    if (p.group && p.group !== group) {
      group = p.group;
      ul.append(h('li.grp', { 'data-t': group }, t(group)));
    }
    const b = h('button', { type: 'button', 'aria-pressed': 'false', 'data-tour': 'part:' + p.id, on: { click: () => isolate(cur.isolated === p.id ? null : p.id) } }, h('span', { 'data-t': p.label }, t(p.label)), p.badge ? h('span.badge', p.badge) : null);
    s.partButtons.set(p.id, b);
    ul.append(h('li' + (p.parent ? '.child' : ''), b));
  }
  return ul;
}

let actTok = 0;
async function activate(tab) {
  const tok = ++actTok;
  document.body.classList.toggle('soon', false);
  [...tabsEl.children].forEach((a) => a.setAttribute('aria-selected', String(a.dataset.route === tab.route)));
  let s = sessions.get(tab.id);
  if (!s && registry.some((m) => m.id === tab.id)) {
    // first visit: show the grid and a mono label for a frame before the (synchronous) build
    stage.unload();
    $('#soon').hidden = true;
    $('#loading').textContent = t('Loading');
    $('#loading').hidden = false;
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    if (tok !== actTok) return;
  }
  if (!s) {
    try {
      s = buildSession(tab);
    } catch (e) {
      console.error(e);
      s = { tab, error: e };
    }
    sessions.set(tab.id, s);
  }
  $('#loading').hidden = true;
  if (tok !== actTok) return; // a newer tab switch superseded this one
  if (cur && cur.tour) cur.tour = null;
  cur = s;
  if (s.soon || s.error) {
    document.body.classList.add('soon');
    $('#soon').hidden = false;
    $('#soon-title').textContent = s.error ? tab.label + ': could not start' : tab.label + ' · ' + tab.sub + ' — coming soon';
    if (s.error) $('#soon p').textContent = String(s.error.message || s.error);
    else $('#soon p').textContent = 'This machine is not built yet. Its tab will light up as soon as it ships.';
    stage.unload();
    tour.setScript([]);
    window.__rt && (window.__rt.ready = true);
    return;
  }
  $('#soon').hidden = true;
  stage.load(s.inst, { presets: s.inst.presets, cutOrigin: s.inst.cutOrigin, defaultView: s.inst.defaultView });
  stage.inst.defaultView = s.inst.defaultView;
  document.title = `${tab.label} · ${s.def.title} — Reactor Teardown`;
  // rails
  $('#parts').replaceWith(s.partsEl);
  s.partsEl.id = 'parts';
  const g = $('#gauges');
  g.replaceChildren(s.gauges.el);
  $('#controls').replaceChildren(s.controls.el);
  buildPresets();
  $('#atom-title').textContent = t(s.def.atom ? s.def.atom.title : 'Atom view');
  $('#atom-title').dataset.t = s.def.atom ? s.def.atom.title : 'Atom view';
  card.hide();
  $('#card-slot').classList.remove('open');
  updateInsets(true);
  // defaults
  setMode(s.defaultMode, true);
  setExplode(s.defaultExplode, true);
  stage.setCutAngle(s.inst.cutAngle ?? 35);
  $('#cut').value = stage.cut.angle;
  $('#cut-out').textContent = Math.round(stage.cut.angle);
  syncPartButtons();
  s.gauges.setAccel(Math.max(1, accel));
  tour.setScript(s.def.tour || []);
  s.inst.update && s.inst.update(s.model.state, 0, 0);
  stage.settle();
  hudUpdate(true);
  window.__rt && (window.__rt.ready = true);
}

function buildPresets() {
  const el = $('#presets');
  el.replaceChildren();
  const have = (cur && cur.inst && cur.inst.presets) || {};
  for (const [name, label] of [['iso', 'Iso'], ['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['site', 'Site']]) {
    if (name === 'site' && !have.site) continue;
    el.append(h('button', { type: 'button', 'data-tour': 'cam:' + name, 'data-t': label, on: { click: () => stage.preset(name, 700) } }, t(label)));
  }
}

// ------------------------------------------------------------------ view controls
function setMode(m, silent) {
  stage.setMode(m);
  document.querySelectorAll('#modes button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  $('#cut-ctl').dataset.off = m === 'cutaway' ? '0' : '1';
  if (!silent) stage.refit(400);
}
function setExplode(v, silent) {
  stage.setExplode(v, !!silent);
  $('#explode').value = Math.round(v * 100);
  $('#explode-out').textContent = Math.round(v * 100);
}
function isolate(id) {
  if (!cur || !cur.inst) return;
  cur.isolated = id;
  stage.isolate(id);
  syncPartButtons();
  const p = id && cur.inst.parts.find((x) => x.id === id);
  if (p && p.card) {
    card.show(p, cur.def.spec, cur.def.sourceLabels || {});
    $('#card-slot').classList.add('open');
  } else {
    card.hide();
    $('#card-slot').classList.remove('open');
  }
  updateInsets();
}
function syncPartButtons() {
  if (!cur || !cur.partButtons) return;
  for (const [id, b] of cur.partButtons) b.setAttribute('aria-pressed', String(cur.isolated === id));
}
function updateInsets(immediate) {
  if (stackMQ.matches) {
    document.documentElement.style.setProperty('--il', '0px');
    document.documentElement.style.setProperty('--ir', '0px');
    stage.setInsets({ l: 0, r: 0, t: 8, b: 8 });
    return;
  }
  const lr = $('#left-rail').getBoundingClientRect();
  const rr = $('#right-rail').getBoundingClientRect();
  const dk = $('#deck').getBoundingClientRect();
  const cr = $('#canvas-ref') || $('#stage');
  const c = cr.getBoundingClientRect();
  let l = lr.right + 12 - c.left;
  if (!card.el.hidden) l += 284;
  const r = c.right - rr.left + 12;
  const b = c.bottom - dk.top + 8;
  document.documentElement.style.setProperty('--il', Math.max(0, l) + 'px');
  document.documentElement.style.setProperty('--ir', Math.max(0, r) + 'px');
  stage.setInsets({ l, r, t: 10, b });
  if (immediate) stage.refit(0);
}
$('#modes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-mode]');
  if (b) setMode(b.dataset.mode);
});
$('#cut').addEventListener('input', (e) => {
  stage.setCutAngle(Number(e.target.value));
  $('#cut-out').textContent = e.target.value;
});
$('#explode').addEventListener('input', (e) => setExplode(Number(e.target.value) / 100));
$('#clear').addEventListener('click', () => isolate(null));
stage.on('pick', (id) => {
  tour.input();
  if (id && cur.partButtons.has(id)) isolate(cur.isolated === id ? null : id);
});
stage.on('input', () => tour.input());
stage.on('tier', (t) => {
  document.documentElement.dataset.tier = t;
  cur && cur.inst && cur.inst.setQuality && cur.inst.setQuality(t);
});

// ------------------------------------------------------------------ drawers
function openDrawer(id) {
  const d = $(id);
  d.hidden = false;
  d.querySelector('[data-close]').focus();
}
function closeDrawers() {
  document.querySelectorAll('.drawer').forEach((d) => (d.hidden = true));
}
document.querySelectorAll('.drawer').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) closeDrawers();
  });
});
$('#btn-compare').addEventListener('click', () => {
  buildCompare();
  openDrawer('#drawer-compare');
});
$('#btn-about').addEventListener('click', () => {
  buildAbout();
  openDrawer('#drawer-about');
});

function specValue(spec, v) {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return t(v);
  const it = v.k ? spec.items[v.k] : v;
  if (!it) return '—';
  if (typeof it.v === 'string') return t(it.v) + (it.unit ? ' ' + t(it.unit) : '');
  const num = fmtSpec(it);
  return (it.approx ? '≈ ' : '') + num + (it.unit ? ' ' + t(it.unit) : '');
}
function buildCompare() {
  const rows = [
    ['fuel', 'Fuel'], ['spectrum', 'Neutron spectrum'], ['coolant', 'Coolant'], ['tin', 'Core inlet'], ['tout', 'Core outlet'],
    ['pressure', 'Pressure'], ['thermal', 'Thermal power'], ['electric', 'Electric output'], ['eff', 'Efficiency'],
    ['heatSink', 'Heat rejection'], ['betaEff', 'Delayed-neutron fraction β'], ['lambda', 'Prompt neutron lifetime Λ'], ['note', 'What stands out'],
  ];
  const defs = TABS.map((tb) => ({ tb, d: registry.find((m) => m.id === tb.id) }));
  const tbl = $('#cmp-table');
  tbl.replaceChildren(
    h('thead', h('tr', h('th'), ...defs.map(({ tb, d }) => h('th', t(tb.label), h('small', d ? t(d.spec.reference) : t(tb.ref) + ' · ' + t('coming soon')))))),
    h('tbody', ...rows.map(([k, label]) => h('tr', h('th', { scope: 'row' }, t(label)), ...defs.map(({ d }) => {
      if (!d) return h('td.na', '—');
      const c = d.spec.compare || {};
      let txt;
      if (k === 'eff' && c.eff === undefined) {
        const th = d.spec.items.thermal;
        const e = d.spec.items.electric;
        txt = th && e && typeof e.v === 'number' ? ((th.approx || e.approx ? '≈ ' : '') + fmt((100 * e.v) / th.v, 0) + ' %') : '—';
      } else txt = specValue(d.spec, c[k]);
      return h('td', txt);
    })))),
  );
}
function buildAbout() {
  const body = $('#about-body');
  body.replaceChildren();
  const refs = TABS.map((tb) => {
    const d = registry.find((m) => m.id === tb.id);
    return h('li', h('b', t(tb.label) + ': '), t(d ? d.spec.reference : tb.ref) + (d ? '' : ' (' + t('not built yet') + ')'), d ? h('br') : null, d ? h('span.note', t(d.modelNote || 'Simplified teaching model.')) : null);
  });
  const src = [];
  for (const m of registry) for (const s of m.sources || []) src.push(h('li', t(s)));
  body.append(
    h('h3', t('What this is')),
    h('p', t('Reactor Teardown is a set of simplified teaching models. Each machine is a small lumped simulation that drives the 3D parts and the gauges from one state. Directions, steady states and orders of magnitude are right; it is not a plant simulator and must never be used for safety or design work.')),
    h('h3', t('Reference designs')),
    h('ul.refs', ...refs),
    h('h3', t('Sources')),
    h('ul.refs', ...src),
    h('h3', t('Keyboard')),
    h('p', h('kbd', '1'), '–', h('kbd', '4'), ' ' + t('switch machine') + ' · ', h('kbd', 'Space'), ' ' + t('pause') + ' · ', h('kbd', 'Esc'), ' ' + t('show all parts or close') + ' · ', h('kbd', 'C'), ' ' + t('compare') + ' · ', h('kbd', '?'), ' ' + t('this page') + ' · ' + t('arrow keys move the focused slider or orbit the focused 3D view.')),
    h('h3', t('Accessibility and performance')),
    h('p', t('The page runs offline with no network requests. If the frame rate stays low it lowers its own render quality; the tour does not start by itself when your system asks for reduced motion.')),
  );
}

// ------------------------------------------------------------------ tour wiring
const tourApi = {
  resetAll() {
    if (!cur || !cur.model) return;
    cur.model.reset();
    cur.gauges.clear();
    cur.atom && cur.atom.reset();
    accelUI.set(1);
    isolate(null);
    setExplode(0, false);
    setMode(cur.defaultMode, true);
    stage.setCutAngle(cur.inst.cutAngle ?? 35);
    $('#cut').value = stage.cut.angle;
    stage.resetView(0);
    stage.setMode(cur.defaultMode);
    stage.refit(0);
    stage.settle();
  },
  resetView() {
    isolate(null);
    setExplode(0);
    stage.resetView(0);
    setMode(cur.defaultMode, true);
  },
  resetModel() {
    cur.model.reset();
    cur.gauges.clear();
  },
  setMode: (m) => setMode(m),
  setCut(deg) {
    stage.setCutAngle(deg);
    $('#cut').value = deg;
    $('#cut-out').textContent = Math.round(deg);
  },
  camera(c) {
    if (typeof c === 'string') stage.preset(c, 900);
    else stage.flyTo({ az: c.az, el: c.el, dist: c.dist }, 900);
  },
  isolate: (id) => isolate(id),
  getExplode: () => stage.explode,
  setExplode: (v) => setExplode(v),
  getControl(id) {
    const c = cur.controls.byId[id];
    return c && c.input ? Number(c.input.value) : 0;
  },
  setControl(id, v) {
    const c = cur.controls.byId[id];
    c && c.setValue && c.setValue(v);
  },
  press(id) {
    const c = cur.controls.byId[id];
    c && c.fire && c.fire();
  },
  setAccel: (v) => accelUI.set(v),
  tourState(on, ended) {
    if (ended) accelUI.set(1);
    const b = $('#btn-tour');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    b.dataset.t = on ? 'Pause' : 'Tour';
    b.textContent = t(on ? 'Pause' : 'Tour');
    b.dataset.tPressedTitle = '';
    if (on) document.body.classList.remove('first');
  },
};
const tour = new Tour({ api: tourApi, cursor: $('#cursor'), caption: $('#caption'), reduced: reduced.matches });
/** The Tour button drives both: start/resume = sim runs + tour; pause = tour pauses in place + sim freezes at x0. */
function tourPress() {
  if (tour.running) {
    tour.pause();
    setPaused(true);
  } else {
    if (paused) accelUI.set(prevAccel || 1);
    tour.start();
  }
}
$('#btn-tour').addEventListener('click', tourPress);
const humanEvents = ['pointerdown', 'wheel', 'keydown', 'touchstart', 'pointermove'];
for (const ev of humanEvents) {
  window.addEventListener(
    ev,
    (e) => {
      if (!e.isTrusted) return;
      if (ev === 'pointermove') return;
      if (e.target && e.target.closest && e.target.closest('#btn-tour')) return;
      document.body.classList.remove('first');
      tour.input();
    },
    { passive: true, capture: true }
  );
}
// pointermove while the tour runs is the user's real mouse: ignore tiny jitter at start
let pm0 = null;
window.addEventListener('pointermove', (e) => {
  if (!e.isTrusted || !tour.running) return;
  if (!pm0) pm0 = [e.clientX, e.clientY];
  else if (Math.hypot(e.clientX - pm0[0], e.clientY - pm0[1]) > 24) (pm0 = null), tour.input();
}, { passive: true });

// ------------------------------------------------------------------ pause / keys
/** Pause = the x0 time-acceleration segment; Space toggles it and restores the previous speed. */
function setPaused(p) {
  if (p === paused) return;
  accelUI.set(p ? 0 : prevAccel || 1);
}
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' && t.type !== 'range');
  if (e.key === 'Escape') {
    if (!$('#drawer-compare').hidden || !$('#drawer-about').hidden) return closeDrawers();
    return isolate(null);
  }
  if (typing) return;
  if (e.key >= '1' && e.key <= '4') return void (location.hash = '#' + TABS[Number(e.key) - 1].route);
  if (e.key === ' ' && t.tagName !== 'BUTTON' && t.tagName !== 'INPUT') {
    e.preventDefault();
    return setPaused(!paused);
  }
  if (e.key === 'c' || e.key === 'C') return void $('#btn-compare').click();
  if (e.key === '?') return void $('#btn-about').click();
  if (cur && cur.controls) for (const k in cur.controls.byId) if (cur.controls.byId[k].hotkey === e.key.toLowerCase()) return cur.controls.byId[k].fire();
  if (t === $('#gl')) {
    const v = stage.view;
    if (e.key === 'ArrowLeft') v.az -= 6;
    else if (e.key === 'ArrowRight') v.az += 6;
    else if (e.key === 'ArrowUp') v.el = clamp(v.el + 4, -10, 89);
    else if (e.key === 'ArrowDown') v.el = clamp(v.el - 4, -10, 89);
    else if (e.key === '+' || e.key === '=') stage._zoom(0.88);
    else if (e.key === '-') stage._zoom(1.14);
    else return;
    e.preventDefault();
  }
});

// phone sheet tabs
function setPane(p) {
  document.body.dataset.pane = p;
  document.querySelectorAll('#sheet-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === p)));
}
document.querySelectorAll('#sheet-tabs button').forEach((b) => b.addEventListener('click', () => setPane(b.dataset.pane)));
setPane('parts');

// ------------------------------------------------------------------ HUD update
function statusText(s) {
  if (paused) return ['PAUSED', ''];
  const st = s.model.state;
  if (st.status === 'TRIPPED' || st.scrammed) return ['TRIPPED', st.tripReason || ''];
  return [st.status || 'RUNNING', ''];
}
function fmtClock(t) {
  const hh = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ss = Math.floor(t % 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}
let lastStatus = '';
function hudUpdate(force) {
  if (!cur || !cur.model) return;
  const st = cur.model.state;
  cur.gauges.update(st);
  cur.controls.sync(st);
  card.update(st);
  const [s, sub] = statusText(cur);
  const key = s + sub;
  const el = $('#status');
  if (el.dataset.s !== s) el.dataset.s = s;
  $('#status-text').textContent = t(s);
  $('#status-sub').textContent = (sub ? t(sub) + ' · ' : '') + t('sim') + ' ' + fmtClock(st.time);
  lastStatus = key;
  if (cur.atom) {
    if (paused) cur.atom.still(st);
    const lg = cur.atom.legend();
    const ul = $('#atom-legend');
    if (force || ul.children.length !== lg.length) ul.replaceChildren(...lg.map((o) => h('li', h('span', t(o.label)), h('b', fmt(o.p * 100, o.p < 0.1 ? 1 : 0) + ' %'))));
    else lg.forEach((o, i) => {
      const li = ul.children[i];
      li.className = o.active ? 'on' : '';
      li.lastChild.textContent = fmt(o.p * 100, o.p < 0.1 ? 1 : 0) + ' %';
    });
    const sd = $('#atom-stats');
    const stats = cur.def.atom.stats || [];
    if (sd.children.length !== stats.length * 2) sd.replaceChildren(...stats.flatMap((x) => [h('dt', t(x.label)), h('dd', '')]));
    stats.forEach((x, i) => (sd.children[i * 2 + 1].textContent = x.get(st)));
  }
}

// ------------------------------------------------------------------ main loop
let lastT = performance.now();
let atomAcc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (document.hidden) {
    lastT = now;
    return;
  }
  const dtReal = clamp((now - lastT) / 1000, 0, 0.1);
  lastT = now;
  stage.resize();
  if (cur && cur.model && cur.inst) {
    if (!paused) cur.model.advance(dtReal * accel);
    const dtAnim = paused ? 0 : dtReal; // everything animated stops while paused
    simClock += dtAnim;
    cur.inst.update && cur.inst.update(cur.model.state, simClock, dtAnim);
  }
  stage.frame(now);
  if (cur && cur.model) {
    uiTick += dtReal;
    atomAcc += dtReal;
    if (uiTick >= 1 / stage.tier.hudHz) {
      uiTick = 0;
      hudUpdate();
    }
    if (cur.atom && !paused) cur.atom.update(cur.model.state, dtReal);
  }
}
const ro = new ResizeObserver(() => {
  stage.resize();
  updateInsets(true);
});
ro.observe($('#stage'));
stackMQ.addEventListener && stackMQ.addEventListener('change', () => updateInsets(true));
window.addEventListener('resize', () => {
  stage.resize();
  updateInsets(true);
});

// ------------------------------------------------------------------ debug API for tools/shot.mjs
const tourFn = (cmd) => {
  if (cmd === 'start' && !tour.running) tourPress();
  else if (cmd === 'pause' && tour.running) tourPress();
  return { running: tour.running, step: tour.idx, steps: tour.script.length };
};
Object.defineProperty(tourFn, 'running', { get: () => tour.running });
Object.defineProperty(tourFn, 'caption', { get: () => tour.caption });
window.__rt = {
  tour: tourFn,
  ready: false,
  stage,
  get machine() {
    return cur && cur.tab.id;
  },
  setMode: (m) => setMode(m),
  isolate: (id) => isolate(id || null),
  setExplode: (v) => setExplode(v),
  setCut: (d) => tourApi.setCut(d),
  setControl(id, v) {
    tourApi.setControl(id, v);
  },
  press: (id) => tourApi.press(id),
  setAccel: (a) => accelUI.set(a),
  setQuality: (t) => stage.applyTier(t),
  camera(az, el, dist) {
    stage.autoFit = dist === undefined;
    stage.flyTo({ az, el, dist }, 0);
    if (dist === undefined) stage.refit(0);
  },
  preset: (n) => {
    stage.preset(n, 0);
  },
  setPaused,
  setPane,
  advance(sec) {
    if (!cur || !cur.model) return;
    const chunk = Math.max(0.5, sec / 240);
    let left = sec;
    while (left > 1e-9) {
      const d = Math.min(chunk, left);
      cur.model.advance(d);
      left -= d;
      cur.gauges.update(cur.model.state);
    }
    cur.inst.update && cur.inst.update(cur.model.state, simClock, 0.016);
    hudUpdate();
  },
  settle() {
    stage.settle();
    cur && cur.inst && cur.inst.update && cur.inst.update(cur.model.state, simClock, 0.016);
    stage.frame(performance.now());
    hudUpdate();
  },
  resetView() {
    isolate(null);
    setExplode(0, true);
    setMode(cur.defaultMode, true);
    stage.setCutAngle(cur.inst.cutAngle ?? 35);
    $('#cut').value = stage.cut.angle;
    stage.resetView(0);
    stage.settle();
  },
  resetModel() {
    cur.model.reset();
    cur.gauges.clear();
    cur.atom && cur.atom.reset();
    accelUI.set(1);
    hudUpdate();
  },
  getState: () => (cur && cur.model ? JSON.parse(JSON.stringify(cur.model.state)) : null),
  getControls: () => (cur && cur.model ? { ...cur.model.controls } : null),
  tourOff() {
    tour.reset();
    document.body.classList.remove('first');
  },
  tourOn() {
    tourPress();
  },
  tourObj: tour,
  perf() {
    return { gpu: stage.gpu, tier: stage.tierName, ms: stage.stats.ms, fps: stage.stats.fps, calls: stage.stats.calls, tris: stage.stats.tris };
  },
  setLang: (l) => applyLang(l, false),
  i18nScan() {
    // call t() on every display string of the active machine and the shell so misses are recorded
    if (!cur || !cur.def) return missingStrings();
    const d = cur.def;
    const walk = (v) => {
      if (typeof v === 'string') t(v);
      else if (Array.isArray(v)) v.forEach(walk);
    };
    t(d.title);
    t(d.spec.reference);
    for (const it of Object.values(d.spec.items)) (t(it.label), t(it.unit), typeof it.v === 'string' && t(it.v));
    for (const v of Object.values(d.spec.compare || {})) typeof v === 'string' && t(v);
    for (const g of [...(d.gauges || []), ...(d.charts || [])]) (t(g.label), t(g.unit), (g.series || []).forEach((s) => t(s.label)));
    for (const c of d.controls || []) (t(c.label), t(c.unit), t(c.hint));
    for (const p of cur.inst.parts) {
      t(p.label);
      t(p.group);
      if (p.card) (t(p.card.title), t(p.card.text), (p.card.facts || []).forEach((f) => t(f.label)));
    }
    for (const st of d.tour || []) t(st.say);
    if (d.atom) {
      t(d.atom.title);
      (d.atom.stats || []).forEach((s) => t(s.label));
      for (const o of d.atom.outcomes(cur.model.state)) t(o.label);
    }
    (d.tripReasons || []).forEach(t);
    (d.sources || []).forEach(t);
    Object.values(d.sourceLabels || {}).forEach(t);
    return missingStrings();
  },
  partIds: () => (cur && cur.inst ? cur.inst.parts.map((p) => p.id) : []),
};

// ------------------------------------------------------------------ language
function applyLang(l, persist) {
  setLang(l);
  if (persist) {
    try {
      localStorage.setItem('rt-lang', getLang());
    } catch (e) {}
  }
  document.querySelectorAll('.langseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === getLang())));
  retranslate(document);
  tourApi.tourState(tour.running);
  $('#hint').textContent = t($('#hint').dataset.t);
  if (cur && cur.inst) {
    document.title = `${t(cur.tab.label)} · ${t(cur.def.title)} — Reactor Teardown`;
    if (cur.isolated) {
      const p = cur.inst.parts.find((x) => x.id === cur.isolated);
      if (p && p.card) card.show(p, cur.def.spec, cur.def.sourceLabels || {});
    }
    cur.gauges.setAccel(Math.max(1, accel));
    hudUpdate(true);
  } else if (cur && cur.tab) {
    $('#soon-title').textContent = t(cur.tab.label) + ' · ' + t(cur.tab.sub);
  }
  if (!$('#drawer-compare').hidden) buildCompare();
  if (!$('#drawer-about').hidden) buildAbout();
  if (tour.running && tour.caption.textContent) tour._setCaption(tour._lastSay || '');
}
document.querySelectorAll('.langseg button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang, true)));

// ------------------------------------------------------------------ boot
window.addEventListener('hashchange', () => {
  tour.reset();
  activate(routeTab());
});
document.body.classList.add('first');
applyLang(getLang(), false);
activate(routeTab()).then(() => {
  requestAnimationFrame(loop);
  if (params.get('tour') === '1') setTimeout(() => tour.start(), 800);
});
