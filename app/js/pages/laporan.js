// Report ikut tempoh: Harian, Mingguan, Bulanan, Tahunan, atau Custom (dari tarikh – hingga tarikh). Owner, admin & manager sahaja.
// Ringkasan profit + perbandingan tempoh sebelum, sorotan, graf masuk/keluar,
// prestasi outlet, perbelanjaan ikut kategori, jualan ikut kaedah bayaran, kongsi ringkasan.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, addDays, endOfMonth, MONTHS, dateRange, dateShort, dayName } from '../format.js';
import { isPro, HISTORY_DAYS_FREE } from '../plan.js';

const PERIODS = { harian: 'Daily', mingguan: 'Weekly', bulanan: 'Monthly', tahunan: 'Yearly', julat: 'Custom' };
const PAGE = 1000;
const FC_GOOD = 35;
const COLORS = 6;    // --c1..--c6 dalam CSS

// Kekal semasa tukar halaman/outlet.
const state = { period: 'harian', date: null, from: null, to: null };   // from/to: tempoh Custom
let version = 0;
let catInfo = null;  // Map "type|name" -> { counts_in_profit, is_sales }

function shiftDate(period, iso, dir) {
  if (period === 'harian') return addDays(iso, dir);
  if (period === 'mingguan') return addDays(iso, 7 * dir);
  const [y, m, d] = iso.split('-').map(Number);
  if (period === 'tahunan') return `${y + dir}-${String(m).padStart(2, '0')}-${String(Math.min(d, 28)).padStart(2, '0')}`;
  const t = new Date(Date.UTC(y, m - 1 + dir, 1));
  const first = t.toISOString().slice(0, 10);
  const last = Number(endOfMonth(first).slice(-2));
  return first.slice(0, 8) + String(Math.min(d, last)).padStart(2, '0');
}

function buildPeriod(period, date) {
  let from = date, to = date, groups = [];
  const year = date.slice(0, 4);
  if (period === 'tahunan') {
    from = `${year}-01-01`; to = `${year}-12-31`;
    groups = MONTHS.map((label, i) => {
      const s = `${year}-${String(i + 1).padStart(2, '0')}-01`;
      return { label, from: s, to: endOfMonth(s) };
    });
  } else if (period === 'bulanan') {
    from = date.slice(0, 7) + '-01'; to = endOfMonth(from);
    const last = Number(to.slice(-2));
    for (let d = 1; d <= last; d += 7) {
      const e = Math.min(d + 6, last);
      groups.push({ label: d === e ? String(d) : `${d}–${e}`, from: addDays(from, d - 1), to: addDays(from, e - 1) });
    }
  } else {
    if (period === 'mingguan') {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      from = addDays(date, -((dow + 6) % 7)); to = addDays(from, 6);   // Isnin – Ahad
    }
    const start = period === 'harian' ? addDays(date, -6) : from;
    groups = Array.from({ length: 7 }, (_, i) => { const d = addDays(start, i); return { label: d.slice(-2), from: d, to: d }; });
  }
  return { from, to, groups };
}

const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5) + 1;

// Tempoh Custom: graf ikut hari (≤ 31 hari), minggu (≤ 4 bulan), bulan (≤ 3 tahun), atau tahun.
function buildCustom(from, to) {
  const n = daysBetween(from, to);
  const groups = [];
  if (n <= 31) {
    for (let d = from; d <= to; d = addDays(d, 1)) groups.push({ label: d.slice(-2), from: d, to: d });
  } else if (n <= 124) {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const e = addDays(d, 6) < to ? addDays(d, 6) : to;
      groups.push({ label: dateShort(d).replace(' ', '\u00a0'), from: d, to: e });
    }
  } else if (n <= 1096) {
    for (let d = from; d <= to;) {
      const e = endOfMonth(d) < to ? endOfMonth(d) : to;
      groups.push({ label: MONTHS[Number(d.slice(5, 7)) - 1] + (from.slice(0, 4) !== to.slice(0, 4) ? '\u00a0' + d.slice(2, 4) : ''), from: d, to: e });
      d = addDays(e, 1);
    }
  } else {
    for (let d = from; d <= to;) {
      const e = d.slice(0, 4) + '-12-31' < to ? d.slice(0, 4) + '-12-31' : to;
      groups.push({ label: d.slice(0, 4), from: d, to: e });
      d = addDays(e, 1);
    }
  }
  return { from, to, groups };
}

