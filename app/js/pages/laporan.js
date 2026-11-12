// Laporan ikut tempoh: Harian, Mingguan, Bulanan, Tahunan. Owner & manager sahaja.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, addDays, endOfMonth, MONTHS, dateRange } from '../format.js';

const PERIODS = { harian: 'Harian', mingguan: 'Mingguan', bulanan: 'Bulanan', tahunan: 'Tahunan' };
const TITLE = { harian: 'Laporan harian', mingguan: 'Laporan mingguan', bulanan: 'Laporan bulanan', tahunan: 'Laporan tahunan' };
const PAGE = 1000;

// Kekal semasa tukar halaman/outlet.
const state = { period: 'harian', date: null, year: null };
let version = 0;

function buildPeriod(period, date, year) {
  let from = date, to = date, groups = [];
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

async function fetchRows(from, to) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = sb.from('daily_summary')
      .select('transaction_date,outlet_id,money_in,money_out,profit,bil_transaksi,sales')
      .gte('transaction_date', from).lte('transaction_date', to)
      .order('transaction_date').order('outlet_id')
      .range(offset, offset + PAGE - 1);
    if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

// Jumlah dalam sen supaya tiada ralat pecahan.
function totals(rows) {
  const s = k => rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0);
  return { sales: s('sales'), moneyIn: s('money_in'), out: s('money_out'), profit: s('profit'),
    count: rows.reduce((t, r) => t + Number(r.bil_transaksi), 0) };
}

function chartHTML(groups, rows) {
  const vals = groups.map(g => {
    const t = totals(rows.filter(r => r.transaction_date >= g.from && r.transaction_date <= g.to));
    return { ...g, inn: t.moneyIn, out: t.out };
  });
  const max = Math.max(1, ...vals.flatMap(v => [v.inn, v.out]));
  return {
    max,
    html: vals.map((v, i) => {
      const text = `${dateRange(v.from, v.to)} · Masuk ${rm(v.inn / 100)} · Keluar ${rm(v.out / 100)}`;
      return `<button class="bar-group" type="button" data-i="${i}" data-text="${esc(text)}" aria-label="${esc(text)}">
        <span class="bars" aria-hidden="true"><span class="bar in" style="height:${v.inn / max * 100}%"></span><span class="bar out" style="height:${v.out / max * 100}%"></span></span>
        <span class="bar-label">${esc(v.label)}</span></button>`;
    }).join('')
  };
}

