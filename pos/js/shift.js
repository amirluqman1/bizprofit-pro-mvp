// Shift POS (Fasa 23): buka/tutup kedai, duit modal laci, cash in/out, ringkasan & laporan cetak.
// Semua angka dikira oleh DATABASE (pos_shift_summary / pos_close_shift). Tutup shift = kiraan "buta":
// staf masukkan duit dikira dahulu; jumlah jangkaan hanya dipulangkan selepas tutup (owner/admin nampak lebih awal).
import { $, esc, toast } from '../../app/js/ui.js';
import { sb, session } from '../../app/js/session.js';
import { rm } from '../../app/js/format.js';
import { t, locale } from '../../app/js/i18n.js';
import * as printer from './printer.js';

let ctx = null;            // { st, onChange }
let outCats = null;        // kategori belanja untuk cash out
let lastSummary = null;
const errText = e => e?.message || t('Unknown error.');
const time = iso => iso ? new Date(iso).toLocaleTimeString(locale(), { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }) : '';
const dateTime = iso => iso ? new Date(iso).toLocaleString(locale(), { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const money = v => rm(Number(v || 0));
const todayKL = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });

// ================= Muat =================
// st.shift = shift dibuka (atau null). st.shiftReady = false jika Fasa 23 belum dijalankan (POS jalan tanpa shift).
export async function loadShift() {
  const st = ctx.st;
  const { data, error } = await sb.from('pos_shifts').select('id,opened_at,opening_float,opened_by')
    .eq('outlet_id', st.outletId).is('closed_at', null).maybeSingle();
  st.shiftReady = !error;
  st.shift = error ? null : data;
  paint();
  if (needsShift()) prefillFloat();
  return st.shift;
}

export function needsShift() { return ctx.st.shiftReady && !ctx.st.shift; }

function paint() {
  const st = ctx.st;
  $('shiftBtn').hidden = !st.shiftReady;
  $('shiftBtn').classList.toggle('ok', !!st.shift);
  $('shiftLabel').textContent = st.shift ? t('Shift · {x}', { x: time(st.shift.opened_at) }) : t('Shop closed');
  $('shiftGate').hidden = !needsShift() || st.view !== 'order';
  ctx.onChange?.();
}

// ================= Buka shift =================
async function prefillFloat() {
  const { data } = await sb.from('pos_shifts').select('counted_cash,closed_at').eq('outlet_id', ctx.st.outletId)
    .not('closed_at', 'is', null).order('closed_at', { ascending: false }).limit(1).maybeSingle();
  $('gateFloat').value = data ? Number(data.counted_cash).toFixed(2) : '';
  $('gateLast').textContent = data ? t('Last shift closed with {x} in the drawer.', { x: money(data.counted_cash) }) : '';
}
async function openShift() {
  const raw = $('gateFloat').value.trim(), amt = Number(raw);
  if (raw === '' || !(amt >= 0)) { toast(t('Enter the cash in the drawer now (RM 0 or more).'), 'error'); return; }
  $('gateOpen').disabled = true;
  const { error } = await sb.rpc('pos_open_shift', { p_outlet: ctx.st.outletId, p_float: amt });
  $('gateOpen').disabled = false;
  if (error) { toast(errText(error), 'error'); await loadShift(); return; }
  toast(t('Shift opened. The shop is open.'));
  await loadShift();
}

// ================= Dialog shift =================
export async function openShiftDialog() {
  const st = ctx.st;
  if (!st.shift) { await loadShift(); if (!st.shift) { showGate(); return; } }
  $('shiftBody').innerHTML = `<div class="empty">${t('Loading…')}</div>`;
  $('shiftDialog').showModal();
  await refreshShiftDialog();
}
async function refreshShiftDialog() {
  const st = ctx.st;
  const [{ data: sum, error }, { data: moves }] = await Promise.all([
    sb.rpc('pos_shift_summary', { p_shift: st.shift.id }),
    sb.from('pos_shift_moves').select('kind,amount,reason,category,created_at').eq('shift_id', st.shift.id).order('created_at')]);
  if (error) { $('shiftBody').innerHTML = `<div class="empty">${esc(errText(error))}</div>`; return; }
  lastSummary = sum;
  $('shiftBody').innerHTML = summaryHTML(sum, moves || []);
}