function periodLabel(period, date) {
  const { from, to } = buildPeriod(period, date);
  if (period === 'tahunan') return from.slice(0, 4);
  if (period === 'bulanan') return new Date(from + 'T00:00:00').toLocaleDateString('en-MY', { month: 'long', year: 'numeric' });
  if (period === 'mingguan') return `${dateShort(from)} – ${dateShort(to)}`;
  return new Date(date + 'T00:00:00').toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const forOutlet = q => (session.outletId !== ALL_OUTLETS ? q.eq('outlet_id', session.outletId) : q);

async function fetchAll(make) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await make().range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}
const fetchSummary = (from, to) => fetchAll(() => forOutlet(sb.from('daily_summary')
  .select('transaction_date,outlet_id,money_in,money_out,profit,bil_transaksi,sales')
  .gte('transaction_date', from).lte('transaction_date', to).order('transaction_date').order('outlet_id')));
const fetchTx = (from, to) => fetchAll(() => forOutlet(sb.from('transactions')
  .select('id,transaction_date,type,category,amount,payment_method,description')
  .gte('transaction_date', from).lte('transaction_date', to).order('id')));

async function loadCategories() {
  if (catInfo) return catInfo;
  const { data, error } = await sb.from('categories').select('name,type,counts_in_profit,is_sales');
  if (error) throw error;
  catInfo = new Map((data || []).map(c => [c.type + '|' + c.name, c]));
  return catInfo;
}

// Jumlah dalam sen supaya tiada ralat pecahan.
function totals(rows) {
  const s = k => rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0);
  return { sales: s('sales'), moneyIn: s('money_in'), out: s('money_out'), profit: s('profit'),
    count: rows.reduce((t, r) => t + Number(r.bil_transaksi), 0) };
}

const pctChange = (now, before) => (before ? (now - before) / Math.abs(before) * 100 : null);
function chip(pct, higherIsGood = true) {
  if (pct === null || !Number.isFinite(pct)) return '';
  const up = pct >= 0;
  return `<em class="chg ${up === higherIsGood ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</em>`;
}
const rmSen = c => rm(c / 100);
const perOutletProfit = rows => {
  const m = new Map();
  rows.forEach(r => m.set(r.outlet_id, (m.get(r.outlet_id) || 0) + Math.round(Number(r.profit) * 100)));
  return m;
};

function chartHTML(groups, rows, today) {
  const vals = groups.map(g => {
    const t = totals(rows.filter(r => r.transaction_date >= g.from && r.transaction_date <= g.to));
    return { ...g, inn: t.moneyIn, out: t.out, future: g.from > today };
  });
  const max = Math.max(1, ...vals.flatMap(v => [v.inn, v.out]));
  return vals.map((v, i) => {
    const text = v.future ? `${dateRange(v.from, v.to)} · No data yet`
      : `${dateRange(v.from, v.to)} · In ${rmSen(v.inn)} · Out ${rmSen(v.out)} · Profit ${rmSen(v.inn - v.out)}`;
    return `<button class="bar-group" type="button" data-i="${i}" data-text="${esc(text)}" aria-label="${esc(text)}">
      <span class="bars" aria-hidden="true"><span class="bar in" style="height:${v.inn / max * 100}%"></span><span class="bar out" style="height:${v.out / max * 100}%"></span></span>
      <span class="bar-label">${esc(v.label)}</span></button>`;
  }).join('');
}

function breakdownHTML(items, total, empty) {
  if (!total) return `<p class="loading-line">${empty}</p>`;
  const top = items.slice(0, COLORS - 1);
  const rest = items.slice(COLORS - 1).reduce((t, [, v]) => t + v, 0);
  if (rest) top.push(['Others', rest]);
  return `<div class="stackbar" aria-hidden="true">${top.map(([, v], i) => `<i style="width:${(v / total * 100).toFixed(2)}%;background:var(--c${i + 1})"></i>`).join('')}</div>
    <ul class="rows brk">${top.map(([n, v], i) => `<li><span class="dot" style="background:var(--c${i + 1})"></span><div class="t">${esc(n)}</div><span class="amt">${rmSen(v)}</span><span class="pct">${(v / total * 100).toFixed(1)}%</span></li>`).join('')}</ul>`;
}

