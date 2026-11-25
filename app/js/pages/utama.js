// Halaman Home: sekilas hari ini. Profit + trend 7 hari, Jualan, Perbelanjaan, Transaksi,
// "Needs attention" (stok habis/rendah, food cost outlet melebihi 35%), transaksi terkini.
// Graf penuh, outlet dan analisa ada di Report. Staff tidak dibenarkan masuk (ada profit).
import { $, esc, icon, countUp } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, qty, todayKL, addDays, dayName } from '../format.js';
import { isPro, PLANS } from '../plan.js';
import { t } from '../i18n.js';

const FC_LIMIT = 35;   // sama dengan Food Cost: hijau ≤ 35%

const fmt2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => `<small>RM</small><span data-count="${n}" data-fmt="money">${n < 0 ? '−' : ''}${fmt2.format(Math.abs(n))}</span>`;
const forOutlet = q => (session.outletId !== ALL_OUTLETS ? q.eq('outlet_id', session.outletId) : q);

// % perubahan berbanding semalam. null jika semalam 0.
const change = (now, before) => (before ? (now - before) / Math.abs(before) * 100 : null);
function badge(pct, higherIsGood = true, suffix = '') {
  if (pct === null || !Number.isFinite(pct)) return `<span class="chg flat">${t('no data yesterday')}</span>`;
  const up = pct >= 0;
  return `<span class="chg ${up === higherIsGood ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%${suffix}</span>`;
}

// Graf profit 7 hari (SVG). Label hari dalam HTML supaya tak mengecil di phone.
const CW = 600, CH = 180, CPAD = 14, CTOP = 12, CBOT = 8;
function chartHTML(week) {
  const vals = week.map(x => x.profit);
  // Skala ikut data; garis sifar hanya bila ada hari rugi.
  let max = Math.max(...vals), min = Math.min(...vals);
  const hasLoss = min < 0;
  const span = max - min || 1; max += span * .08; min -= span * .12;
  const x = i => CPAD + i * (CW - 2 * CPAD) / (vals.length - 1);
  const y = v => CTOP + (1 - (v - min) / (max - min)) * (CH - CTOP - CBOT);
  const pts = vals.map((v, i) => [x(i), y(v)]);
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {   // lengkung licin (Catmull-Rom → Bezier)
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)},${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  const last = pts.length - 1;
  const zero = hasLoss ? `<line class="zero" x1="0" x2="${CW}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" vector-effect="non-scaling-stroke"/>` : '';
  const grid = [0, .5, 1].map(f => { const yy = (CTOP + f * (CH - CTOP - CBOT)).toFixed(1); return `<line class="grid" x1="0" x2="${CW}" y1="${yy}" y2="${yy}" vector-effect="non-scaling-stroke"/>`; }).join('');
  const dots = pts.map((p, i) => `<circle class="pt" style="--k:${i}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" vector-effect="non-scaling-stroke"/>`).join('');
  const hits = pts.map((p, i) => `<rect class="hit" data-i="${i}" x="${(p[0] - CW / 14).toFixed(1)}" y="0" width="${(CW / 7).toFixed(1)}" height="${CH}" tabindex="0" role="img" aria-label="${dayName(week[i].date)}${i === last ? ' (' + t('today') + ')' : ''}: ${rm(vals[i])}"/>`).join('');
  const days = week.map((w, i) => `<span style="left:${(x(i) / CW * 100).toFixed(2)}%">${i === last ? t('Today') : dayName(w.date)}</span>`).join('');
  return `<svg class="h-svg" viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" role="group" aria-label="${t('Net profit, last 7 days')}">
      <defs><linearGradient id="hArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#10B981" stop-opacity=".28"/><stop offset="1" stop-color="#10B981" stop-opacity="0"/></linearGradient></defs>
      ${grid}${zero}
      <path class="area" fill="url(#hArea)" d="${d} L${x(last).toFixed(1)} ${CH - CBOT} L${x(0).toFixed(1)} ${CH - CBOT} Z"/>
      <path class="line" d="${d}" vector-effect="non-scaling-stroke"/>
      <line class="guide" x1="0" x2="0" y1="${CTOP}" y2="${CH - CBOT}" vector-effect="non-scaling-stroke"/>
      ${dots}${hits}
    </svg><div class="h-days" aria-hidden="true">${days}</div>`;
}

