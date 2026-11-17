#!/usr/bin/env node
// tools/i18n-check.mjs [id ...] - list display strings that reach t() with no Vietnamese entry.
// Builds a dev page for each machine (node build.mjs --only <id>), loads it with ?lang=vi, opens every part card,
// the compare and about drawers, scans every descriptor/tour/atom string, and prints what is missing.
// No id: checks every folder in src/machines that has an index.js. Exit code 1 if anything is missing.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TAB = { pwr: 'uranium', sfr: 'plutonium', msr: 'thorium', tokamak: 'fusion' };
let ids = process.argv.slice(2).filter((x) => x !== '--json');
if (!ids.length) ids = readdirSync(join(root, 'src/machines')).filter((d) => existsSync(join(root, 'src/machines', d, 'index.js')));
mkdirSync(join(root, 'dist'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--headless=new', '--use-angle=metal', '--enable-gpu'] });
let bad = 0;
const asJson = process.argv.includes('--json');
ids = ids.filter((x) => x !== '--json');
for (const id of ids) {
  const out = join(root, 'dist', `i18n-${id}.html`);
  execFileSync('node', [join(root, 'build.mjs'), '--only', id, '--out', out], { stdio: 'pipe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(out).href + '?q=low&lang=vi&tour=0#' + TAB[id]);
  await page.waitForFunction(() => window.__rt && window.__rt.ready, null, { timeout: 60000 });
  const miss = await page.evaluate(() => {
    const rt = window.__rt;
    for (const id of rt.partIds()) rt.isolate(id);
    rt.isolate(null);
    document.getElementById('btn-compare').click();
    document.getElementById('btn-about').click();
    rt.advance(5);
    return rt.i18nScan();
  });
  if (asJson) console.log(JSON.stringify(miss));
  else {
    console.log(`\n[${id}] ${miss.length} string(s) without a Vietnamese entry`);
    miss.forEach((m) => console.log('  ' + JSON.stringify(m)));
  }
  bad += miss.length;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
