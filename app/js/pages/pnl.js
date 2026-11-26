// Penyata Untung Rugi setahun (1 Jan – 31 Dis) bagi SATU bisnes (outlet = entiti berdaftar),
// disusun ikut baris "Maklumat Kewangan" Borang B LHDN supaya pemilik boleh salin terus.
// Owner pilih bisnes; admin (pemilik bisnes) nampak bisnes sendiri sahaja (dikunci di database).
import { $, esc, icon, toast, loadJsPdf, pdfText } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName, outletCompany } from '../session.js';
import { rm, todayKL, MONTHS } from '../format.js';
import { isPro, lockCard } from '../plan.js';
import { t, locale, getLang } from '../i18n.js';

const PAGE = 1000;

// Baris penyata: [English, istilah Borang B]
const LINE = {
  sales:       ['Sales / turnover', 'Jualan / perolehan'],
  openStock:   ['Opening stock', 'Stok pembukaan'],
  purchases:   ['Purchases and cost of production', 'Belian dan kos pengeluaran'],
  closeStock:  ['Closing stock', 'Stok penutup'],
  cos:         ['Cost of sales', 'Kos jualan'],
  gross:       ['Gross profit / (loss)', 'Untung / (rugi) kasar'],
  otherIncome: ['Other business income', 'Pendapatan lain'],
  interest:    ['Loan interest', 'Faedah pinjaman'],
  wages:       ['Salaries, wages and staff costs', 'Gaji, upah dan kos pekerja'],
  rent:        ['Rent', 'Sewa / pajakan'],
  travel:      ['Travel and transport', 'Perjalanan dan pengangkutan'],
  repairs:     ['Repairs and maintenance', 'Pembaikan dan penyelenggaraan'],
  promo:       ['Promotion and advertising', 'Promosi dan iklan'],
  otherExp:    ['Other expenses', 'Perbelanjaan lain'],
  totalExp:    ['Total expenses', 'Jumlah perbelanjaan'],
  net:         ['Net profit / (loss)', 'Untung / (rugi) bersih'],
  // Bukan dalam untung rugi
  capitalIn:   ['Owner money added', 'Modal tambahan'],
  drawings:    ['Owner money taken', 'Ambilan pemilik'],
  loanIn:      ['Loans received', 'Pinjaman diterima'],
  loanOut:     ['Loan principal repaid', 'Bayaran balik pokok pinjaman'],
  assets:      ['Asset & equipment purchases', 'Belian aset (untuk elaun modal)'],
  tax:         ['Income tax paid', 'Cukai pendapatan dibayar']
};
const EXP_LINES = ['interest', 'wages', 'rent', 'travel', 'repairs', 'promo', 'otherExp'];
const OFF_PNL = ['capitalIn', 'drawings', 'loanIn', 'loanOut', 'assets', 'tax'];

// Kategori (ikut kunci tetap) → baris Borang B.
const KEY_LINE = {
  IN01: 'sales', IN02: 'sales', IN03: 'sales', IN04: 'otherIncome', IN05: 'capitalIn', IN06: 'loanIn',
  OUT01: 'purchases', OUT02: 'otherExp', OUT03: 'purchases', OUT04: 'rent', OUT05: 'otherExp', OUT06: 'wages',
  OUT07: 'wages', OUT08: 'otherExp', OUT09: 'travel', OUT10: 'promo', OUT11: 'otherExp', OUT12: 'repairs',
  OUT13: 'otherExp', OUT14: 'otherExp', OUT15: 'interest', OUT16: 'otherExp', OUT17: 'drawings', OUT18: 'loanOut',
  OUT19: 'tax', OUT20: 'assets'
};
// Kategori baharu tanpa kunci dikenali: ikut bendera kategori.
function lineFor(cat, type) {
  if (cat && KEY_LINE[cat.key]) return KEY_LINE[cat.key];
  if (type === 'In') return cat?.is_sales ? 'sales' : cat?.counts_in_profit === false ? 'capitalIn' : 'otherIncome';
  return cat?.counts_in_profit === false ? 'drawings' : 'otherExp';
}