// Ringkasan jualan harian ikut syif (format WhatsApp kedai), contoh:
//   15/11/2026 (AHAD)
//   SALE SIANG RM820.90
//   • QR RM628.90
//   • CASH RM182
//   ...
//   TOTAL SALE RM1992.80
// Hanya untuk SATU outlet yang staffnya tulis "pagi"/"siang"/"malam" dalam keterangan jualan.
// Selain itu pulangkan null (guna ringkasan biasa).
const HARI = ['AHAD', 'ISNIN', 'SELASA', 'RABU', 'KHAMIS', 'JUMAAT', 'SABTU'];
const PAY_LABEL = { 'DuitNow QR': 'QR', Cash: 'CASH', Card: 'CARD', 'E-wallet': 'E-WALLET', 'Bank Transfer': 'TRANSFER', Other: 'LAIN' };
const PAY_ORDER = ['QR', 'CASH'];
const shiftOf = d => { const t = (d || '').toLowerCase(); return /\bmalam\b/.test(t) ? 'MALAM' : /\b(pagi|siang)\b/.test(t) ? 'SIANG' : null; };
const waRm = c => 'RM' + (c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2));   // ikut gaya kedai: tiada koma, buang .00
function shiftSalesText(saleRows, from, upTo) {
  if (session.outletId === ALL_OUTLETS || !saleRows.some(r => shiftOf(r.description))) return null;
  const lines = [`*${outletName().toUpperCase()}*`];
  let grand = 0, days = 0;
  for (let d = from; d <= upTo; d = addDays(d, 1)) {
    const [y, m, dd] = d.split('-');
    lines.push(`${dd}/${m}/${y} (${HARI[new Date(d + 'T00:00:00Z').getUTCDay()]})`);
    const dayRows = saleRows.filter(r => r.transaction_date === d);
    if (!dayRows.length) { lines.push('TIADA JUALAN DIREKOD', '----------------------'); continue; }
    let dayTotal = 0;
    for (const shift of ['SIANG', 'MALAM', null]) {
      const rs = dayRows.filter(r => shiftOf(r.description) === shift);
      if (!rs.length) continue;
      const byPay = new Map();
      rs.forEach(r => { const k = PAY_LABEL[r.payment_method] || (r.payment_method || 'LAIN').toUpperCase(); byPay.set(k, (byPay.get(k) || 0) + Math.round(Number(r.amount) * 100)); });
      const sum = [...byPay.values()].reduce((a, b) => a + b, 0);
      dayTotal += sum;
      lines.push(`SALE ${shift || 'LAIN'} ${waRm(sum)}`);
      [...byPay].sort((a, b) => (PAY_ORDER.indexOf(a[0]) + 1 || 9) - (PAY_ORDER.indexOf(b[0]) + 1 || 9))
        .forEach(([k, v]) => lines.push(`• ${k} ${waRm(v)}`));
    }
    lines.push(`TOTAL SALE ${waRm(dayTotal)}`, '----------------------');
    grand += dayTotal; days++;
  }
  if (from !== upTo) lines.push(`JUMLAH SALE (${days} hari) ${waRm(grand)}`);
  return lines.join('\n');
}

const groupSum = (rows, keyFn) => {
  const m = new Map();
  rows.forEach(r => { const k = keyFn(r); m.set(k, (m.get(k) || 0) + Math.round(Number(r.amount) * 100)); });
  return [...m].sort((a, b) => b[1] - a[1]);
};