export default {
  subtitle: 'Laporan harian, mingguan, bulanan dan tahunan.',
  render(view) {
    const today = todayKL();
    state.date = state.date || today;
    state.year = state.year || today.slice(0, 4);

    view.innerHTML = `
      <section class="card stack">
        <div class="seg four" role="group" aria-label="Tempoh laporan">
          ${Object.entries(PERIODS).map(([k, v]) => `<button class="seg-opt ${state.period === k ? 'on' : ''}" type="button" data-period="${k}" aria-pressed="${state.period === k}">${v}</button>`).join('')}
        </div>
        <label class="field" id="dateWrap">Pilih tarikh<input id="repDate" type="date" min="2000-01-01" max="2100-12-31"></label>
        <form class="field" id="yearWrap" novalidate>Pilih tahun
          <span class="two"><input id="repYear" type="number" inputmode="numeric" min="2000" max="2100"><button class="btn ghost" type="submit">Papar</button></span>
        </form>
      </section>
      <section class="card receipt" id="repCard"><p class="greet-sub">Memuatkan…</p></section>
      <section class="card">
        <div class="trend-head"><h2>Masuk &amp; keluar</h2><span class="legend"><i class="in"></i>Masuk <i class="out"></i>Keluar</span></div>
        <div class="bar-chart" id="repChart"></div>
        <p class="note-line small" id="repDetail" role="status"></p>
      </section>`;

    $('repDate').value = state.date;
    $('repYear').value = state.year;
    const syncControls = () => {
      $('dateWrap').hidden = state.period === 'tahunan';
      $('yearWrap').hidden = state.period !== 'tahunan';
      $('dateWrap').firstChild.textContent = { harian: 'Pilih tarikh', mingguan: 'Pilih tarikh dalam minggu', bulanan: 'Pilih tarikh dalam bulan' }[state.period] || 'Pilih tarikh';
      view.querySelectorAll('[data-period]').forEach(b => {
        b.classList.toggle('on', b.dataset.period === state.period);
        b.setAttribute('aria-pressed', String(b.dataset.period === state.period));
      });
    };

    async function show() {
      const v = ++version;
      const { from, to, groups } = buildPeriod(state.period, state.date, state.year);
      $('repCard').innerHTML = '<p class="greet-sub">Memuatkan…</p>';
      $('repChart').innerHTML = ''; $('repDetail').textContent = '';
      let rows;
      try { rows = await fetchRows(groups[0].from < from ? groups[0].from : from, to); }
      catch {
        if (v !== version) return;
        $('repCard').innerHTML = '<p class="greet-sub">Laporan tak dapat dimuatkan. Semak internet dan cuba lagi.</p>'; return;
      }
      if (v !== version) return;   // pengguna dah tukar tempoh

      const inRange = rows.filter(r => r.transaction_date >= from && r.transaction_date <= to);
      const t = totals(inRange);
      const other = t.moneyIn - t.sales;
      const title = state.period === 'harian' && state.date === today ? 'Laporan hari ini' : TITLE[state.period];

      const perOutlet = new Map();
      inRange.forEach(r => perOutlet.set(r.outlet_id, (perOutlet.get(r.outlet_id) || 0) + Math.round(Number(r.profit) * 100)));
      const breakdown = session.outletId === ALL_OUTLETS && perOutlet.size > 1
        ? `<details class="breakdown"><summary>Pecahan untung ikut outlet</summary>${[...perOutlet]
            .sort((a, b) => outletName(a[0]).localeCompare(outletName(b[0]), 'ms-MY'))
            .map(([id, c]) => `<div class="kv"><span>${esc(outletName(id))}</span><b class="${c < 0 ? 'neg' : ''}">${rm(c / 100)}</b></div>`).join('')}</details>` : '';

      $('repCard').innerHTML = `
        <p class="overline">${icon('receipt')}Ringkasan untung</p>
        <h2>${esc(title)}</h2>
        <p class="greet-sub">${esc(dateRange(from, to))} · ${esc(outletName())}</p>
        <div class="kv-list">
          <div class="kv"><span>Jualan</span><b>${rm(t.sales / 100)}</b></div>
          <div class="kv"><span>Pendapatan lain</span><b>${rm(other / 100)}</b></div>
          <div class="kv"><span>Perbelanjaan</span><b class="neg">${rm(t.out / 100)}</b></div>
        </div>
        <div class="kv total"><span>Untung</span><b class="${t.profit < 0 ? 'neg' : 'pos'}">${rm(t.profit / 100)}</b></div>
        <p class="greet-sub right">${t.count} transaksi</p>
        ${breakdown}
        <p class="note-line small">${icon('lock')}Duit owner, pinjaman, cukai dan beli aset tidak dikira dalam untung.</p>`;

      if (!rows.length) { $('repDetail').textContent = 'Tiada transaksi untuk tempoh ini.'; return; }
      const chart = chartHTML(groups, rows);
      $('repChart').style.setProperty('--groups', groups.length);
      $('repChart').innerHTML = chart.html;
      const pick = btn => {
        $('repChart').querySelectorAll('.bar-group').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        $('repDetail').textContent = btn.dataset.text;
      };
      $('repChart').onclick = e => { const b = e.target.closest('.bar-group'); if (b) pick(b); };
      // Bar mana dipilih dahulu: tarikh dipilih; untuk Tahunan, bulan ini (tahun semasa)
      // atau bulan terakhir yang ada data (tahun lain), bukan Disember yang mungkin kosong.
      let focus;
      if (state.period === 'tahunan') {
        const hasData = g => rows.some(r => r.transaction_date >= g.from && r.transaction_date <= g.to);
        focus = state.year === today.slice(0, 4) ? Number(today.slice(5, 7)) - 1
          : groups.reduce((last, g, i) => (hasData(g) ? i : last), groups.length - 1);
      } else {
        focus = groups.findIndex(g => state.date >= g.from && state.date <= g.to);
        if (focus < 0) focus = groups.length - 1;
      }
      pick($('repChart').children[focus]);
    }

    view.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => {
      state.period = b.dataset.period; syncControls(); show();
    }));
    $('repDate').addEventListener('change', e => { if (e.target.value) { state.date = e.target.value; show(); } });
    $('yearWrap').addEventListener('submit', async e => {
      e.preventDefault();
      const y = Number($('repYear').value);
      if (!(y >= 2000 && y <= 2100)) { toast('Masukkan tahun antara 2000 dan 2100.', 'error'); $('repYear').focus(); return; }
      $('repYear').blur();                       // tutup papan kekunci phone
      const btn = e.submitter || $('yearWrap').querySelector('button');
      btn.disabled = true; btn.textContent = 'Memuatkan…';
      state.year = String(y);
      await show();
      btn.disabled = false; btn.textContent = 'Papar';
    });
    syncControls();
    show();
    return () => { version++; };
  }
};