const state = { year: null, outlet: null };
let version = 0;
let lastData = null;   // untuk PDF

const sen = n => Math.round(Number(n) * 100);
const money = c => rm(c / 100);
const paren = c => (c < 0 ? `(${rm(-c / 100).replace('RM ', '')})` : rm(c / 100).replace('RM ', ''));

async function load(outletId, year) {
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const tx = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb.from('transactions').select('id,transaction_date,type,category,amount')
      .eq('outlet_id', outletId).gte('transaction_date', from).lte('transaction_date', to)
      .order('id').range(offset, offset + PAGE - 1);
    if (error) throw error;
    tx.push(...data);
    if (data.length < PAGE) break;
  }
  const [{ data: cats, error: ce }, { data: first }] = await Promise.all([
    sb.from('categories').select('key,name,type,counts_in_profit,is_sales'),
    sb.from('transactions').select('transaction_date').eq('outlet_id', outletId).order('transaction_date').limit(1)
  ]);
  if (ce) throw ce;
  return { tx, cats: new Map((cats || []).map(c => [c.type + '|' + c.name, c])), firstDate: first?.[0]?.transaction_date || null };
}

function compute({ tx, cats }) {
  const lines = Object.fromEntries(Object.keys(LINE).map(k => [k, { total: 0, cats: new Map() }]));
  const months = Array.from({ length: 12 }, () => ({ income: 0, exp: 0, count: 0 }));
  for (const tr of tx) {
    const k = lineFor(cats.get(tr.type + '|' + tr.category), tr.type);
    const a = sen(tr.amount);
    lines[k].total += a;
    lines[k].cats.set(tr.category, (lines[k].cats.get(tr.category) || 0) + a);
    const m = months[Number(tr.transaction_date.slice(5, 7)) - 1];
    m.count++;
    if (k === 'sales' || k === 'otherIncome') m.income += a;
    else if (k === 'purchases' || EXP_LINES.includes(k)) m.exp += a;
  }
  const v = k => lines[k].total;
  const cos = v('purchases');                 // stok pembukaan & penutup belum dijejak (anggap 0)
  const gross = v('sales') - cos;
  const totalExp = EXP_LINES.reduce((s, k) => s + v(k), 0);
  const net = gross + v('otherIncome') - totalExp;
  return { lines, months, cos, gross, totalExp, net };
}

function lineRow(key, amount, { cats, strong, note, cls = '' } = {}) {
  const [en, ms] = LINE[key];
  const [main, sub] = getLang() === 'ms' ? [ms, en] : [en, ms];   // BM: label Melayu di atas
  const detail = cats && cats.size > 1
    ? `<details class="pl-cats"><summary>${t('{n} categories', { n: cats.size })}</summary>${[...cats].sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `<div><span>${esc(n)}</span><b>${esc(money(c))}</b></div>`).join('')}</details>`
    : cats && cats.size === 1 ? `<div class="pl-one">${esc([...cats.keys()][0])}</div>` : '';
  return `<div class="pl-row ${strong ? 'strong' : ''} ${cls}">
    <div class="pl-lbl"><span>${esc(main)}</span><small>${esc(sub)}</small>${detail}${note ? `<p class="pl-note">${t(note)}</p>` : ''}</div>
    <b class="pl-amt ${amount < 0 ? 'neg' : ''}">${amount == null ? '—' : esc(paren(amount))}</b></div>`;
}