export default {
  render(view) {
    const today = todayKL();
    state.date = state.date || today;
    // Pakej Percuma: harian (30 hari terakhir) dan minggu ini sahaja; bulanan/tahunan perlu Pro.
    const pro = isPro();
    const minDate = pro ? '2000-01-01' : addDays(today, -(HISTORY_DAYS_FREE - 1));
    const locked = k => !pro && (k === 'bulanan' || k === 'tahunan');
    if (locked(state.period)) state.period = 'harian';
    if (!pro && state.date < minDate) state.date = today;
    if (!pro && state.period === 'mingguan') state.date = today;
    // Custom: lalai awal bulan ini hingga hari ini; Percuma terhad kepada 30 hari terakhir.
    const clampDay = d => (d > today ? today : d < minDate ? minDate : d);
    state.to = clampDay(state.to || today);
    state.from = clampDay(state.from || today.slice(0, 8) + '01');
    if (state.from > state.to) [state.from, state.to] = [state.to, state.from];

    view.innerHTML = `
      <div class="rep-controls">
        <div class="seg four five" role="group" aria-label="Report period">
          ${Object.entries(PERIODS).map(([k, v]) => `<button class="seg-opt" type="button" data-period="${k}">${locked(k) ? `<span class="seg-lock" aria-hidden="true">${icon('lock')}</span>` : ''}${v}${locked(k) ? '<span class="sr-only"> (Pro)</span>' : ''}</button>`).join('')}
        </div>
        <div class="datenav">
          <button type="button" id="repPrev" aria-label="Previous period">‹</button>
          <label id="repPick"><span id="repLabel"></span><input id="repDate" type="date" min="${minDate}" aria-label="Choose date"></label>
          <button type="button" id="repNext" aria-label="Next period">›</button>
        </div>
        <div class="range-pick" id="repRange" hidden>
          <label>From<input id="repFrom" type="date" min="${minDate}"></label>
          <span aria-hidden="true">–</span>
          <label>To<input id="repTo" type="date" min="${minDate}"></label>
        </div>
        <button class="share-btn" type="button" id="repShare">${icon('link')}Share summary</button>
        ${session.isAdminUp ? `<a class="share-btn" href="#/pnl">${icon('receipt')}P&amp;L (Form B)</a>` : ''}
      </div>
      <div id="repBody" class="stack"><p class="loading-line">Loading…</p></div>`;

    const syncControls = () => {
      view.querySelectorAll('[data-period]').forEach(b => {
        b.classList.toggle('on', b.dataset.period === state.period);
        b.setAttribute('aria-pressed', String(b.dataset.period === state.period));
      });
      const custom = state.period === 'julat';
      view.querySelector('.datenav').hidden = custom;
      $('repRange').hidden = !custom;
      $('repFrom').value = state.from; $('repFrom').max = today;
      $('repTo').value = state.to; $('repTo').max = today;
      if (custom) return;
      $('repLabel').textContent = periodLabel(state.period, state.date);
      $('repDate').value = state.date;
      $('repDate').max = today;
      $('repDate').hidden = state.period === 'tahunan';
      $('repNext').disabled = buildPeriod(state.period, state.date).to >= today;
      $('repPrev').disabled = !pro && (state.period === 'mingguan' || shiftDate(state.period, state.date, -1) < minDate);
    };

    let shareText = '';

    async function show() {
      const v = ++version;
      syncControls();
      const custom = state.period === 'julat';
      const { from, to, groups } = custom ? buildCustom(state.from, state.to) : buildPeriod(state.period, state.date);
      const upTo = to < today ? to : today;                 // tempoh berjalan: banding hari yang sama
      // Custom: banding dengan tempoh sama panjang betul-betul sebelumnya.
      const prevFrom = custom ? addDays(from, -daysBetween(from, to)) : shiftDate(state.period, from, -1);
      const prevTo = custom ? addDays(from, -1) : shiftDate(state.period, upTo, -1);
      $('repBody').innerHTML = '<p class="loading-line">Loading…</p>';
      shareText = '';

      let rows, prevRows, tx, cats, fcRows;
      try {
        const chartFrom = groups[0].from < from ? groups[0].from : from;
        [rows, prevRows, tx, cats, fcRows] = await Promise.all([
          fetchSummary(chartFrom, to), fetchSummary(prevFrom, prevTo), fetchTx(from, upTo), loadCategories(),
          session.isAdminUp && pro
            ? fetchAll(() => forOutlet(sb.from('daily_food_cost').select('transaction_date,outlet_id,ingredients').gte('transaction_date', from).lte('transaction_date', upTo).order('transaction_date')))
            : Promise.resolve(null)
        ]);
      } catch {
        if (v !== version) return;
        $('repBody').innerHTML = '<section class="card placeholder"><h2>Could not load report</h2><p>Check your internet and try again.</p></section>';
        return;
      }
      if (v !== version) return;   // pengguna dah tukar tempoh

      const inRange = rows.filter(r => r.transaction_date >= from && r.transaction_date <= to);
      const t = totals(inRange), p = totals(prevRows);
      const other = t.moneyIn - t.sales, pOther = p.moneyIn - p.sales;
      const margin = t.sales ? t.profit / t.sales * 100 : null;
      const ing = fcRows ? fcRows.reduce((s, r) => s + Math.round(Number(r.ingredients) * 100), 0) : null;
      const fcPct = ing != null && t.sales ? ing / t.sales * 100 : null;

      // Sorotan
      const byDay = new Map();
      inRange.forEach(r => {
        const d = byDay.get(r.transaction_date) || { profit: 0, sales: 0, outlets: new Map() };
        d.profit += Math.round(Number(r.profit) * 100); d.sales += Math.round(Number(r.sales) * 100);
        d.outlets.set(r.outlet_id, (d.outlets.get(r.outlet_id) || 0) + Number(r.sales));
        byDay.set(r.transaction_date, d);
      });
      const days = Math.round((new Date(upTo) - new Date(from)) / 864e5) + 1;
      const best = [...byDay].sort((a, b) => b[1].profit - a[1].profit)[0];
      const bestOutlet = best && session.outletId === ALL_OUTLETS && best[1].outlets.size > 1
        ? [...best[1].outlets].sort((a, b) => b[1] - a[1])[0][0] : null;
      const profitChg = pctChange(t.profit, p.profit);
      const prevName = custom ? `previous ${days} day${days === 1 ? '' : 's'}`
        : state.period === 'harian' ? 'previous day' : state.period === 'mingguan' ? 'previous week'
        : state.period === 'bulanan' ? 'previous month' : 'previous year';
      const prevSpan = prevFrom === prevTo ? `${dayName(prevFrom)}, ${dateShort(prevFrom)}` : dateRange(prevFrom, prevTo);
      const bestOutletAll = [...perOutletProfit(inRange)].sort((a, b) => b[1] - a[1])[0];

      // Outlet
      const perOutlet = new Map();
      inRange.forEach(r => {
        const o = perOutlet.get(r.outlet_id) || { sales: 0, out: 0, profit: 0 };
        o.sales += Math.round(Number(r.sales) * 100); o.out += Math.round(Number(r.money_out) * 100); o.profit += Math.round(Number(r.profit) * 100);
        perOutlet.set(r.outlet_id, o);
      });
      const showOutlets = session.outletId === ALL_OUTLETS && perOutlet.size > 1;
      const outletRows = [...perOutlet].sort((a, b) => outletName(a[0]).localeCompare(outletName(b[0]), 'ms-MY'));
      const bestMargin = Math.max(...outletRows.map(([, o]) => (o.sales ? o.profit / o.sales : -Infinity)));

      // Kategori & bayaran (hanya yang dikira dalam profit / jualan)
      const info = (r, k) => cats.get(r.type + '|' + r.category)?.[k];
      const expRows = tx.filter(r => r.type === 'Out' && info(r, 'counts_in_profit'));
      const saleRows = tx.filter(r => r.type === 'In' && info(r, 'is_sales'));
      const expItems = groupSum(expRows, r => r.category);
      const payItems = groupSum(saleRows, r => r.payment_method || 'Not set');
      const expTotal = expItems.reduce((s, [, x]) => s + x, 0);
      const payTotal = payItems.reduce((s, [, x]) => s + x, 0);

      const scope = outletName();
      $('repBody').innerHTML = `
        <section class="insights" aria-label="Highlights">
          <div class="ins"><span class="lbl">vs ${esc(prevName)}</span>
            ${profitChg == null ? '<span class="v">—</span><span class="s">No data to compare</span>'
              : `<span class="v ${profitChg >= 0 ? 'up' : 'down'}">${profitChg >= 0 ? '▲' : '▼'} ${Math.abs(profitChg).toFixed(1)}% profit</span><span class="s">${rmSen(t.profit)} vs ${rmSen(p.profit)} (${esc(prevSpan)})</span>`}</div>
          ${days === 1
            ? `<div class="ins"><span class="lbl">Profit margin</span><span class="v num">${margin == null ? '—' : margin.toFixed(1) + '%'}</span><span class="s">Profit ÷ sales</span></div>
          <div class="ins"><span class="lbl">Best outlet</span>${session.outletId === ALL_OUTLETS && bestOutletAll && bestOutletAll[1] > 0
              ? `<span class="v">${esc(outletName(bestOutletAll[0]))}</span><span class="s">Profit ${rmSen(bestOutletAll[1])}</span>`
              : `<span class="v">${esc(outletName())}</span><span class="s">${session.outletId === ALL_OUTLETS ? 'No profit yet' : 'Selected outlet only'}</span>`}</div>`
            : `<div class="ins"><span class="lbl">Average daily profit</span><span class="v num">${rmSen(Math.round(t.profit / days))}</span><span class="s">Over ${days} days${to > today ? ' so far' : ''}</span></div>
          <div class="ins"><span class="lbl">Best day</span>${best && best[1].profit > 0
            ? `<span class="v">${esc(dayName(best[0]))}, ${esc(dateShort(best[0]))}</span><span class="s">Profit ${rmSen(best[1].profit)}${bestOutlet ? ' · ' + esc(outletName(bestOutlet)) + ' led sales' : ''}</span>`
            : '<span class="v">—</span><span class="s">No profitable day yet</span>'}</div>`}
        </section>

        <div class="rep-grid">
          <section class="panel">
            <div class="ph"><h2>Profit summary</h2><span class="sub">${esc(dateRange(from, to))}</span></div>
            <div class="stmt">
              <div class="kv"><span>Sales</span><b>${rmSen(t.sales)}${chip(pctChange(t.sales, p.sales))}</b></div>
              <div class="kv"><span>Other income</span><b>${rmSen(other)}${chip(pctChange(other, pOther))}</b></div>
              <div class="kv"><span>Expenses</span><b class="neg">${rmSen(t.out)}${chip(pctChange(t.out, p.out), false)}</b></div>
              <div class="kv total"><span>Profit</span><b class="${t.profit < 0 ? 'neg' : ''}">${rmSen(t.profit)}</b></div>
              <div class="stmt-meta"><span>${t.count} transactions</span>${margin != null ? `<span>Margin ${margin.toFixed(1)}%</span>` : ''}${fcPct != null ? `<span>Food cost ${fcPct.toFixed(1)}%${fcPct > FC_GOOD ? ' ⚠' : ''}</span>` : ''}</div>
            </div>
            <p class="note-line">${icon('lock')}Owner money, loans, tax and asset purchases are not counted in profit.</p>
          </section>

          <section class="panel">
            <div class="ph"><div><h2>Money in &amp; out</h2><div class="sub">Tap a bar for details</div></div>
              <span class="legend"><i class="in"></i>In <i class="out"></i>Out</span></div>
            <div class="chart-wrap">
              ${rows.length ? `<div class="bar-chart" id="repChart" style="--groups:${groups.length}">${chartHTML(groups, rows, today)}</div>
              <p class="rep-detail" id="repDetail" role="status"></p>` : '<p class="loading-line">No transactions for this period.</p>'}
            </div>
          </section>
        </div>

        ${showOutlets ? `<section class="panel">
          <div class="ph"><h2>Outlet performance</h2><span class="sub">Best margin tagged</span></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Outlet</th><th>Sales</th><th>Expenses</th><th>Profit</th><th>Margin</th></tr></thead>
            <tbody>${outletRows.map(([id, o]) => {
              const m = o.sales ? o.profit / o.sales : null;
              return `<tr><td>${esc(outletName(id))}${m != null && m === bestMargin ? '<span class="best">best margin</span>' : ''}</td>
                <td>${esc(rmSen(o.sales).replace('RM ', ''))}</td><td>${esc(rmSen(o.out).replace('RM ', ''))}</td>
                <td class="${o.profit < 0 ? 'n' : 'p'}">${esc(rmSen(o.profit).replace('RM ', ''))}</td><td>${m == null ? '—' : (m * 100).toFixed(1) + '%'}</td></tr>`;
            }).join('')}</tbody>
            <tfoot><tr><td>Total</td><td>${esc(rmSen(t.sales).replace('RM ', ''))}</td><td>${esc(rmSen(t.out).replace('RM ', ''))}</td><td class="${t.profit < 0 ? 'n' : 'p'}">${esc(rmSen(t.profit).replace('RM ', ''))}</td><td>${margin == null ? '—' : margin.toFixed(1) + '%'}</td></tr></tfoot>
          </table></div>
        </section>` : ''}

        <div class="rep-grid-2">
          <section class="panel">
            <div class="ph"><h2>Expenses by category</h2><span class="sub">${rmSen(expTotal)}</span></div>
            ${breakdownHTML(expItems, expTotal, 'No expenses for this period.')}
          </section>
          <section class="panel">
            <div class="ph"><h2>Sales by payment method</h2><span class="sub">${rmSen(payTotal)}</span></div>
            ${breakdownHTML(payItems, payTotal, 'No sales for this period.')}
          </section>
        </div>`;

      shareText = shiftSalesText(saleRows, from, upTo) || [
        `${session.business?.name || 'BizProfit Pro'} · ${PERIODS[state.period]} report`,
        `${dateRange(from, to)} (${scope})`,
        `Sales: ${rmSen(t.sales)}`,
        `Expenses: ${rmSen(t.out)}`,
        `Profit: ${rmSen(t.profit)}${profitChg == null ? '' : ` (${profitChg >= 0 ? '▲' : '▼'} ${Math.abs(profitChg).toFixed(1)}% vs ${prevName})`}`,
        `${margin != null ? `Margin: ${margin.toFixed(1)}% · ` : ''}${t.count} transactions`
      ].join('\n');

      if (!rows.length) return;
      const chart = $('repChart');
      const pick = btn => {
        chart.querySelectorAll('.bar-group').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        $('repDetail').textContent = btn.dataset.text;
      };
      chart.onclick = e => { const b = e.target.closest('.bar-group'); if (b) pick(b); };
      // Bar mula: tarikh dipilih; Tahunan: bulan ini (tahun semasa) atau bulan terakhir yang ada data.
      let focus;
      if (state.period === 'tahunan') {
        const hasData = g => rows.some(r => r.transaction_date >= g.from && r.transaction_date <= g.to);
        focus = from.slice(0, 4) === today.slice(0, 4) ? Number(today.slice(5, 7)) - 1
          : groups.reduce((last, g, i) => (hasData(g) ? i : last), groups.length - 1);
      } else if (custom) {
        focus = groups.length - 1;
      } else {
        focus = groups.findIndex(g => state.date >= g.from && state.date <= g.to);
        if (focus < 0) focus = groups.length - 1;
      }
      pick(chart.children[focus]);
    }

    view.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => {
      if (locked(b.dataset.period)) { location.hash = '#/pakej'; return; }
      state.period = b.dataset.period; if (!pro && state.period === 'mingguan') state.date = today; show();
    }));
    $('repPrev').addEventListener('click', () => { state.date = shiftDate(state.period, state.date, -1); show(); });
    $('repNext').addEventListener('click', () => {
      const next = shiftDate(state.period, state.date, 1);
      state.date = next > today ? today : next; show();
    });
    $('repDate').addEventListener('click', e => { try { e.target.showPicker(); } catch { /* pelayar lama: biar lalai */ } });
    $('repDate').addEventListener('change', e => { if (e.target.value) { state.date = e.target.value > today ? today : e.target.value < minDate ? minDate : e.target.value; show(); } });
    const setRange = () => {
      let f = $('repFrom').value, t = $('repTo').value;
      if (!f || !t) return;
      f = clampDay(f); t = clampDay(t);
      if (f > t) [f, t] = [t, f];                    // tersalah susun: tukar sendiri
      state.from = f; state.to = t; show();
    };
    ['repFrom', 'repTo'].forEach(id => {
      $(id).addEventListener('change', setRange);
      $(id).addEventListener('click', e => { try { e.target.showPicker(); } catch { /* pelayar lama */ } });
    });
    $('repShare').addEventListener('click', async () => {
      if (!shareText) { toast('Report is still loading.'); return; }
      try {
        if (navigator.share) { await navigator.share({ text: shareText }); return; }
      } catch (e) { if (e && e.name === 'AbortError') return; }
      try { await navigator.clipboard.writeText(shareText); toast('Summary copied. Paste it in WhatsApp.'); }
      catch { toast('Could not copy on this device.', 'error'); }
    });
    show();
    return () => { version++; };
  }
};