function summaryHTML(s, moves) {
  const row = (k, v, cls = '') => `<div class="kv ${cls}"><span>${k}</span><b>${v}</b></div>`;
  const methods = Object.entries(s.by_method || {});
  return `
    <p class="muted small">${t('Opened {t} by {w}', { t: dateTime(s.opened_at), w: esc(s.opened_by || '-') })}${s.closed_at ? ' · ' + t('Closed {t} by {w}', { t: dateTime(s.closed_at), w: esc(s.closed_by || '-') }) : ''}</p>
    <div class="summary">
      <div><b>${money(s.sales_total)}</b><span>${t('{n} paid orders', { n: s.orders_count || 0 })}</span></div>
      ${methods.map(([m, v]) => `<div><b>${money(v)}</b><span>${esc(m)}</span></div>`).join('')}
    </div>
    <div class="kv-list">
      ${row(t('Opening cash'), money(s.opening_float))}
      ${row(t('Cash sales'), '+' + money(s.cash_sales))}
      ${Number(s.cash_refunds) ? row(t('Cash refunds (cancelled orders)'), '−' + money(s.cash_refunds)) : ''}
      ${row(t('Cash in'), '+' + money(s.cash_in))}
      ${row(t('Cash out'), '−' + money(s.cash_out))}
      ${s.show_expected ? row(t('Expected in drawer'), money(s.expected_cash), 'total') : `<p class="muted small">${t('The expected amount is shown after the shift is closed (count the drawer first).')}</p>`}
      ${s.counted_cash != null ? row(t('Counted'), money(s.counted_cash)) + row(t('Difference'), (Number(s.difference) > 0 ? '+' : '') + money(s.difference), Number(s.difference) < 0 ? 'neg' : Number(s.difference) > 0 ? 'pos' : '') : ''}
    </div>
    ${s.open_bills ? `<p class="warn small">${t('{n} open bills not paid yet. They will be counted in the shift when they are paid.', { n: s.open_bills })}</p>` : ''}
    ${moves.length ? `<h3 class="sub-h">${t('Cash in / out')}</h3>${moves.map(m => `<div class="kv small"><span>${time(m.created_at)} · ${esc(m.reason)}${m.category ? ' · ' + esc(m.category) : ''}</span>
      <b class="${m.kind === 'keluar' ? 'neg' : 'pos'}">${m.kind === 'keluar' ? '−' : '+'}${money(m.amount)}</b></div>`).join('')}` : ''}`;
}

// ================= Cash in / out =================
let moveKind = 'keluar';
async function openMove(kind) {
  moveKind = kind;
  $('cmTitle').textContent = kind === 'keluar' ? t('Cash out (take money from the drawer)') : t('Cash in (put money into the drawer)');
  $('cmAmount').value = ''; $('cmReason').value = '';
  $('cmCatWrap').hidden = kind !== 'keluar';
  $('cmHint').textContent = kind === 'keluar' ? t('Recorded as an expense in Records (cash).') : t('Not income: e.g. small change brought from home.');
  if (kind === 'keluar') {
    if (!outCats) {
      const { data } = await sb.from('categories').select('name').eq('type', 'Out').order('name');
      outCats = (data || []).map(c => c.name);
    }
    $('cmCat').innerHTML = `<option value="">${esc(t('Choose category…'))}</option>` + outCats.map(c => `<option>${esc(c)}</option>`).join('');
  }
  $('cashMoveDialog').showModal();
  $('cmAmount').focus();
}
async function saveMove(e) {
  e.preventDefault();
  const amt = Number($('cmAmount').value), reason = $('cmReason').value.trim(), cat = $('cmCat').value;
  if (!(amt > 0)) { toast(t('Enter an amount above RM 0.'), 'error'); return; }
  if (!reason) { toast(t('Write a reason.'), 'error'); return; }
  if (moveKind === 'keluar' && !cat) { toast(t('Choose an expense category.'), 'error'); return; }
  $('cmSave').disabled = true;
  const { error } = await sb.rpc('pos_cash_move', { p_shift: ctx.st.shift.id, p_kind: moveKind, p_amount: amt, p_reason: reason, p_category: moveKind === 'keluar' ? cat : null });
  $('cmSave').disabled = false;
  if (error) { toast(errText(error), 'error'); return; }
  $('cashMoveDialog').close();
  kickDrawer();
  toast(moveKind === 'keluar' ? t('Cash out {x} recorded (also in Records).', { x: money(amt) }) : t('Cash in {x} recorded.', { x: money(amt) }));
  refreshShiftDialog();
}