function statementHTML(d, r, year, today) {
  const L = r.lines;
  const assetsNote = L.assets.total ? ' ' + t('Asset purchases this year: <b>{a}</b>.', { a: esc(money(L.assets.total)) }) : '';
  const warn = [];
  if (!d.firstDate || d.firstDate > `${year}-12-31`) warn.push(t('No records for {y}.', { y: year }));
  else if (d.firstDate > `${year}-01-01`) {
    warn.push(t('Records for this business start on <b>{d}</b>. Anything before that date is not in this statement. Key in the earlier months for a full-year figure.', { d: esc(new Date(d.firstDate + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })) }));
  }
  if (year === Number(today.slice(0, 4))) warn.push(t('{y} is not finished. Figures are up to today.', { y: year }));
  const emptyMonths = r.months.map((m, i) => (m.count ? null : MONTHS[i])).filter(Boolean)
    .filter((_, i, arr) => arr.length < 12);
  const lastMonth = year === Number(today.slice(0, 4)) ? Number(today.slice(5, 7)) : 12;

  return `
    ${warn.length ? `<div class="alert">${warn.map(w => `<p>${w}</p>`).join('')}</div>` : ''}

    <section class="panel pl">
      <div class="ph"><div><h2>${t('Profit &amp; loss statement')}</h2><div class="sub">${t('Penyata untung rugi · 1 Jan – 31 Dec {y}', { y: year })}</div></div></div>
      <div class="pl-body">
        <p class="pl-sec">${getLang() === 'ms' ? 'Akaun perdagangan · Trading account' : 'Trading account · Akaun perdagangan'}</p>
        ${lineRow('sales', L.sales.total, { cats: L.sales.cats })}
        ${lineRow('openStock', null, { note: 'Not tracked in the app yet. Use your stock count value on 1 Jan.' })}
        ${lineRow('purchases', L.purchases.total, { cats: L.purchases.cats })}
        ${lineRow('closeStock', null, { note: 'Not tracked yet. Count stock on 31 Dec and value it at cost.' })}
        ${lineRow('cos', r.cos, { strong: true, note: 'Shown without stock changes. Cost of sales = opening stock + purchases − closing stock.' })}
        ${lineRow('gross', r.gross, { strong: true, cls: 'sum' })}

        <p class="pl-sec">${getLang() === 'ms' ? 'Pendapatan &amp; perbelanjaan · Income &amp; expenses' : 'Income &amp; expenses · Pendapatan &amp; perbelanjaan'}</p>
        ${lineRow('otherIncome', L.otherIncome.total, { cats: L.otherIncome.cats })}
        ${EXP_LINES.map(k => lineRow(k, L[k].total, { cats: L[k].cats })).join('')}
        ${lineRow('totalExp', r.totalExp, { strong: true })}
        ${lineRow('net', r.net, { strong: true, cls: 'total' })}
      </div>
      <p class="note-line">${icon('lock')}${t('Before stock adjustments and tax adjustments. Check every line against the latest Form B before filing.')}</p>
    </section>

    <div class="rep-grid-2">
      <section class="panel">
        <div class="ph"><h2>${t('Towards taxable income (HK-1)')}</h2></div>
        <div class="pl-body">
          ${lineRow('net', r.net, { strong: true })}
          <div class="pl-row"><div class="pl-lbl"><span>${t('+ Non-allowable expenses')}</span><small>${getLang() === 'ms' ? '+ Non-allowable expenses' : 'Perbelanjaan tidak dibenarkan'}</small>
            <p class="pl-note">${t('Private spending recorded as business costs, fines, half of entertainment, and similar. Decide these with your tax agent.')}</p></div><b class="pl-amt">—</b></div>
          <div class="pl-row"><div class="pl-lbl"><span>${t('− Capital allowance')}</span><small>${getLang() === 'ms' ? '− Capital allowance (HK-1.2)' : 'Elaun modal (HK-1.2)'}</small>
            <p class="pl-note">${t('Replaces depreciation for equipment, furniture, vehicles.')}${assetsNote}</p></div><b class="pl-amt">—</b></div>
        </div>
        <p class="note-line">${icon('lock')}${t('Owner money, loans, income tax and asset purchases are already left out of profit.')}</p>
      </section>

      <section class="panel">
        <div class="ph"><h2>${t('Not in profit &amp; loss')}</h2><span class="sub">${t('For the capital account')}</span></div>
        <div class="pl-body">
          ${OFF_PNL.map(k => lineRow(k, L[k].total)).join('')}
        </div>
      </section>
    </div>

    <section class="panel">
      <div class="ph"><h2>${t('By month')}</h2><span class="sub">${t('Spot months with missing records')}</span></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>${t('Month')}</th><th>${t('Income')}</th><th>${t('Costs')}</th><th>${t('Profit')}</th><th>${t('Records')}</th></tr></thead>
        <tbody>${r.months.map((m, i) => {
          if (i + 1 > lastMonth) return '';
          const p = m.income - m.exp;
          return `<tr class="${m.count ? '' : 'empty-m'}"><td>${MONTHS[i]}</td><td>${m.count ? esc(paren(m.income)) : '—'}</td><td>${m.count ? esc(paren(m.exp)) : '—'}</td>
            <td class="${p < 0 ? 'n' : 'p'}">${m.count ? esc(paren(p)) : '—'}</td><td>${m.count || `<span class="pill warn">${t('none')}</span>`}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${emptyMonths.length ? `<p class="note-line">${icon('lock')}${t('Months without records:')} ${esc(emptyMonths.filter(mm => MONTHS.indexOf(mm) < lastMonth).join(', '))}.</p>` : ''}
    </section>`;
}

/* ---------- PDF (A4) ---------- */
async function makePdf() {
  if (!lastData) return;
  let JsPDF;
  try { JsPDF = await loadJsPdf(); }
  catch { toast(t('Could not create the PDF. Check your internet connection.'), 'error'); return; }
  const { r, year, outletId, partial } = lastData;
  const co = outletCompany(outletId);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 18, R = W - M;
  const GREEN = [17, 90, 55], INK = [22, 28, 25], GREY = [100, 110, 105], LINEC = [214, 221, 217];
  const color = c => doc.setTextColor(...c);

  color(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(pdfText(co.name), M, 20, { maxWidth: R - M });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); color(GREY);
  doc.text(pdfText([co.regNo, outletName(outletId)].filter(Boolean).join('  ·  ')), M, 25.5);
  color(GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('PROFIT & LOSS STATEMENT  /  PENYATA UNTUNG RUGI', M, 36);
  color(INK); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(t('For the year 1 January - 31 December {y}', { y: year }), M, 42);
  doc.setDrawColor(...GREEN); doc.setLineWidth(0.7); doc.line(M, 46, R, 46);

  let y = 54;
  const row = (key, amt, opt = {}) => {
    const [en, ms] = LINE[key];
    doc.setFont('helvetica', opt.bold ? 'bold' : 'normal'); doc.setFontSize(10); color(INK);
    doc.text(pdfText(en), M + (opt.indent ? 4 : 0), y);
    doc.text(amt == null ? '-' : pdfText(paren(amt)), R, y, { align: 'right' });
    doc.setFont('helvetica', 'italic'); doc.setFontSize(8); color(GREY);
    doc.text(pdfText(ms), M + (opt.indent ? 4 : 0), y + 4);
    y += opt.gapAfter || 10;
    if (opt.rule) { doc.setDrawColor(...LINEC); doc.setLineWidth(0.3); doc.line(M, y - 4.5, R, y - 4.5); y += 2; }
  };
  const head = label => { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); color(GREEN); doc.text(pdfText(t(label)).toUpperCase(), M, y); y += 7; };

  head('Trading account');
  row('sales', r.lines.sales.total, { indent: true });
  row('openStock', null, { indent: true });
  row('purchases', r.lines.purchases.total, { indent: true });
  row('closeStock', null, { indent: true });
  row('cos', r.cos, { bold: true });
  row('gross', r.gross, { bold: true, rule: true });
  head('Income and expenses');
  row('otherIncome', r.lines.otherIncome.total, { indent: true });
  EXP_LINES.forEach(k => row(k, r.lines[k].total, { indent: true, gapAfter: 9.5 }));
  row('totalExp', r.totalExp, { bold: true, rule: true });
  doc.setFillColor(230, 245, 236); doc.rect(M - 2, y - 6, R - M + 4, 12, 'F');
  row('net', r.net, { bold: true, gapAfter: 14 });

  const footer = () => {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); color(GREY);
    doc.text(t('Generated by BizProfit Pro · ') + new Date().toLocaleString(locale()), W / 2, 289, { align: 'center' });
  };
  if (y + 8 + OFF_PNL.length * 9 > 278) { footer(); doc.addPage(); y = 22; }
  head('Not in profit and loss');
  OFF_PNL.forEach(k => row(k, r.lines[k].total, { indent: true, gapAfter: 9 }));

  const notes = [
    t('Opening and closing stock are not tracked in the app: cost of sales is shown before stock changes.'),
    t('Before tax adjustments (non-allowable expenses, capital allowance). Check every line against the latest Form B.'),
    partial ? t('Records for part of this year are missing; see the app for details.') : ''
  ].filter(Boolean);
  if (y + 6 + notes.length * 4.4 > 282) { footer(); doc.addPage(); y = 20; } else { y += 4; }
  doc.setDrawColor(...LINEC); doc.setLineWidth(0.3); doc.line(M, y - 4, R, y - 4);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); color(GREY);
  notes.forEach(n => { doc.text(pdfText('- ' + n), M, y, { maxWidth: R - M }); y += 4.4; });
  footer();

  const name = `PnL_${co.name}_${year}.pdf`.replace(/[^\w.-]+/g, '_');
  const file = new File([doc.output('blob')], name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(t('PDF downloaded. Check your Downloads folder.'));
}

export default {
  render(view) {
    if (!isPro()) { view.innerHTML = lockCard('Profit & Loss (Form B)', 'Get a yearly profit and loss statement laid out like LHDN Form B, ready as PDF for your tax filing.'); return; }
    const today = todayKL();
    const thisYear = Number(today.slice(0, 4));
    state.year = state.year || thisYear;
    const all = session.outletId === ALL_OUTLETS;
    if (!all) state.outlet = session.outletId;
    else if (!session.outlets.some(o => o.id === state.outlet)) state.outlet = session.outlets[0]?.id;

    view.innerHTML = `
      <div class="rep-controls">
        ${all ? `<div class="seg" role="group" aria-label="${t('Business')}">${session.outlets.map(o =>
          `<button class="seg-opt" type="button" data-outlet="${esc(o.id)}">${esc(o.name)}</button>`).join('')}</div>` : ''}
        <div class="datenav">
          <button type="button" id="plPrev" aria-label="${t('Previous year')}">‹</button>
          <label><span id="plYear"></span></label>
          <button type="button" id="plNext" aria-label="${t('Next year')}">›</button>
        </div>
        <button class="share-btn" type="button" id="plPdf">${icon('download')}PDF</button>
      </div>
      <div class="pl-entity" id="plEntity"></div>
      <div id="plBody" class="stack"><p class="loading-line">${t('Loading…')}</p></div>`;

    async function show() {
      const v = ++version;
      lastData = null;
      view.querySelectorAll('[data-outlet]').forEach(b => {
        b.classList.toggle('on', b.dataset.outlet === state.outlet);
        b.setAttribute('aria-pressed', String(b.dataset.outlet === state.outlet));
      });
      $('plYear').textContent = String(state.year);
      $('plNext').disabled = state.year >= thisYear;
      const co = outletCompany(state.outlet);
      $('plEntity').innerHTML = `<b>${esc(co.name)}</b>${co.regNo ? `<span>${esc(co.regNo)}</span>` : ''}`;
      $('plBody').innerHTML = `<p class="loading-line">${t('Loading…')}</p>`;
      let d;
      try { d = await load(state.outlet, state.year); }
      catch {
        if (v !== version) return;
        $('plBody').innerHTML = `<section class="card placeholder"><h2>${t('Could not load the statement')}</h2><p>${t('Check your internet and try again.')}</p></section>`;
        return;
      }
      if (v !== version) return;
      const r = compute(d);
      $('plBody').innerHTML = statementHTML(d, r, state.year, today);
      lastData = { r, year: state.year, outletId: state.outlet, partial: !d.firstDate || d.firstDate > `${state.year}-01-01` };
    }

    view.querySelectorAll('[data-outlet]').forEach(b => b.addEventListener('click', () => { state.outlet = b.dataset.outlet; show(); }));
    $('plPrev').addEventListener('click', () => { state.year--; show(); });
    $('plNext').addEventListener('click', () => { if (state.year < thisYear) { state.year++; show(); } });
    $('plPdf').addEventListener('click', () => { if (!lastData) { toast(t('Statement is still loading.')); return; } makePdf(); });
    show();
    return () => { version++; };
  }
};