// Bar mini 7 hari (hiasan; nilai sebenar ada pada label kad).
function mini(values, out = false) {
  const max = Math.max(...values.map(v => Math.abs(v)), 1);
  return `<span class="h-mini${out ? ' out' : ''}" aria-hidden="true">${values.map((v, k) => `<i style="--h:${Math.max(4, Math.abs(v) / max * 100).toFixed(0)}%;--k:${k}"></i>`).join('')}</span>`;
}

function wireChart(view, week) {
  const svg = view.querySelector('.h-svg'); if (!svg) return;
  const dots = [...svg.querySelectorAll('.pt')], guide = svg.querySelector('.guide');
  const roDay = view.querySelector('#hRoDay'), roVal = view.querySelector('#hRoVal');
  const total = week.reduce((s, w) => s + w.profit, 0);
  const off = () => { dots.forEach(o => o.classList.remove('on')); guide.classList.remove('on'); roDay.textContent = t('Last 7 days'); roVal.textContent = t('{amt} total', { amt: rm(total) }); };
  svg.querySelectorAll('.hit').forEach(h => {
    const i = Number(h.dataset.i);
    const on = () => {
      dots.forEach(o => o.classList.remove('on')); dots[i].classList.add('on');
      const cx = dots[i].getAttribute('cx'); guide.setAttribute('x1', cx); guide.setAttribute('x2', cx); guide.classList.add('on');
      roDay.textContent = i === week.length - 1 ? t('{day} · today', { day: dayName(week[i].date) }) : dayName(week[i].date);
      roVal.textContent = rm(week[i].profit);
    };
    h.addEventListener('pointerenter', on); h.addEventListener('focus', on);
    h.addEventListener('pointerleave', off); h.addEventListener('blur', off);
  });
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
  const profitByOutlet = new Map();   // hari ini sahaja
  for (const r of sum.data || []) if (r.transaction_date === today) profitByOutlet.set(r.outlet_id, (profitByOutlet.get(r.outlet_id) || 0) + Number(r.profit));

  // Needs attention: stok dahulu (habis, kemudian rendah), kemudian food cost.
  const stock = (inv.data || []).map(x => ({ ...x, st: status(x) })).filter(x => x.st === 'habis' || x.st === 'rendah')
    .sort((a, b) => (a.st === b.st ? Number(a.current_qty) / Number(a.target_qty) - Number(b.current_qty) / Number(b.target_qty) : a.st === 'habis' ? -1 : 1));
  const ingByOutlet = new Map();
  for (const r of fc.data || []) ingByOutlet.set(r.outlet_id, (ingByOutlet.get(r.outlet_id) || 0) + Number(r.ingredients));
  const fcAlerts = [...ingByOutlet].map(([id, ing]) => ({ id, pct: salesByOutlet.get(id) ? ing / salesByOutlet.get(id) * 100 : null }))
    .filter(f => f.pct != null && f.pct > FC_LIMIT).sort((a, b) => b.pct - a.pct);

  // Food cost keseluruhan 7 hari (admin ke atas sahaja), hanya outlet yang ada jualan.
  let fcAll = null;
  if (session.isAdminUp && isPro() && !fc.error) {
    let ing = 0, sales = 0;
    for (const [id, v] of ingByOutlet) if (salesByOutlet.get(id)) { ing += v; sales += salesByOutlet.get(id); }
    const each = [...ingByOutlet].filter(([id]) => salesByOutlet.get(id)).map(([id, v]) => ({ id, pct: v / salesByOutlet.get(id) * 100 })).sort((x, y) => y.pct - x.pct);
    fcAll = { pct: sales ? ing / sales * 100 : null, worst: each.length > 1 ? each[0] : null };
  }
  const outlets = [...profitByOutlet].map(([id, p]) => ({ id, p })).sort((a, b) => b.p - a.p);

  return { today: all[7], yesterday: all[6], week: all.slice(1), tx: tx.error ? null : tx.data || [], stock: inv.error ? null : stock, fcAlerts, fcAll, outlets };
}

