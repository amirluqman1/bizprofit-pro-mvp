// Halaman Utama: Profit Bersih, Jualan, Perbelanjaan, Transaksi, pintasan, trend 7 hari.
// Data dari view daily_summary (owner: semua outlet, manager: outlet sendiri; staff tidak dibenarkan masuk).
import { $, esc, icon } from '../ui.js';
import { sb, session, ALL_OUTLETS } from '../session.js';

const DAYS = ['Aha', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];
const SERIES = {
  sales:  { label: 'Jualan',       pick: d => d.sales },
  profit: { label: 'Profit',       pick: d => d.profit },
  out:    { label: 'Perbelanjaan', pick: d => d.out }
};

const fmt2 = new Intl.NumberFormat('ms-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rm = n => (n < 0 ? '−' : '') + 'RM ' + fmt2.format(Math.abs(n));
const rmTile = n => `<small>RM</small>${n < 0 ? '−' : ''}${fmt2.format(Math.abs(n))}`;
function rmShort(n) {
  const a = Math.abs(n);
  const s = a >= 1000 ? (a / 1000).toFixed(a % 1000 === 0 ? 0 : 1).replace(/\.0$/, '') + 'K' : String(Math.round(a));
  return (n < 0 ? '−' : '') + 'RM ' + s;
}
const todayKL = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
function addDays(iso, d) {
  const t = new Date(iso + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
const dayName = iso => DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()];

// % perubahan berbanding semalam. null jika semalam 0 (tak boleh bahagi dengan kosong).
function change(now, before) {
  if (!before) return null;
  return (now - before) / Math.abs(before) * 100;
}
// higherIsGood: untuk Perbelanjaan, naik = buruk (merah).
function badge(pct, higherIsGood = true) {
  if (pct === null || !Number.isFinite(pct)) return '<span class="chg flat">— tiada data semalam</span>';
  const up = pct >= 0;
  const good = up === higherIsGood;
  return `<span class="chg ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(1)}%</span>`;
}

const COINS = `<svg class="coins" viewBox="0 0 64 56" aria-hidden="true">
  <defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6dd8a"/><stop offset="1" stop-color="#c99a2e"/></linearGradient></defs>
  ${[0, 1, 2].map(i => `<g transform="translate(4 ${34 - i * 8})"><ellipse cx="20" cy="10" rx="18" ry="6" fill="#a87b1f"/><rect x="2" y="4" width="36" height="6" fill="#a87b1f"/><ellipse cx="20" cy="4" rx="18" ry="6" fill="url(#gc)"/></g>`).join('')}
  ${[0, 1, 2].map(i => `<g transform="translate(26 ${38 - i * 8})"><ellipse cx="18" cy="10" rx="16" ry="5.5" fill="#a87b1f"/><rect x="2" y="4.5" width="32" height="5.5" fill="#a87b1f"/><ellipse cx="18" cy="4.5" rx="16" ry="5.5" fill="url(#gc)"/></g>`).join('')}
</svg>`;

function sparkline(values) {
  const w = 140, h = 56, max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [i * (w / (values.length - 1)), h - 6 - ((v - min) / span) * (h - 14)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fe08a" stop-opacity=".35"/><stop offset="1" stop-color="#5fe08a" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${w} ${h} L0 ${h} Z" fill="url(#sg)" stroke="none"/>
    <path d="${line}" fill="none" stroke="#5fe08a" stroke-width="2.2"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="#d9ffe5"/>
  </svg>`;
}

function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function trendChart(days, key) {
  const vals = days.map(d => SERIES[key].pick(d));
  const W = 320, H = 170, L = 52, R = 12, T = 12, B = 28;
  const hasNeg = vals.some(v => v < 0);
  const top = niceMax(Math.max(0, ...vals));
  const bottom = hasNeg ? -niceMax(-Math.min(...vals)) : 0;
  const y = v => T + (top - v) / (top - bottom) * (H - T - B);
  const x = i => L + i * ((W - L - R) / (vals.length - 1));
  const ticks = [0, 1, 2, 3, 4].map(i => bottom + (top - bottom) * i / 4);
  const pts = vals.map((v, i) => [x(i), y(v)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const base = y(Math.max(bottom, 0));
  const desc = days.map((d, i) => `${dayName(d.date)} ${rm(vals[i])}`).join(', ');
  return `<svg class="trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend ${esc(SERIES[key].label)} 7 hari: ${esc(desc)}">
    <defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fe08a" stop-opacity=".28"/><stop offset="1" stop-color="#5fe08a" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 8}" y="${y(t) + 4}" class="ylab">${rmShort(t)}</text>`).join('')}
    <path d="${line} L${pts[pts.length - 1][0]} ${base} L${pts[0][0]} ${base} Z" fill="url(#tg)"/>
    <path d="${line}" fill="none" stroke="#5fe08a" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 5 : 4}" class="${i === pts.length - 1 ? 'pt last' : 'pt'}"><title>${esc(dayName(days[i].date))}: ${esc(rm(vals[i]))}</title></circle>`).join('')}
    ${days.map((d, i) => `<text x="${x(i)}" y="${H - 8}" class="xlab">${dayName(d.date)}</text>`).join('')}
  </svg>`;
}

async function load() {
  const today = todayKL();
  const from = addDays(today, -7);   // semalam + 7 hari graf
  let q = sb.from('daily_summary')
    .select('transaction_date,outlet_id,money_out,profit,bil_transaksi,sales')
    .gte('transaction_date', from).lte('transaction_date', today);
  if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
  const { data, error } = await q;
  if (error) throw error;
  const byDate = new Map();
  for (let i = 7; i >= 0; i--) byDate.set(addDays(today, -i), { date: addDays(today, -i), sales: 0, out: 0, profit: 0, count: 0 });
  for (const r of data || []) {
    const d = byDate.get(r.transaction_date);
    if (!d) continue;
    d.sales += Number(r.sales); d.out += Number(r.money_out);
    d.profit += Number(r.profit); d.count += Number(r.bil_transaksi);
  }
  const all = [...byDate.values()];
  return { today: all[7], yesterday: all[6], week: all.slice(1) };
}

export default {
  subtitle: 'Ringkasan prestasi perniagaan hari ini.',
  async render(view) {
    view.innerHTML = '<section class="card hero loading"><p class="greet-sub">Memuatkan ringkasan…</p></section>';
    let d;
    try { d = await load(); }
    catch {
      view.innerHTML = `<section class="card placeholder">${icon('chart')}<h2>Ringkasan tak dapat dimuatkan</h2>
        <p>Semak sambungan internet dan cuba lagi.</p><button class="btn primary" id="retry" type="button">Cuba lagi</button></section>`;
      $('retry').onclick = () => this.render(view);
      return;
    }
    const { today, yesterday, week } = d;
    const empty = week.every(x => x.count === 0);
    let series = 'sales';

    view.innerHTML = `
      <section class="card hero">
        ${COINS}
        <div class="hero-body">
          <p class="hero-label">Profit Bersih <span class="info" title="Jualan + pendapatan lain − perbelanjaan operasi. Duit owner, pinjaman, cukai dan beli aset tidak dikira.">i</span></p>
          <p class="hero-value ${today.profit < 0 ? 'neg' : ''}">${rm(today.profit)}</p>
          <p class="hero-foot">${badge(change(today.profit, yesterday.profit))}<span>berbanding semalam</span></p>
        </div>
        ${sparkline(week.map(x => x.profit))}
      </section>

      <div class="stats3">
        <div class="tile">${icon('cart')}<p class="tile-label">Jualan</p><p class="tile-value">${rmTile(today.sales)}</p>${badge(change(today.sales, yesterday.sales))}</div>
        <div class="tile">${icon('layers')}<p class="tile-label">Perbelanjaan</p><p class="tile-value">${rmTile(today.out)}</p>${badge(change(today.out, yesterday.out), false)}</div>
        <div class="tile">${icon('receipt')}<p class="tile-label">Transaksi</p><p class="tile-value"><small>Hari ini</small>${today.count}</p>${badge(change(today.count, yesterday.count))}</div>
      </div>

      <div class="shortcuts">
        <a class="short" href="#/rekod">${icon('plus-box')}<span>Key In<br>Transaksi</span>${icon('chev-right')}</a>
        <a class="short" href="#/stok">${icon('box')}<span>Inventori</span>${icon('chev-right')}</a>
        <a class="short" href="#/laporan">${icon('chart')}<span>Laporan</span>${icon('chev-right')}</a>
        <a class="short" href="#/rekod">${icon('history')}<span>Sejarah</span>${icon('chev-right')}</a>
      </div>

      <section class="card trend">
        <div class="trend-head">
          <h2>Trend <span id="trendName">Jualan</span> (7 Hari)</h2>
          <label class="pill-select"><select id="trendSeries" aria-label="Pilih data graf">
            ${Object.entries(SERIES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('')}
          </select>${icon('chevron')}</label>
        </div>
        <div id="trendChart">${trendChart(week, series)}</div>
        ${empty ? '<p class="greet-sub trend-empty">Belum ada transaksi dalam 7 hari ini. Graf akan terisi bila ada key in.</p>' : ''}
      </section>`;

    $('trendSeries').addEventListener('change', e => {
      series = e.target.value;
      $('trendName').textContent = SERIES[series].label;
      $('trendChart').innerHTML = trendChart(week, series);
    });
  }
};