// ================= Tutup shift =================
function openClose() {
  $('csCount').value = ''; $('csNote').value = '';
  $('csStep1').hidden = false; $('csStep2').hidden = true;
  $('csBills').textContent = lastSummary?.open_bills ? t('{n} open bills not paid yet. They will be counted in the shift when they are paid.', { n: lastSummary.open_bills }) : '';
  kickDrawer();   // buka laci untuk dikira
  $('closeShiftDialog').showModal();
  $('csCount').focus();
}
async function confirmClose(e) {
  e.preventDefault();
  const raw = $('csCount').value.trim(), amt = Number(raw);
  if (raw === '' || !(amt >= 0)) { toast(t('Enter the cash counted in the drawer.'), 'error'); return; }
  if (!confirm(t('Close the shift with {x} counted in the drawer?', { x: money(amt) }))) return;
  $('csConfirm').disabled = true;
  const { data, error } = await sb.rpc('pos_close_shift', { p_shift: ctx.st.shift.id, p_counted: amt, p_note: $('csNote').value.trim() || null });
  $('csConfirm').disabled = false;
  if (error) { toast(errText(error), 'error'); return; }
  lastSummary = data;
  const diff = Number(data.difference);
  $('csResult').innerHTML = `
    <div class="kv-list">
      <div class="kv"><span>${t('Expected in drawer')}</span><b>${money(data.expected_cash)}</b></div>
      <div class="kv"><span>${t('Counted')}</span><b>${money(data.counted_cash)}</b></div>
      <div class="kv total ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : ''}"><span>${diff < 0 ? t('Short') : diff > 0 ? t('Over') : t('Exact')}</span><b>${(diff > 0 ? '+' : '') + money(diff)}</b></div>
    </div>`;
  $('csStep1').hidden = true; $('csStep2').hidden = false;
  $('shiftDialog').close();
  if (printer.status().connected) printReport(data);
  await loadShift();
}

// ================= Cetak =================
function kickDrawer() {
  if (printer.status().connected) printer.print(printer.escpos().init().drawer().bytes()).catch(() => {});
}
export async function printReport(s = lastSummary) {
  if (!s) return;
  const outlet = session.outlets.find(o => o.id === ctx.st.outletId) || {};
  const company = outlet.company_name?.trim() || session.business?.name || 'BizProfit';
  const p = printer.escpos().init().align('center').bold(true);
  printer.wrap(company).forEach(l => p.text(l));
  p.bold(false).text(outlet.name || '');
  p.bold(true).text(s.open ? t('SHIFT SUMMARY (OPEN)') : t('SHIFT REPORT')).bold(false);
  p.text(`${t('Open')}: ${dateTime(s.opened_at)}`);
  if (s.closed_at) p.text(`${t('Close')}: ${dateTime(s.closed_at)}`);
  p.align('left').line();
  p.text(printer.lr(t('Sales'), money(s.sales_total))).text(printer.lr(t('Paid orders'), String(s.orders_count || 0)));
  Object.entries(s.by_method || {}).forEach(([m, v]) => p.text(printer.lr('  ' + m, money(v))));
  p.line();
  p.text(printer.lr(t('Opening cash'), money(s.opening_float)));
  p.text(printer.lr(t('Cash sales'), money(s.cash_sales)));
  if (Number(s.cash_refunds)) p.text(printer.lr(t('Cash refunds'), '-' + money(s.cash_refunds)));
  p.text(printer.lr(t('Cash in'), money(s.cash_in)));
  p.text(printer.lr(t('Cash out'), '-' + money(s.cash_out)));
  if (s.show_expected) p.bold(true).text(printer.lr(t('Expected'), money(s.expected_cash))).bold(false);
  if (s.counted_cash != null) {
    p.text(printer.lr(t('Counted'), money(s.counted_cash)));
    p.bold(true).text(printer.lr(t('Difference'), money(s.difference))).bold(false);
  }
  if (s.note) printer.wrap(`${t('Note')}: ${s.note}`).forEach(l => p.text(l));
  p.line().align('center').text(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }));
  try { await printer.print(p.feed(4).cut().bytes()); toast(t('Report printed.')); }
  catch (e) { toast(e.message === 'NOT_CONNECTED' ? t('Printer not connected. Tap "Printer" at the top.') : t('Print failed: ') + e.message, 'error'); }
}