function attentionHTML(stock, fcAlerts) {
  if (stock === null) return `<li><span class="empty-row">${t('Could not load stock.')}</span></li>`;
  const STOCK_SHOWN = 5;
  const items = [
    ...fcAlerts.map(f => `<li><span class="alert-ic ${f.pct > 40 ? 'crit' : 'warn'}" aria-hidden="true">${icon('chart')}</span>
      <div style="min-width:0"><div class="t">${t('Food cost at {outlet}: {pct}%', { outlet: esc(outletName(f.id)), pct: f.pct.toFixed(1) })}</div><div class="m">${t('Above the {n}% guide, last 7 days', { n: FC_LIMIT })}</div></div>
      <a class="pill ${f.pct > 40 ? 'crit' : 'warn'}" href="#/foodcost">${t('Review')}</a></li>`),
    ...stock.slice(0, STOCK_SHOWN).map(x => `<li><span class="alert-ic ${x.st === 'habis' ? 'crit' : 'warn'}" aria-hidden="true">${icon('box')}</span>
      <div style="min-width:0"><div class="t">${esc(x.name)}</div><div class="m">${x.st === 'habis' ? t('Out of stock') : `${qty(x.current_qty)}${x.unit ? ' ' + esc(x.unit) : ''} ${t('left')}`} · ${t('target')} ${qty(x.target_qty)}${x.unit ? ' ' + esc(x.unit) : ''}${session.outletId === ALL_OUTLETS ? ' · ' + esc(outletName(x.outlet_id)) : ''}</div></div>
      <span class="pill ${x.st === 'habis' ? 'crit' : 'warn'}">${x.st === 'habis' ? t('Out') : t('Low')}</span></li>`)
  ];
  if (!items.length) return `<li><span class="empty-row">${t('All good. Nothing needs attention right now.')}</span></li>`;
  return items.join('');
}

function txHTML(tx) {
  if (tx === null) return `<li><span class="empty-row">${t('Could not load transactions.')}</span></li>`;
  if (!tx.length) return `<li><span class="empty-row">${t('No transactions yet today.')}</span></li>`;
  return tx.map(t => {
    const meta = [session.outletId === ALL_OUTLETS ? outletName(t.outlet_id) : '', timeOf(t.created_at), t.description ? t.category : ''].filter(Boolean).join(' · ');
    const inn = t.type === 'In';
    return `<li><div style="min-width:0"><div class="t">${esc(t.description || t.category)}</div><div class="m">${esc(meta)}</div></div>
      <div class="amt ${inn ? 'in' : ''}">${inn ? '+' : '−'}${esc(rm(Math.abs(Number(t.amount))))}</div></li>`;
  }).join('');
}

function outletHTML(outlets) {
  const max = Math.max(...outlets.map(o => Math.abs(o.p)), 1);
  return `<section class="panel">
    <div class="ph"><h2>${t('Profit by outlet')}</h2><span class="sub">${t('Today')}</span></div>
    <div class="h-outlets">${outlets.map((o, i) => `<div>
      <div class="h-o-top"><b>${esc(outletName(o.id))}</b><span class="${o.p < 0 ? 'neg' : ''}">${esc(rm(o.p))}</span></div>
      <div class="h-bar ${o.p < 0 ? 'neg' : i === outlets.length - 1 ? 'low' : ''}" role="img" aria-label="${esc(outletName(o.id))}: ${esc(rm(o.p))}"><i style="--w:${(Math.abs(o.p) / max * 100).toFixed(1)}%"></i></div>
    </div>`).join('')}</div>
    <div class="panel-foot"><span></span><a href="#/laporan">${t('Full report →')}</a></div>
  </section>`;
}

