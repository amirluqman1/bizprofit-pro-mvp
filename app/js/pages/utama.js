// Halaman Home: sekilas hari ini. Profit + trend 7 hari, Jualan, Perbelanjaan, Transaksi,
// "Needs attention" (stok habis/rendah, food cost outlet melebihi 35%), transaksi terkini.
// Graf penuh, outlet dan analisa ada di Report. Staff tidak dibenarkan masuk (ada profit).
import { $, esc, icon, countUp } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, qty, todayKL, addDays, dayName } from '../format.js';

const FC_LIMIT = 35;   // sama dengan Food Cost: hijau ≤ 35%

const fmt2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => `<small>RM</small><span data-count="${n}" data-fmt="money">${n < 0 ? '−' : ''}${fmt2.format(Math.abs(n))}</span>`;
const forOutlet = q => (session.outletId !== ALL_OUTLETS ? q.eq('outlet_id', session.outletId) : q);

// % perubahan berbanding semalam. null jika semalam 0.
const change = (now, before) => (before ? (now - before) / Math.abs(before) * 100 : null);
function badge(pct, higherIsGood = true, suffix = '') {
  if (pct === null || !Number.isFinite(pct)) return '<span class="chg flat">no data yesterday</span>';
  const up = pct >= 0;
  return `<span class="chg ${up === higherIsGood ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%${suffix}</span>`;
}

