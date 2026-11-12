// Format duit, nombor dan tarikh (waktu Malaysia).
const fmt2 = new Intl.NumberFormat('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = new Intl.NumberFormat('ms-MY', { maximumFractionDigits: 3 });

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

export const DAYS = ['Aha', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];
export const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
export const dayName = iso => DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];

export const dateLong = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ms-MY',
  { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const dateShort = iso => new Date(iso + 'T00:00:00').toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' });

export function dateRange(from, to) {
  if (from === to) return dateLong(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return dateShort(from) + (sameYear ? '' : ' ' + from.slice(0, 4)) + ' – ' + dateShort(to) + ' ' + to.slice(0, 4);
}
