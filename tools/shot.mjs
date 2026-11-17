#!/usr/bin/env node
// tools/shot.mjs - headless Chrome screenshots of a built Reactor Teardown page, with scripted states.
//
// node tools/shot.mjs --file dist/index.html --route '#uranium' --size 1440x900 --out shots/pwr \
//      --states 'name=solid,mode=solid; name=cut,mode=cutaway; name=rpv,iso=rpv,mode=cutaway; name=half,explode=0.5' \
//      [--sheet shots/pwr/sheet.png] [--cols 3] [--q high|mid|low] [--perf 3000] [--tourat 9000]
//
// State tokens (comma separated; states separated by ';' or newlines). Every state starts from a clean view
// (resetView: default mode, no isolate, explode 0, default camera) unless it contains keep=1.
//   name=<file stem>      mode=solid|cutaway|xray     iso=<partId>       explode=0..1      cut=<deg>
//   cam=az:el[:dist]      preset=iso|front|side|top   ctl.<id>=<value>   press=<controlId> accel=<1|10|100|1000>
//   adv=<sim seconds>     reset=1 (reset model)        wait=<ms>          keep=1            q=<tier>
//   fresh=1 (load state: model reset, sim frozen at x0; otherwise frames run at x1 unless accel= is given)
//   pane=parts|controls|gauges|atoms (phone layout sheet tab)   drawer=compare|about (open a drawer)   lang=en|vi
// --lang en|vi (default en)
// --states-json <file> takes an array of objects with the same keys instead.
// --tourat <ms>: do not switch the tour off; wait <ms> of real time and shoot mid-tour (adds one frame named tour.png).
// --perf <ms>: after the shots, sample frame time for <ms> and print it.
// --list: print part ids and exit.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (n) => argv.includes('--' + n);
const file = resolve(opt('file', 'dist/index.html'));
const route = opt('route', '#uranium');
const [W, H] = opt('size', '1440x900').split('x').map(Number);
const out = resolve(opt('out', 'shots/tmp'));
const cols = Number(opt('cols', 3));
const tier = opt('q', 'high');
const dpr = Number(opt('dpr', 1));
const lang = opt('lang', 'en'); // frames are English unless --lang vi
mkdirSync(out, { recursive: true });

function parseStates() {
  const j = opt('states-json');
  if (j) return JSON.parse(readFileSync(resolve(j), 'utf8'));
  const raw = opt('states', 'name=solid,mode=solid');
  return raw
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Object.fromEntries(s.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()]; })));
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--headless=new', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--force-device-scale-factor=' + dpr],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, isMobile: W < 700, hasTouch: W < 700 });
const page = await ctx.newPage();
const problems = [];
const net = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push('[pageerror] ' + e.message));
page.on('requestfailed', (r) => problems.push('[requestfailed] ' + r.url()));
page.on('request', (r) => {
  const u = r.url();
  if (!u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) net.push(u);
});

const url = pathToFileURL(file).href + '?q=' + tier + '&lang=' + lang + '' + route;
await page.goto(url);
await page.waitForFunction(() => window.__rt && window.__rt.ready === true, null, { timeout: 60000 });
await page.waitForTimeout(400);
const gpu = await page.evaluate(() => window.__rt.perf().gpu);
console.log('WebGL renderer:', gpu, /swiftshader|llvmpipe|software/i.test(gpu) ? '  <-- SOFTWARE renderer (GPU flags did not take)' : '');
if (flag('list')) {
  console.log((await page.evaluate(() => window.__rt.partIds())).join(' '));
  await browser.close();
  process.exit(0);
}
if (!opt('tourat')) await page.evaluate(() => window.__rt.tourOff());
// the tour never starts by itself; --tourat starts it explicitly below

