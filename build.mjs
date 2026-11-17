// build.mjs - bundle everything into ONE offline HTML file.
//   node build.mjs                                  -> dist/index.html (every machine found in src/machines/*)
//   node build.mjs --only pwr --out dist/dev-pwr.html   -> shell with just that machine registered
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = arg('only')?.split(',');
const out = resolve(root, arg('out') || 'dist/index.html');
const minify = !args.includes('--dev');

const mdir = join(root, 'src/machines');
let ids = existsSync(mdir) ? readdirSync(mdir).filter((d) => existsSync(join(mdir, d, 'index.js'))) : [];
if (only) {
  const missing = only.filter((i) => !ids.includes(i));
  if (missing.length) throw new Error('no such machine folder with index.js: ' + missing.join(', '));
  ids = ids.filter((i) => only.includes(i));
}
const order = ['pwr', 'sfr', 'msr', 'tokamak'];
ids.sort((a, b) => order.indexOf(a) - order.indexOf(b));

const virtual = {
  name: 'machines',
  setup(b) {
    b.onResolve({ filter: /^virtual:machines$/ }, () => ({ path: 'virtual:machines', namespace: 'machines' }));
    b.onLoad({ filter: /.*/, namespace: 'machines' }, () => ({
      contents: ids.map((id, i) => `import m${i} from ${JSON.stringify(join(mdir, id, 'index.js'))};`).join('\n') + `\nexport default [${ids.map((_, i) => 'm' + i).join(', ')}];\n`,
      resolveDir: root,
      loader: 'js',
    }));
  },
};

const i18nVirtual = {
  name: 'i18n',
  setup(b) {
    b.onResolve({ filter: /^virtual:i18n$/ }, () => ({ path: 'virtual:i18n', namespace: 'i18n' }));
    b.onLoad({ filter: /.*/, namespace: 'i18n' }, () => {
      const files = [join(root, 'src/i18n/vi.js'), ...ids.map((id) => join(mdir, id, 'vi.js'))].filter((f) => existsSync(f));
      return { contents: files.map((f, i) => `import d${i} from ${JSON.stringify(f)};`).join('\n') + `\nexport default Object.assign({}, ${files.map((_, i) => 'd' + i).join(', ') || '{}'});\n`, resolveDir: root, loader: 'js' };
    });
  },
};

const res = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'es2020',
  minify,
  legalComments: 'none',
  plugins: [virtual, i18nVirtual],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
});
let js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// Strategik fonts: Space Grotesk (reading) + JetBrains Mono (labels, numbers); latin, latin-ext, vietnamese subsets with unicode-ranges.
const RANGES = {
  vietnamese: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
const fonts = [];
for (const [fam, stem] of [['Space Grotesk', 'space-grotesk'], ['JetBrains Mono', 'jetbrains-mono']])
  for (const sub of ['vietnamese', 'latin-ext', 'latin']) {
    const b64 = readFileSync(join(root, 'src/fonts', `${stem}-${sub}.woff2`)).toString('base64');
    fonts.push(`@font-face{font-family:'${fam}';font-style:normal;font-weight:400 700;font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${RANGES[sub]}}`);
  }
const css = fonts.join('\n') + '\n' + readFileSync(join(root, 'src/style.css'), 'utf8');
let html = readFileSync(join(root, 'src/index.html'), 'utf8');
html = html.replace('/*__STYLE__*/', () => css).replace('/*__SCRIPT__*/', () => js);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`built ${out.replace(root + '/', '')}  ${kb} KB  machines: [${ids.join(', ') || 'none'}]`);