export default {
  async render(view) {
    view.innerHTML = `<div class="skel-home" aria-busy="true" aria-label="${t('Loading')}"><div class="skel hero-skel"></div><div class="skel"></div></div>`;
    let d;
    try { d = await load(); }
    catch {
      view.innerHTML = `<section class="card placeholder">${icon('chart')}<h2>${t('Could not load summary')}</h2>
        <p>${t('Check your internet connection and try again.')}</p><button class="btn primary" id="retry" type="button">${t('Try again')}</button></section>`;
      $('retry').onclick = () => this.render(view);
      return;
    }
    const { today, yesterday, week, tx, stock, fcAlerts, fcAll, outlets } = d;
    const attnCount = stock === null ? 0 : stock.length + fcAlerts.length;
    const margin = today.sales ? today.profit / today.sales * 100 : null;
    const avgBill = today.count ? today.sales / today.count : null;
    const fcLocked = session.isAdminUp && !isPro();
    const showFc = fcAll !== null || fcLocked;
    const C = 2 * Math.PI * 28;   // lilitan gelang food cost
    const fcPct = fcAll?.pct;

    view.innerHTML = `
      <div class="h-actions"><a class="btn primary" href="#/rekod">${icon('plus-box')}${t('Key in transaction')}</a></div>

      <section class="h-bento${showFc ? '' : ' no-fc'}" aria-label="${t('Today at a glance')}">
        <div class="h-tile h-hero">
          <div class="h-top">
            <div>
              <p class="h-lbl">${icon('chart')}${t('Net profit today')} <span class="info" title="${t('Sales + other income − operating expenses. Owner money, loans, tax and asset purchases are not included.')}">i</span></p>
              <p class="h-big ${today.profit < 0 ? 'neg' : ''}">${money(today.profit)}</p>
              <div class="h-meta">${badge(change(today.profit, yesterday.profit))}${yesterday.profit ? `<span>${t('vs yesterday ({amt})', { amt: esc(rm(yesterday.profit)) })}</span>` : ''}</div>
            </div>
            <div class="h-goal">
              <div class="h-goal-row"><span>${t('Profit margin')}</span><b>${margin === null ? '–' : margin.toFixed(1) + '%'}</b></div>
              <div class="h-bar ${margin !== null && margin < 0 ? 'neg' : margin !== null && margin < 15 ? 'low' : ''}" role="img" aria-label="${margin === null ? t('No sales yet today') : t('Profit margin {pct}% of sales', { pct: margin.toFixed(1) })}"><i style="--w:${margin === null ? 0 : Math.min(100, Math.abs(margin)).toFixed(1)}%"></i></div>
              <div class="h-goal-row"><span>${margin === null ? t('No sales yet today') : t('of every RM 1 sold')}</span><span class="num">${margin === null ? '' : 'RM ' + (Math.max(margin, 0) / 100).toFixed(2)}</span></div>
            </div>
          </div>
          <div class="h-chart">
            <div class="h-readout" aria-live="polite"><span id="hRoDay">${t('Last 7 days')}</span><b id="hRoVal">${esc(t('{amt} total', { amt: rm(week.reduce((s, w) => s + w.profit, 0)) }))}</b></div>
            ${chartHTML(week)}
          </div>
        </div>

        <a class="h-tile h-sales" href="#/laporan">
          <p class="h-lbl">${icon('download')}${t('Sales')}</p>
          <p class="h-val">${money(today.sales)}</p>
          <div class="h-foot">${badge(change(today.sales, yesterday.sales))}${mini(week.map(w => w.sales))}</div>
        </a>
        <a class="h-tile h-exp" href="#/laporan">
          <p class="h-lbl">${icon('receipt')}${t('Expenses')}</p>
          <p class="h-val">${money(today.out)}</p>
          <div class="h-foot">${badge(change(today.out, yesterday.out), false)}${mini(week.map(w => w.out), true)}</div>
        </a>
        <a class="h-tile h-tx" href="#/rekod?t=sejarah">
          <p class="h-lbl">${icon('history')}${t('Transactions')}</p>
          <p class="h-val"><span data-count="${today.count}" data-fmt="int">${today.count}</span></p>
          <div class="h-foot"><span class="chg flat">${today.count - yesterday.count >= 0 ? '+' : '−'}${Math.abs(today.count - yesterday.count)} ${t('vs yesterday')}</span>${mini(week.map(w => w.count))}</div>
          <p class="h-note">${t('Average bill')} <b>${avgBill === null ? '–' : esc(rm(avgBill))}</b></p>
        </a>
        ${fcLocked ? `<a class="h-tile h-fc h-locked" href="#/pakej">
          <p class="h-lbl">${icon('cart')}${t('Food cost · 7 days')}</p>
          <p class="h-note">${t('See your food cost % and which menu makes money.')}</p>
          <span class="chg flat" style="align-self:flex-start">${icon('lock')} ${t('Pro · RM {n}/month', { n: PLANS.pro.price })}</span>
        </a>` : showFc ? `<a class="h-tile h-fc" href="#/foodcost">
          <p class="h-lbl">${icon('cart')}${t('Food cost · 7 days')}</p>
          <div class="h-ring-row">
            <svg class="h-ring${fcPct > FC_LIMIT ? ' over' : ''}" viewBox="0 0 70 70" aria-hidden="true">
              <circle class="track" cx="35" cy="35" r="28"/>
              <circle class="prog" cx="35" cy="35" r="28" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" data-to="${fcPct == null ? C.toFixed(1) : (C * (1 - Math.min(fcPct, 100) / 100)).toFixed(1)}"/>
              <circle class="limit" cx="35" cy="35" r="28" stroke-dasharray="1.4 ${(C - 1.4).toFixed(1)}" stroke-dashoffset="${(-C * FC_LIMIT / 100).toFixed(1)}"/>
            </svg>
            <div class="h-ring-txt"><b class="num">${fcPct == null ? '–' : fcPct.toFixed(1) + '%'}</b><span>${t('Guide {n}%', { n: FC_LIMIT })}</span>
              ${fcPct == null ? `<span class="chg flat">${t('No data')}</span>` : fcPct > FC_LIMIT ? `<span class="chg bad">${t('Above guide')}</span>` : `<span class="chg good">${t('On track')}</span>`}</div>
          </div>
          ${fcAll.worst ? `<p class="h-note">${t('Highest:')} <b>${esc(outletName(fcAll.worst.id))} ${fcAll.worst.pct.toFixed(1)}%</b></p>` : ''}
        </a>` : ''}
      </section>

      <div class="home-grid">
        <div class="h-col">
        <section class="panel">
          <div class="ph"><h2>${t('Needs attention')}</h2><span class="sub">${attnCount ? t('{n} items', { n: attnCount }) : ''}</span></div>
          <ul class="rows alerts">${attentionHTML(stock, fcAlerts)}</ul>
          ${stock && stock.length ? `<div class="panel-foot"><span>${t('{n} stock items to restock', { n: stock.length })}</span><a href="#/stok">${t('Open Stock →')}</a></div>` : ''}
        </section>
        ${session.outletId === ALL_OUTLETS && outlets.length > 1 ? outletHTML(outlets) : ''}
        </div>

        <section class="panel">
          <div class="ph"><h2>${t('Recent transactions')}</h2><span class="sub">${t('Today')}</span></div>
          <ul class="rows">${txHTML(tx)}</ul>
          <div class="panel-foot"><span>${tx && tx.length ? t('{a} of {b} today', { a: tx.length, b: today.count }) : ''}</span><a href="#/rekod?t=sejarah">${t('View all →')}</a></div>
        </section>
      </div>

      <nav class="quick" aria-label="${t('Shortcuts')}">
        <a href="#/laporan">${icon('chart')}${t('Full report')}</a>
        ${session.isAdminUp ? `<a href="#/pnl">${icon('receipt')}${t('Profit &amp; Loss (Form B)')}</a><a href="#/foodcost">${icon('cart')}${t('Food Cost')}</a>` : ''}
        <a href="#/rekod?t=sejarah">${icon('history')}${t('Transaction history')}</a>
      </nav>`;

    countUp(view);
    wireChart(view, week);
    requestAnimationFrame(() => view.querySelectorAll('.h-ring .prog').forEach(c => c.setAttribute('stroke-dashoffset', c.dataset.to)));
  }
};