const shots = [];
const states = parseStates();
let n = 0;
for (const st of states) {
  n++;
  const name = (st.name || `s${n}`).replace(/[^\w.-]/g, '_');
  await page.evaluate((st) => {
    const rt = window.__rt;
    if (st.q) rt.setQuality(st.q);
    if (st.reset) rt.resetModel();
    if (!st.keep) rt.resetView();
    if (st.fresh) { rt.resetModel(); rt.setAccel(0); } else if (st.accel === undefined) rt.setAccel(1);
    if (st.pane) rt.setPane(st.pane);
    if (st.lang) rt.setLang(st.lang);
    document.querySelectorAll('.drawer').forEach((d) => (d.hidden = true));
    if (st.drawer) document.getElementById('btn-' + st.drawer).click();
    if (st.mode) rt.setMode(st.mode);
    if (st.cut !== undefined) rt.setCut(Number(st.cut));
    if (st.explode !== undefined) rt.setExplode(Number(st.explode));
    if (st.accel) rt.setAccel(Number(st.accel));
    for (const [k, v] of Object.entries(st)) if (k.startsWith('ctl.')) rt.setControl(k.slice(4), Number(v));
    if (st.press) rt.press(st.press);
    if (st.iso) rt.isolate(st.iso);
    if (st.preset) rt.preset(st.preset);
    if (st.cam) {
      const [az, el, dist] = st.cam.split(':').map(Number);
      rt.camera(az, el, dist);
    }
    if (st.adv) rt.advance(Number(st.adv));
    rt.settle();
  }, st);
  await page.waitForTimeout(Number(st.wait || 250));
  await page.evaluate(() => window.__rt.settle());
  await page.waitForTimeout(120);
  const p = join(out, name + '.png');
  await page.screenshot({ path: p });
  shots.push({ name, path: p, st });
  console.log('wrote', p);
}

if (opt('tourat')) {
  await page.evaluate(() => window.__rt.tour('start'));
  await page.waitForTimeout(Number(opt('tourat')));
  const p = join(out, 'tour.png');
  await page.screenshot({ path: p });
  shots.push({ name: 'tour', path: p, st: {} });
  console.log('wrote', p);
}

if (opt('perf')) {
  await page.evaluate(() => { window.__rt.tourOff(); window.__rt.setAccel(1); });
  const r = await page.evaluate(async (ms) => {
    window.__rt.resetView();
    window.__rt.settle();
    const t0 = performance.now();
    let frames = 0;
    const times = [];
    let last = t0;
    await new Promise((res) => {
      const f = (t) => {
        times.push(t - last);
        last = t;
        frames++;
        if (t - t0 < ms) requestAnimationFrame(f);
        else res();
      };
      requestAnimationFrame(f);
    });
    times.shift();
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { frames, avgMs: avg, p95Ms: times[Math.floor(times.length * 0.95)], fps: 1000 / avg, perf: window.__rt.perf() };
  }, Number(opt('perf')));
  console.log('PERF', JSON.stringify(r));
}

if (shots.length > 1 || flag('sheet') || opt('sheet')) {
  const sheet = resolve(opt('sheet', join(out, 'sheet.png')));
  const tw = Math.floor(1800 / cols);
  const th = Math.round((tw * H) / W);
  const imgs = shots.map((s) => `<figure><img src="data:image/png;base64,${readFileSync(s.path).toString('base64')}"><figcaption>${s.name}</figcaption></figure>`).join('');
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: tw * cols, height: Math.ceil(shots.length / cols) * (th + 22) });
  await sp.setContent(`<style>body{margin:0;background:#fff;display:grid;grid-template-columns:repeat(${cols},${tw}px);font:12px sans-serif}figure{margin:0}img{width:${tw}px;height:${th}px;display:block;border:1px solid #888;box-sizing:border-box}figcaption{height:22px;padding:3px 6px}</style>${imgs}`);
  await sp.waitForTimeout(300);
  await sp.screenshot({ path: sheet, fullPage: true });
  console.log('wrote', sheet);
}

console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'no console errors or warnings');
console.log(net.length ? 'NETWORK REQUESTS (should be none): ' + net.join(' ') : 'no network requests');
await browser.close();
