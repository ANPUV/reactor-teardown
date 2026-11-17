// kit/i18n.js - gettext-style lookup with the ENGLISH string as the key.
//   t('Control rods')            -> 'Thanh điều khiển' (vi) or the key itself (en / missing)
//   registerDict({...})          merge a Vietnamese dictionary (shell + each machine; build.mjs does this)
//   retranslate(root)            re-render every [data-t] / [data-t-title] / [data-t-aria] element under root
// Technical labels (ids, units, isotope names, status words) simply have no entry and stay English.
let lang = 'vi';
const dict = Object.create(null);
const missing = new Set();
const listeners = [];

export const getLang = () => lang;
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'vi';
  document.documentElement.lang = lang;
  listeners.forEach((f) => f(lang));
}
export const onLang = (f) => listeners.push(f);
export function registerDict(d) {
  Object.assign(dict, d || {});
}
export function t(s) {
  if (typeof s !== 'string' || s === '' || lang === 'en') return s;
  const v = dict[s];
  if (v === undefined) {
    if (/[A-Za-z]{3}/.test(s)) missing.add(s);
    return s;
  }
  return v;
}
/** Strings that reached t() while Vietnamese was active without a dictionary entry (dev tool). */
export const missingStrings = () => [...missing].sort();
export function retranslate(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) {
    const v = t(el.dataset.t);
    if (el.textContent !== v) el.textContent = v;
  }
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = t(el.dataset.tTitle);
  for (const el of root.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
}