// ================= Tab "Hari ini": ringkasan shift =================
export async function renderShiftToday(box) {
  const st = ctx.st;
  if (!st.shiftReady) { box.innerHTML = ''; return; }
  const { data: shifts } = await sb.from('pos_shifts').select('id,opened_at,closed_at,opening_float,counted_cash,difference,sales_total')
    .eq('outlet_id', st.outletId).gte('opened_at', todayKL() + 'T00:00:00+08:00').order('opened_at');
  const list = shifts || [];
  box.innerHTML = `<section class="shift-card">
      <div class="shift-head"><b>${t('Shifts today')}</b>
        ${st.shift ? `<button type="button" class="btn ghost" data-shift-open>${t('Open shift details')}</button>` : `<button type="button" class="btn primary" data-shift-gate>${t('Open shop (open shift)')}</button>`}</div>
      ${list.length ? list.map(s => `<div class="kv small"><span>${time(s.opened_at)} – ${s.closed_at ? time(s.closed_at) : t('now')} · ${t('modal {x}', { x: money(s.opening_float) })}</span>
        <b>${money(s.sales_total ?? 0)}${s.closed_at ? ` · <span class="${Number(s.difference) < 0 ? 'neg' : Number(s.difference) > 0 ? 'pos' : ''}">${t('diff')} ${(Number(s.difference) > 0 ? '+' : '') + money(s.difference)}</span>` : ` · <span class="pos">${t('open')}</span>`}</b></div>`).join('')
        : `<p class="muted small">${t('No shift opened today yet.')}</p>`}
    </section>`;
  box.querySelector('[data-shift-open]')?.addEventListener('click', openShiftDialog);
  box.querySelector('[data-shift-gate]')?.addEventListener('click', showGate);
}

function showGate() {
  ctx.st.view === 'order' || document.querySelector('[data-view="order"]')?.click();
  $('shiftGate').hidden = false;
  prefillFloat();
}

// ================= Pasang =================
export function setupShift(c) {
  ctx = c;
  $('shiftBtn').onclick = () => (ctx.st.shift ? openShiftDialog() : showGate());
  $('gateOpen').onclick = openShift;
  $('gateFloat').addEventListener('keydown', e => { if (e.key === 'Enter') openShift(); });
  $('smOut').onclick = () => openMove('keluar');
  $('smIn').onclick = () => openMove('masuk');
  $('smPrint').onclick = () => printReport();
  $('smClose').onclick = openClose;
  $('cmForm').addEventListener('submit', saveMove);
  $('csForm').addEventListener('submit', confirmClose);
  $('csPrint').onclick = () => printReport();
  $('csDone').onclick = () => { $('closeShiftDialog').close(); showGate(); };
  document.querySelectorAll('#shiftDialog [data-close], #cashMoveDialog [data-close], #closeShiftDialog [data-close]')
    .forEach(b => b.onclick = () => $(b.dataset.close).close());
}
export { prefillFloat };