function sparkline(values) {
  const W = 120, H = 40, pad = 4;
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => [pad + i * (W - 2 * pad) / (values.length - 1), H - pad - (v - min) / span * (H - 2 * pad)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${line} L${last[0]} ${H} L${pts[0][0]} ${H} Z" fill="var(--good-soft)"/>
    <path d="${line}" fill="none" stroke="var(--mint)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="3" fill="var(--mint)"/></svg>`;
}

const status = x => (Number(x.target_qty) <= 0 ? 'unset' : Number(x.current_qty) <= 0 ? 'habis' : Number(x.current_qty) < Number(x.target_qty) ? 'rendah' : 'ok');
const timeOf = iso => (iso ? new Date(iso).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' }) : '');

async function load() {
  const today = todayKL();
  const from = addDays(today, -7);   // semalam + 7 hari trend
  const jobs = [
    forOutlet(sb.from('daily_summary').select('transaction_date,outlet_id,money_out,profit,bil_transaksi,sales')
      .gte('transaction_date', from).lte('transaction_date', today)),
    forOutlet(sb.from('transactions').select('id,type,category,amount,description,outlet_id,created_at')
      .eq('transaction_date', today).order('created_at', { ascending: false }).limit(5)),
    forOutlet(sb.from('inventory_items').select('id,name,unit,current_qty,target_qty,outlet_id')),
    session.isAdminUp
      ? forOutlet(sb.from('daily_food_cost').select('transaction_date,outlet_id,ingredients').gte('transaction_date', addDays(today, -6)).lte('transaction_date', today))
      : Promise.resolve({ data: [] })
  ];
  const [sum, tx, inv, fc] = await Promise.all(jobs);
  if (sum.error) throw sum.error;

  const byDate = new Map();
  for (let i = 7; i >= 0; i--) byDate.set(addDays(today, -i), { date: addDays(today, -i), sales: 0, out: 0, profit: 0, count: 0 });
  const salesByOutlet = new Map();   // 7 hari terakhir, untuk food cost
  for (const r of sum.data || []) {
    const d = byDate.get(r.transaction_date);
    if (!d) continue;
    d.sales += Number(r.sales); d.out += Number(r.money_out);
    d.profit += Number(r.profit); d.count += Number(r.bil_transaksi);
    if (r.transaction_date >= addDays(today, -6)) salesByOutlet.set(r.outlet_id, (salesByOutlet.get(r.outlet_id) || 0) + Number(r.sales));
  }
  const all = [...byDate.values()];

  // Needs attention: stok dahulu (habis, kemudian rendah), kemudian food cost.
  const stock = (inv.data || []).map(x => ({ ...x, st: status(x) })).filter(x => x.st === 'habis' || x.st === 'rendah')
    .sort((a, b) => (a.st === b.st ? Number(a.current_qty) / Number(a.target_qty) - Number(b.current_qty) / Number(b.target_qty) : a.st === 'habis' ? -1 : 1));
  const ingByOutlet = new Map();
  for (const r of fc.data || []) ingByOutlet.set(r.outlet_id, (ingByOutlet.get(r.outlet_id) || 0) + Number(r.ingredients));
  const fcAlerts = [...ingByOutlet].map(([id, ing]) => ({ id, pct: salesByOutlet.get(id) ? ing / salesByOutlet.get(id) * 100 : null }))
    .filter(f => f.pct != null && f.pct > FC_LIMIT).sort((a, b) => b.pct - a.pct);

  return { today: all[7], yesterday: all[6], week: all.slice(1), tx: tx.error ? null : tx.data || [], stock: inv.error ? null : stock, fcAlerts };
}

function attentionHTML(stock, fcAlerts) {
  if (stock === null) return '<li><span class="empty-row">Could not load stock.</span></li>';
  const STOCK_SHOWN = 5;
  const items = [
    ...fcAlerts.map(f => `<li><span class="alert-ic ${f.pct > 40 ? 'crit' : 'warn'}" aria-hidden="true">${icon('chart')}</span>
      <div style="min-width:0"><div class="t">Food cost at ${esc(outletName(f.id))}: ${f.pct.toFixed(1)}%</div><div class="m">Above the ${FC_LIMIT}% guide, last 7 days</div></div>
      <a class="pill ${f.pct > 40 ? 'crit' : 'warn'}" href="#/foodcost">Review</a></li>`),
    ...stock.slice(0, STOCK_SHOWN).map(x => `<li><span class="alert-ic ${x.st === 'habis' ? 'crit' : 'warn'}" aria-hidden="true">${icon('box')}</span>
      <div style="min-width:0"><div class="t">${esc(x.name)}</div><div class="m">${x.st === 'habis' ? 'Out of stock' : `${qty(x.current_qty)} ${esc(x.unit)} left`} · target ${qty(x.target_qty)} ${esc(x.unit)}${session.outletId === ALL_OUTLETS ? ' · ' + esc(outletName(x.outlet_id)) : ''}</div></div>
      <span class="pill ${x.st === 'habis' ? 'crit' : 'warn'}">${x.st === 'habis' ? 'Out' : 'Low'}</span></li>`)
  ];
  if (!items.length) return '<li><span class="empty-row">All good. Nothing needs attention right now.</span></li>';
  return items.join('');
}

function txHTML(tx) {
  if (tx === null) return '<li><span class="empty-row">Could not load transactions.</span></li>';
  if (!tx.length) return '<li><span class="empty-row">No transactions yet today.</span></li>';
  return tx.map(t => {
    const meta = [session.outletId === ALL_OUTLETS ? outletName(t.outlet_id) : '', timeOf(t.created_at), t.description ? t.category : ''].filter(Boolean).join(' · ');
    const inn = t.type === 'In';
    return `<li><div style="min-width:0"><div class="t">${esc(t.description || t.category)}</div><div class="m">${esc(meta)}</div></div>
      <div class="amt ${inn ? 'in' : ''}">${inn ? '+' : '−'}${esc(rm(Math.abs(Number(t.amount))))}</div></li>`;
  }).join('');
}

export default {
  async render(view) {
    view.innerHTML = '<div class="skel-home" aria-busy="true" aria-label="Loading"><div class="skel hero-skel"></div><div class="skel"></div></div>';
    let d;
    try { d = await load(); }
    catch {
      view.innerHTML = `<section class="card placeholder">${icon('chart')}<h2>Could not load summary</h2>
        <p>Check your internet connection and try again.</p><button class="btn primary" id="retry" type="button">Try again</button></section>`;
      $('retry').onclick = () => this.render(view);
      return;
    }
    const { today, yesterday, week, tx, stock, fcAlerts } = d;
    const attnCount = stock === null ? 0 : stock.length + fcAlerts.length;
    const trendDesc = week.map(x => `${dayName(x.date)} ${rm(x.profit)}`).join(', ');

    view.innerHTML = `
      <section class="kpis" aria-label="Today at a glance">
        <div class="kpi kpi-main">
          <span class="lbl">Net profit today <span class="info" title="Sales + other income − operating expenses. Owner money, loans, tax and asset purchases are not included.">i</span></span>
          <div class="row">
            <p class="val ${today.profit < 0 ? 'neg' : ''}">${money(today.profit)}</p>
            <div role="img" aria-label="Profit, last 7 days: ${esc(trendDesc)}">${sparkline(week.map(x => x.profit))}<div class="spark-cap">7 days</div></div>
          </div>
          ${badge(change(today.profit, yesterday.profit), true, ' vs yesterday')}
        </div>
        <div class="kpi"><span class="lbl">Sales</span><p class="val">${money(today.sales)}</p>${badge(change(today.sales, yesterday.sales))}</div>
        <div class="kpi"><span class="lbl">Expenses</span><p class="val">${money(today.out)}</p>${badge(change(today.out, yesterday.out), false)}</div>
        <div class="kpi"><span class="lbl">Transactions</span><p class="val"><span data-count="${today.count}" data-fmt="int">${today.count}</span></p>
          <span class="chg flat">${today.count - yesterday.count >= 0 ? '+' : '−'}${Math.abs(today.count - yesterday.count)} vs yesterday</span></div>
      </section>

      <div class="home-grid">
        <section class="panel">
          <div class="ph"><h2>Needs attention</h2><span class="sub">${attnCount ? `${attnCount} item${attnCount > 1 ? 's' : ''}` : ''}</span></div>
          <ul class="rows alerts">${attentionHTML(stock, fcAlerts)}</ul>
          ${stock && stock.length ? `<div class="panel-foot"><span>${stock.length} stock item${stock.length > 1 ? 's' : ''} to restock</span><a href="#/stok">Open Stock →</a></div>` : ''}
        </section>

        <section class="panel">
          <div class="ph"><h2>Recent transactions</h2><span class="sub">Today</span></div>
          <ul class="rows">${txHTML(tx)}</ul>
          <div class="panel-foot"><span>${tx && tx.length ? `${tx.length} of ${today.count} today` : ''}</span><a href="#/rekod?t=sejarah">View all →</a></div>
        </section>
      </div>

      <nav class="quick" aria-label="Shortcuts">
        <a href="#/laporan">${icon('chart')}Full report</a>
        ${session.isAdminUp ? `<a href="#/foodcost">${icon('cart')}Food Cost</a>` : ''}
        <a href="#/rekod?t=sejarah">${icon('history')}Transaction history</a>
      </nav>`;

    countUp(view);
  }
};
