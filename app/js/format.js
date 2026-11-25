// Format duit, nombor dan tarikh (waktu Malaysia).
import { getLang, locale } from './i18n.js';
const fmt2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 3 });

export const rm = n => (n < 0 ? '−' : '') + 'RM ' + fmt2.format(Math.abs(Number(n) || 0));
export const qty = n => fmtQty.format(Number(n) || 0);

// Jumlah duit dalam sen (integer) supaya tiada ralat pecahan.
export const sen = rows => key => rows.reduce((t, r) => t + Math.round(Number(r[key]) * 100), 0);

export const todayKL = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });

export function addDays(iso, d) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

export function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Nama hari & bulan ikut bahasa. Array dikemas kini di tempat yang sama bila bahasa bertukar.
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_MS = ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_MS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
export const DAYS = [];
export const MONTHS = [];
const syncNames = () => {
  DAYS.splice(0, 7, ...(getLang() === 'ms' ? DAYS_MS : DAYS_EN));
  MONTHS.splice(0, 12, ...(getLang() === 'ms' ? MONTHS_MS : MONTHS_EN));
};
syncNames();
window.addEventListener('bp:lang', syncNames);
export const dayName = iso => DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];

export const dateLong = iso => new Date(iso + 'T00:00:00').toLocaleDateString(locale(),
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const dateShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

export function dateRange(from, to) {
  if (from === to) return dateLong(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return dateShort(from) + (sameYear ? '' : ' ' + from.slice(0, 4)) + ' – ' + dateShort(to) + ' ' + to.slice(0, 4);
}
