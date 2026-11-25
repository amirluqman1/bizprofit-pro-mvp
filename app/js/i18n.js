// Bahasa app: English (asal) atau Bahasa Melayu (pilihan di Menu).
// Teks sumber ditulis dalam English di dalam kod; t('...') pulangkan terjemahan BM
// dari kamus MS di bawah bila bahasa = 'ms'. Teks tiada dalam kamus dipapar seperti asal.
// Pembolehubah: t('{n} items', { n: 3 }) -> "3 barang".
import { MS } from './i18n-ms.js';

const KEY = 'bp.lang';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
let lang = read() === 'ms' ? 'ms' : 'en';

export const getLang = () => lang;
export const locale = () => (lang === 'ms' ? 'ms-MY' : 'en-MY');

export function setLang(next) {
  lang = next === 'ms' ? 'ms' : 'en';
  try { localStorage.setItem(KEY, lang); } catch { /* abaikan */ }
  document.documentElement.lang = lang;
  applyStatic();
  window.dispatchEvent(new Event('bp:lang'));
}

export function t(s, vars) {
  let out = lang === 'ms' && Object.prototype.hasOwnProperty.call(MS, s) ? MS[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return out;
}

// Teks statik dalam index.html: data-i18n="Teks English" (isi), data-i18n-aria="..." (aria-label).
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

document.documentElement.lang = lang;
