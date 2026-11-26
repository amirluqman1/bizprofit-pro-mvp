// Pekerja: Kehadiran harian, senarai pekerja, payroll ringkas.
// Owner: semua pekerja. Manager: pekerja outlet sendiri yang bukan peringkat pengurus.
// Semua sekatan ini dikuatkuasa di database; UI hanya menyusun paparan.
import { $, esc, icon, toast, loadJsPdf, pdfText } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName, outletCompany } from '../session.js';
import { rm, todayKL, addDays, endOfMonth, dateRange, dateLong } from '../format.js';
import { isPro, lockCard, proTag } from '../plan.js';
import { t, locale, getLang } from '../i18n.js';

const STATUS = { hadir: 'Present', separuh: 'Half day', cuti: 'Leave', tidak_hadir: 'Absent' };
const DAY_VALUE = { hadir: 1, separuh: 0.5, cuti: 0, tidak_hadir: 0 };
const state = { tab: 'kehadiran', date: null, from: null, to: null, preset: 'bulan_ini' };
let employees = [];
let payMethods = null;

const tabFromHash = () => {
  const m = location.hash.match(/t=(kehadiran|pekerja|gaji)/);
  return m ? m[1] : 'kehadiran';
};
const cents = n => Math.round(Number(n || 0) * 100);
const fromCents = c => c / 100;
const PAY_TYPE = { harian: ['Daily', '/day', 'Daily wage (RM)'], mingguan: ['Weekly', '/week', 'Weekly wage (RM)'], bulanan: ['Monthly', '/month', 'Monthly salary (RM)'] };   // diterjemah semasa papar
const payLabel = e => `${t(PAY_TYPE[e.pay_type][0])} ${rm(e.rate)}${t(PAY_TYPE[e.pay_type][1])}${Number(e.ot_rate) ? ' · OT ' + rm(e.ot_rate) + t('/hr') : ''}`;
// Bilangan minggu dalam tempoh (contoh 7 hari = 1, 30 hari = 4.29)
const weeksIn = (from, to) => Math.round(((new Date(to) - new Date(from)) / 86400000 + 1) / 7 * 100) / 100;
const errText = e => e?.message || t('Unknown error.');

// Peraturan tidak hadir (gaji mingguan/bulanan sahaja; upah harian memang tak dibayar bila tak hadir).
//   penuh  : bayar penuh, tiada potongan automatik
//   sehari : potong gaji sehari = gaji ÷ hari bekerja (pemilik tetapkan, cth. 26 sebulan)
//   tetap  : potong RM tetap setiap hari tidak hadir
// Separuh hari = separuh potongan. Cuti dan hari tidak ditanda tidak dipotong.
const ABSENT_RULES = { penuh: 'Pay in full (no deduction)', sehari: "Deduct 1 day's pay", tetap: 'Deduct a fixed amount per day' };
const ABSENT_VALUE = { tidak_hadir: 1, separuh: 0.5 };
const DEFAULT_WORKDAYS = { mingguan: 6, bulanan: 26 };
const absentRuleOf = e => (e.pay_type === 'harian' ? 'penuh' : e.absent_rule || 'penuh');
// Potongan sehari dalam sen (boleh ada pecahan; dibundarkan selepas darab hari).
const absentPerDay = e => absentRuleOf(e) === 'sehari' ? cents(e.rate) / Number(e.absent_workdays || DEFAULT_WORKDAYS[e.pay_type])
  : absentRuleOf(e) === 'tetap' ? cents(e.absent_amount) : 0;
const daysInMonth = iso => Number(endOfMonth(iso).slice(-2));

// Adakah tempoh ini tepat satu kitaran bulan? (1–30 Nov, atau 15 Nov – 14 Dis)
function isMonthCycle(from, to) {
  const d = Number(from.slice(-2));
  if (d === 1) return to === endOfMonth(from);
  const next = addDays(endOfMonth(from), 1);                 // 1hb bulan berikutnya
  const day = Math.min(d - 1, daysInMonth(next));
  return to === next.slice(0, 8) + String(day).padStart(2, '0');
}

// Gaji bulanan (sen) untuk hari yang belum dibayar.
// Satu kitaran bulan penuh = gaji penuh. Tempoh lain dikira pro-rata ikut hari kalendar:
// setiap hari bernilai gaji ÷ bilangan hari bulan itu (Nov = 30, Dis = 31).
// Contoh: gaji RM2,000, tempoh 7 hari dalam November = 2000 × 7/30 = RM466.67.
function monthlyBase(rateCents, days, from, to) {
  const cycle = isMonthCycle(from, to);
  const total = (to < from) ? 0 : Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  const share = days.reduce((acc, d) => acc + (cycle ? 1 / total : 1 / daysInMonth(d)), 0);
  return Math.round(rateCents * share);
}

async function loadEmployees() {
  let q = sb.from('employees').select('id,outlet_id,name,position,phone,pay_type,rate,ot_rate,is_manager,active,absent_rule,absent_workdays,absent_amount').order('name');
  if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
  const { data, error } = await q;
  if (error) throw error;
  employees = data || [];
}

async function loadPayMethods() {
  if (payMethods) return payMethods;
  const { data } = await sb.from('payment_methods').select('name').order('name');
  payMethods = (data || []).map(p => p.name);
  return payMethods;
}

function presetRange(preset) {
  const td = todayKL();
  if (preset === 'bulan_lepas') { const s = addDays(td.slice(0, 7) + '-01', -1).slice(0, 7) + '-01'; return [s, endOfMonth(s)]; }
  if (preset === 'minggu_ini') { const dow = new Date(td + 'T00:00:00Z').getUTCDay(); const s = addDays(td, -((dow + 6) % 7)); return [s, addDays(s, 6)]; }
  const s = td.slice(0, 7) + '-01'; return [s, endOfMonth(s)];
}

// ================= Halaman =================
export default {
  async render(view) {
    state.tab = tabFromHash();
    state.date = state.date || todayKL();
    if (!state.from) [state.from, state.to] = presetRange(state.preset);
    const tabs = { kehadiran: t('Attendance'), pekerja: t('Staff'), gaji: isPro() ? t('Payroll') : `${t('Payroll')} ${proTag()}` };
    view.innerHTML = `
      <div class="seg tabs" role="tablist">${Object.entries(tabs).map(([k, v]) =>
        `<a class="seg-opt ${state.tab === k ? 'on' : ''}" href="#/pekerja?t=${k}" role="tab" aria-selected="${state.tab === k}">${v}</a>`).join('')}</div>
      <div id="pkBody"><div class="skel"></div></div>
      ${dialogsHTML()}`;
    bindDialogs(view);
    try { await loadEmployees(); }
    catch { $('pkBody').innerHTML = `<div class="empty">${t('Could not load staff list. Check your internet and try again.')}</div>`; return; }
    if (state.tab === 'pekerja') return renderStaffList();
    if (state.tab === 'gaji') return renderPayroll();
    return renderAttendance();
  }
};

// ================= Kehadiran =================
// Tiga paparan: Hari (tanda satu tarikh + OT), Minggu dan Bulan (grid pekerja × hari).
const AT_VIEWS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
async function renderAttendance() {
  const box = $('pkBody');
  state.atView = state.atView || 'day';
  box.innerHTML = `
    <div class="seg" role="group" aria-label="${t('Attendance view')}">${AT_VIEWS.map(([k, v]) =>
      `<button type="button" class="seg-opt ${state.atView === k ? 'on' : ''}" data-atview="${k}" aria-pressed="${state.atView === k}">${t(v)}</button>`).join('')}</div>
    <div id="atBody" class="stack"></div>`;
  box.querySelectorAll('[data-atview]').forEach(b => b.addEventListener('click', () => { state.atView = b.dataset.atview; renderAttendance(); }));
  return state.atView === 'day' ? renderAttendanceDay($('atBody')) : renderAttendanceGrid($('atBody'));
}

async function renderAttendanceDay(box) {
  const active = employees.filter(e => e.active);
  box.innerHTML = `
    <section class="card stack">
      <label class="field">${t('Date')}<input id="atDate" type="date" max="${todayKL()}" value="${state.date}"></label>
      <p class="greet-sub" id="atSummary"></p>
      <button class="btn ghost block" id="atAll" type="button">${t('Mark all unmarked: Present')}</button>
    </section>
    <div id="atList" class="list"></div>`;
  if (!active.length) { $('atList').innerHTML = emptyStaff(); $('atAll').hidden = true; return; }

  let marks = new Map();
  async function load() {
    const { data, error } = await sb.from('attendance').select('employee_id,status,ot_hours')
      .eq('work_date', state.date).in('employee_id', active.map(e => e.id));
    if (error) { toast(t('Could not load attendance.'), 'error'); return; }
    marks = new Map((data || []).map(a => [a.employee_id, a]));
    draw();
  }
  function draw() {
    $('atList').innerHTML = active.map(e => {
      const m = marks.get(e.id);
      return `<div class="card emp" data-emp="${esc(e.id)}">
        <div class="emp-head"><div><b>${esc(e.name)}</b><span class="sub">${esc([e.position, session.outletId === ALL_OUTLETS ? outletName(e.outlet_id) : ''].filter(Boolean).join(' · '))}</span></div>
          <label class="ot">OT<input type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${m ? Number(m.ot_hours) : 0}" data-ot="${esc(e.id)}" aria-label="${t('OT hours {x}', { x: esc(e.name) })}">hrs</label></div>
        <div class="chips st">${Object.entries(STATUS).map(([k, v]) =>
          `<button type="button" class="chip ${k} ${m?.status === k ? 'on' : ''}" data-status="${k}" data-id="${esc(e.id)}" aria-pressed="${m?.status === k}">${t(v)}</button>`).join('')}</div>
      </div>`;
    }).join('');
    const count = k => [...marks.values()].filter(m => m.status === k).length;
    $('atSummary').textContent = `${dateLong(state.date)} · ${t('Present')} ${count('hadir')} · ${t('Half day')} ${count('separuh')} · ${t('Leave')} ${count('cuti')} · ${t('Absent')} ${count('tidak_hadir')} · ${t('Unmarked')} ${active.length - marks.size}`;
  }
  async function save(id, status, ot) {
    const { error } = await sb.from('attendance')
      .upsert({ employee_id: id, work_date: state.date, status, ot_hours: ot }, { onConflict: 'employee_id,work_date' });
    if (error) { toast(t('Save failed: ') + errText(error), 'error'); return false; }
    marks.set(id, { employee_id: id, status, ot_hours: ot });
    return true;
  }

  $('atList').addEventListener('click', async e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const id = b.dataset.id, cur = marks.get(id);
    if (cur?.status === b.dataset.status) {          // tekan sekali lagi = buang tanda
      const { error } = await sb.from('attendance').delete().eq('employee_id', id).eq('work_date', state.date);
      if (error) { toast(t('Could not remove mark.'), 'error'); return; }
      marks.delete(id); draw(); return;
    }
    if (await save(id, b.dataset.status, Number(cur?.ot_hours || 0))) draw();
  });
  $('atList').addEventListener('change', async e => {
    const inp = e.target.closest('[data-ot]');
    if (!inp) return;
    const ot = Number(inp.value);
    if (!(ot >= 0 && ot <= 24)) { toast(t('OT hours must be between 0 and 24.'), 'error'); inp.value = marks.get(inp.dataset.ot)?.ot_hours || 0; return; }
    const cur = marks.get(inp.dataset.ot);
    if (await save(inp.dataset.ot, cur?.status || 'hadir', ot)) { draw(); toast(t('OT saved.')); }
  });
  $('atDate').addEventListener('change', e => {
    if (!e.target.value || e.target.value > todayKL()) { e.target.value = state.date; return; }
    state.date = e.target.value; load();
  });
  $('atAll').onclick = async () => {
    const todo = active.filter(e => !marks.has(e.id));
    if (!todo.length) { toast(t('All staff are already marked.')); return; }
    const { error } = await sb.from('attendance').upsert(
      todo.map(e => ({ employee_id: e.id, work_date: state.date, status: 'hadir', ot_hours: 0 })), { onConflict: 'employee_id,work_date' });
    if (error) { toast(t('Could not mark: ') + errText(error), 'error'); return; }
    toast(t('{n} staff marked Present.', { n: todo.length }));
    load();
  };
  await load();
}

// ---------- Grid minggu / bulan ----------
// Kod huruf ikut bahasa: EN P/½/L/A, BM H/½/C/T (Hadir, Separuh, Cuti, Tidak hadir).
const AT_CODES = { en: { hadir: 'P', separuh: '½', cuti: 'L', tidak_hadir: 'A' }, ms: { hadir: 'H', separuh: '½', cuti: 'C', tidak_hadir: 'T' } };
const atCode = st => (AT_CODES[getLang()] || AT_CODES.en)[st];
const AT_CYCLE = [null, 'hadir', 'separuh', 'cuti', 'tidak_hadir'];   // tekan kotak: kosong → P → ½ → L → A → kosong
const DOW1S = { en: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], ms: ['A', 'I', 'S', 'R', 'K', 'J', 'S'] };
const dow1 = i => (DOW1S[getLang()] || DOW1S.en)[i];

function gridRange() {
  const d = state.date;
  if (state.atView === 'week') {
    const s = addDays(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));   // Isnin – Ahad
    return [s, addDays(s, 6)];
  }
  const s = d.slice(0, 8) + '01';
  return [s, endOfMonth(s)];
}

async function renderAttendanceGrid(box) {
  const active = employees.filter(e => e.active);
  const today = todayKL();
  const [from, to] = gridRange();
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const label = state.atView === 'week' ? dateRange(from, to)
    : new Date(from + 'T00:00:00').toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  box.innerHTML = `
    <section class="card stack">
      <div class="datenav at-nav">
        <button type="button" id="agPrev" aria-label="${t('Previous')}">‹</button>
        <span class="at-label">${esc(label)}</span>
        <button type="button" id="agNext" aria-label="${t('Next')}" ${to >= today ? 'disabled' : ''}>›</button>
      </div>
      <p class="greet-sub" id="agSum">${t('Loading…')}</p>
      <button class="btn ghost block" id="agAll" type="button">${t('Mark all empty days: Present')}</button>
    </section>
    ${active.length ? `<div class="card at-grid-wrap"><table class="at-grid">
      <thead><tr><th class="at-corner">${t('Staff')}</th>${days.map(d => `<th class="${d === today ? 'today' : ''}"><button type="button" class="at-day" data-day="${d}" ${d > today ? 'disabled' : ''} aria-label="${esc(t('Edit {d}', { d: dateLong(d) }))}"><span>${dow1(new Date(d + 'T00:00:00Z').getUTCDay())}</span>${Number(d.slice(-2))}</button></th>`).join('')}<th>${t('Days')}</th></tr></thead>
      <tbody>${active.map(e => `<tr>
        <th scope="row"><button type="button" class="at-name" data-fill="${esc(e.id)}" title="${esc(t("Mark {x}'s empty days Present", { x: e.name }))}">${esc(e.name)}</button></th>
        ${days.map(d => `<td><button type="button" class="at-cell" data-c="${esc(e.id)}|${d}" ${d > today ? 'disabled' : ''} aria-label="${esc(e.name)} ${esc(d)}"></button></td>`).join('')}
        <td class="at-tot" data-tot="${esc(e.id)}"></td></tr>`).join('')}</tbody>
    </table></div>
    <p class="note-line small">${icon('check')}${t('Tap a box: <b>{p}</b> Present → <b>½</b> Half day → <b>{l}</b> Leave → <b>{a}</b> Absent → empty. Tap a <b>name</b> to mark that person\'s empty days Present. Tap a <b>date</b> to edit OT for that day.', { p: atCode('hadir'), l: atCode('cuti'), a: atCode('tidak_hadir') })}</p>` : emptyStaff()}`;

  $('agPrev').onclick = () => { state.date = state.atView === 'week' ? addDays(from, -7) : addDays(from, -1); renderAttendance(); };
  $('agNext').onclick = () => {
    const n = state.atView === 'week' ? addDays(from, 7) : addDays(to, 1);
    state.date = n > today ? today : n; renderAttendance();
  };
  if (!active.length) { $('agAll').hidden = true; $('agSum').textContent = ''; return; }

  const marks = new Map();   // "empId|tarikh" -> { status, ot }
  const { data, error } = await sb.from('attendance').select('employee_id,work_date,status,ot_hours')
    .gte('work_date', from).lte('work_date', to).in('employee_id', active.map(e => e.id));
  if (error) { $('agSum').textContent = t('Could not load attendance. Try again.'); return; }
  (data || []).forEach(a => marks.set(`${a.employee_id}|${a.work_date}`, { status: a.status, ot: Number(a.ot_hours) }));

  const grid = box.querySelector('.at-grid');
  const paintCell = key => {
    const el = grid.querySelector(`[data-c="${key}"]`);
    const st = marks.get(key)?.status;
    el.className = 'at-cell' + (st ? ' s-' + st : '');
    el.textContent = st ? atCode(st) : '';
    el.title = st ? t(STATUS[st]) + (marks.get(key).ot ? ' · ' + t('OT {n} hrs', { n: marks.get(key).ot }) : '') : t('Not marked');
  };
  const paintTotals = () => {
    active.forEach(e => {
      const v = days.reduce((acc, d) => acc + (DAY_VALUE[marks.get(`${e.id}|${d}`)?.status] || 0), 0);
      grid.querySelector(`[data-tot="${e.id}"]`).textContent = v;
    });
    const past = days.filter(d => d <= today);
    const all = active.flatMap(e => past.map(d => marks.get(`${e.id}|${d}`)?.status));
    const n = k => all.filter(x => x === k).length;
    $('agSum').textContent = `${t('Present')} ${n('hadir')} · ${t('Half day')} ${n('separuh')} · ${t('Leave')} ${n('cuti')} · ${t('Absent')} ${n('tidak_hadir')} · ${t('Empty')} ${n(undefined)}`;
  };
  marks.forEach((_, k) => { if (grid.querySelector(`[data-c="${k}"]`)) paintCell(k); });
  paintTotals();

  // Simpan selepas berhenti menekan (boleh tekan berulang kali untuk pilih status).
  const timers = new Map();
  const save = async key => {
    const [id, d] = key.split('|');
    const m = marks.get(key);
    const { error: err } = m?.status
      ? await sb.from('attendance').upsert({ employee_id: id, work_date: d, status: m.status, ot_hours: m.ot || 0 }, { onConflict: 'employee_id,work_date' })
      : await sb.from('attendance').delete().eq('employee_id', id).eq('work_date', d);
    if (err) { toast(t('Save failed: ') + errText(err), 'error'); renderAttendance(); }
  };
  const fill = async ids => {
    const rows = ids.flatMap(id => days.filter(d => d <= today && !marks.get(`${id}|${d}`)?.status)
      .map(d => ({ employee_id: id, work_date: d, status: 'hadir', ot_hours: 0 })));
    if (!rows.length) { toast(t('No empty days to mark.')); return; }
    const { error: err } = await sb.from('attendance').upsert(rows, { onConflict: 'employee_id,work_date' });
    if (err) { toast(t('Could not mark: ') + errText(err), 'error'); return; }
    rows.forEach(r => { const k = `${r.employee_id}|${r.work_date}`; marks.set(k, { status: 'hadir', ot: 0 }); paintCell(k); });
    paintTotals();
    toast(t(rows.length === 1 ? '{n} day marked Present.' : '{n} days marked Present.', { n: rows.length }));
  };

  grid.addEventListener('click', e => {
    const cell = e.target.closest('[data-c]');
    if (cell) {
      const key = cell.dataset.c, cur = marks.get(key);
      const next = AT_CYCLE[(AT_CYCLE.indexOf(cur?.status ?? null) + 1) % AT_CYCLE.length];
      marks.set(key, { status: next, ot: next ? (cur?.ot || 0) : 0 });
      paintCell(key); paintTotals();
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => { timers.delete(key); save(key); }, 600));
      return;
    }
    const name = e.target.closest('[data-fill]');
    if (name) { fill([name.dataset.fill]); return; }
    const day = e.target.closest('[data-day]');
    if (day) { timers.forEach((tm, k) => { clearTimeout(tm); save(k); }); state.date = day.dataset.day; state.atView = 'day'; renderAttendance(); }
  });
  $('agAll').onclick = () => fill(active.map(e => e.id));
}

function emptyStaff() {
  return `<div class="empty">${t('No staff yet.')}<br>${t('Open the <b>Staff</b> tab and tap <b>+ Add staff</b>.')}</div>`;
}

// ================= Senarai pekerja =================
function renderStaffList() {
  const box = $('pkBody');
  const sorted = [...employees].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ms-MY'));
  box.innerHTML = `
    <div class="section-row"><h2 class="section-title">${t('{n} staff', { n: employees.length })}</h2><button class="btn white" id="empAdd" type="button">${t('+ Add staff')}</button></div>
    <div class="list" id="empList">${sorted.length ? sorted.map(e => `
      <button type="button" class="row-btn emp-row ${e.active ? '' : 'inactive'}" data-edit="${esc(e.id)}">
        ${icon('user')}<span>${esc(e.name)}${e.is_manager ? ` <i class="tag">${t('Management level')}</i>` : ''}${e.active ? '' : ` <i class="tag off">${t('Inactive')}</i>`}
        <small>${esc([e.position, outletName(e.outlet_id), payLabel(e), absentRuleOf(e) === 'penuh' ? '' : t('Absent: {x}', { x: rm(fromCents(absentPerDay(e))) + t('/day') })].filter(Boolean).join(' · '))}</small></span>${icon('chev-right')}
      </button>`).join('') : `<div class="empty">${t('No staff yet.')}<br>${t('Tap <b>+ Add staff</b>.')}</div>`}</div>
    ${session.isAdminUp ? '' : '<p class="note-line small">' + icon('lock') + t('Management-level staff are managed only by the owner or an admin.') + '</p>'}`;
  $('empAdd').onclick = () => openEmployee(null);
  $('empList').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]');
    if (b) openEmployee(employees.find(x => x.id === b.dataset.edit));
  });
}

function openEmployee(emp) {
  $('empTitle').textContent = emp ? t('Edit staff') : t('Add staff');
  $('empForm').dataset.id = emp?.id || '';
  $('empName').value = emp?.name || '';
  $('empPosition').value = emp?.position || '';
  $('empPhone').value = emp?.phone || '';
  if ($('empOutlet')) $('empOutlet').value = emp?.outlet_id || (session.outletId !== ALL_OUTLETS ? session.outletId : session.profile.outlet_id);
  $('empPayType').value = emp?.pay_type || 'harian';
  $('empRate').value = emp ? emp.rate : '';
  $('empOt').value = emp ? emp.ot_rate : 0;
  $('empAbsRule').value = emp?.absent_rule || 'penuh';
  $('empAbsDays').value = emp?.absent_workdays || '';
  $('empAbsAmt').value = emp?.absent_amount ?? '';
  if ($('empManager')) $('empManager').checked = !!emp?.is_manager;
  $('empActiveWrap').hidden = !emp;
  $('empActive').checked = emp ? emp.active : true;
  syncRateLabel();
  $('empDialog').showModal();
}
function syncRateLabel() {
  const type = $('empPayType').value;
  $('empRateLabel').firstChild.textContent = t(PAY_TYPE[type][2]);
  // Peraturan tidak hadir hanya untuk gaji mingguan/bulanan.
  const rule = $('empAbsRule').value;
  $('empAbsBox').hidden = type === 'harian';
  $('empAbsDaysWrap').hidden = rule !== 'sehari';
  $('empAbsAmtWrap').hidden = rule !== 'tetap';
  $('empAbsDaysWrap').firstChild.textContent = t(type === 'mingguan' ? 'Working days per week' : 'Working days per month');
  if (!$('empAbsDays').value) $('empAbsDays').placeholder = String(DEFAULT_WORKDAYS[type] || 26);
  const rate = Number($('empRate').value), days = Number($('empAbsDays').value || DEFAULT_WORKDAYS[type]);
  const perDay = rule === 'sehari' ? (rate > 0 && days > 0 ? rate / days : 0) : Number($('empAbsAmt').value || 0);
  $('empAbsHint').textContent = rule === 'penuh'
    ? t('Absent days are shown on the payslip but not deducted. You can still deduct manually under "Deduction".')
    : t('1 absent day = −{a}, half day = −{h}. Leave and unmarked days are not deducted.', { a: rm(perDay), h: rm(perDay / 2) });
}

async function saveEmployee(e) {
  e.preventDefault();
  const id = $('empForm').dataset.id;
  const payload = {
    name: $('empName').value.trim(),
    position: $('empPosition').value.trim() || null,
    phone: $('empPhone').value.trim() || null,
    outlet_id: $('empOutlet') ? $('empOutlet').value : session.profile.outlet_id,
    pay_type: $('empPayType').value,
    rate: Number($('empRate').value),
    ot_rate: Number($('empOt').value || 0),
    active: $('empActive').checked,
    absent_rule: $('empPayType').value === 'harian' ? 'penuh' : $('empAbsRule').value,
    absent_workdays: null, absent_amount: null
  };
  if (payload.absent_rule === 'sehari') payload.absent_workdays = Number($('empAbsDays').value || DEFAULT_WORKDAYS[payload.pay_type]);
  if (payload.absent_rule === 'tetap') payload.absent_amount = Number($('empAbsAmt').value);
  if ($('empManager')) payload.is_manager = $('empManager').checked;
  if (!payload.name) { toast(t('Enter the staff name.'), 'error'); return; }
  if ($('empRate').value.trim() === '' || !(payload.rate >= 0) || !(payload.ot_rate >= 0)) { toast(t('Enter a valid pay rate.'), 'error'); return; }
  if (payload.absent_rule === 'sehari' && !(Number.isInteger(payload.absent_workdays) && payload.absent_workdays >= 1 && payload.absent_workdays <= 31)) { toast(t('Working days must be a whole number from 1 to 31.'), 'error'); return; }
  if (payload.absent_rule === 'tetap' && !($('empAbsAmt').value.trim() !== '' && payload.absent_amount >= 0)) { toast(t('Enter the deduction per absent day.'), 'error'); return; }
  $('empSave').disabled = true;
  const res = id
    ? await sb.from('employees').update(payload).eq('id', id).select('id')
    : await sb.from('employees').insert(payload).select('id');
  $('empSave').disabled = false;
  if (res.error) { toast(t('Save failed: ') + errText(res.error), 'error'); return; }
  if (!res.data?.length) { toast(t('Nothing was saved. You may not have access.'), 'error'); return; }
  $('empDialog').close();
  toast(id ? t('Staff updated.') : t('Staff added.'));
  await loadEmployees();
  renderStaffList();
}

// ================= Gaji =================
// Advance ditolak automatik (maksimum = gaji kasar); lebihan dibawa ke gaji seterusnya.
function recalc(r) {
  // Potongan tidak hadir tidak boleh jadikan gaji negatif.
  if (!r.paid) r.absDed = Math.min(r.absFull || 0, Math.max(0, r.base + r.otAmt + r.allow - r.ded));
  const gross = Math.max(0, r.base + r.otAmt + r.allow - r.ded - r.absDed);
  r.adv = Math.min(r.bal, gross);
  r.net = gross - r.adv;
  return r;
}
// Data slip (satu sumber untuk teks WhatsApp dan PDF).
function slipData(r) {
  const money = c => rm(fromCents(c));
  const baseItem = r.payType === 'harian' ? [t('Daily wage ({n} days × {r})', { n: r.days, r: rm(r.rate) }), money(r.base)]
    : r.payType === 'mingguan' ? [t('Weekly wage ({n} weeks × {r})', { n: r.weeks, r: rm(r.rate) }), money(r.base)]
    : [r.base === cents(r.rate) ? t('Monthly salary') : t('Monthly salary (pro-rated, {r}/month)', { r: rm(r.rate) }), money(r.base)];
  const items = [baseItem, [t('OT ({n} hrs × {r})', { n: r.ot, r: rm(r.otRate) }), money(r.otAmt)], [t('Allowance'), money(r.allow)], [t('Deduction'), '-' + money(r.ded)]];
  if (r.absDed) items.push([t('Absent deduction ({n} days)', { n: r.absDays }), '-' + money(r.absDed)]);
  if (r.adv) items.push([t('Advance deduction'), '-' + money(r.adv)]);
  const co = outletCompany(r.e.outlet_id);
  return {
    business: co.name, regNo: co.regNo,
    info: [['Name', r.e.name], ...(r.e.position ? [['Position', r.e.position]] : []), ['Outlet', outletName(r.e.outlet_id)],
      ['Period', dateRange(r.from, r.to)]],
    items, total: money(r.net),
    status: r.paid ? `${t('Paid')} ${new Date(r.slip.paid_at).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}`
      : r.slip ? t('Draft (unpaid)') : t('Unpaid')
  };
}

// Slip GABUNGAN: semua slip seorang pekerja dalam tempoh dipilih jadi satu slip
// (contoh 6 slip mingguan → 1 slip sebulan). Slip asal tidak berubah.
function comboData(list) {
  const r0 = list[0], money = c => rm(fromCents(c));
  const sum = k => list.reduce((acc, r) => acc + r[k], 0);
  const short = iso => new Date(iso + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  const items = list.map(r => [
    `${dateRange(r.from, r.to)} · ${r.payType === 'bulanan' ? t('salary') : t('{n} days', { n: r.days })}${r.ot ? ' + ' + t('OT {n} hrs', { n: r.ot }) : ''}${r.paid ? '' : ` (${t('unpaid')})`}`,
    money(r.base + r.otAmt)]);
  const allow = sum('allow'), ded = sum('ded'), adv = sum('adv'), absDed = sum('absDed');
  if (allow) items.push([t('Allowance (total)'), money(allow)]);
  if (ded) items.push([t('Deduction (total)'), '-' + money(ded)]);
  if (absDed) items.push([t('Absent deduction (total {n} days)', { n: sum('absDays') }), '-' + money(absDed)]);
  if (adv) items.push([t('Advance deduction (total)'), '-' + money(adv)]);
  const paid = list.filter(r => r.paid);
  const co = outletCompany(r0.e.outlet_id);
  return {
    business: co.name, regNo: co.regNo, compact: items.length > 9,
    info: [['Name', r0.e.name], ...(r0.e.position ? [['Position', r0.e.position]] : []), ['Outlet', outletName(r0.e.outlet_id)],
      ['Payments', t('{n} payslips combined', { n: list.length })], ['Period', dateRange(state.from, state.to)]],
    items, total: money(sum('net')),
    status: paid.length === list.length
      ? t(paid.length === 1 ? 'Paid in {n} payment ({d})' : 'Paid in {n} payments ({d})', { n: paid.length, d: paid.map(r => short(new Date(r.slip.paid_at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' }))).join(', ') })
      : t('{n} of {m} paid', { n: paid.length, m: list.length })
  };
}

function drawSlip(doc, d) {
  const W = 148, M = 12, R = W - M;
  const GREEN = [17, 90, 55], INK = [22, 28, 25], GREY = [95, 105, 100], LINE = [214, 221, 217];
  const fill = c => doc.setFillColor(...c), stroke = c => doc.setDrawColor(...c), color = c => doc.setTextColor(...c);

  // Kepala: nama perniagaan, tajuk SLIP GAJI dengan bar hijau, tempoh di kanan.
  color(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(pdfText(d.business), M, d.regNo ? 14.5 : 17, { maxWidth: W - M * 2 });
  if (d.regNo) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); color(GREY); doc.text(pdfText(d.regNo), M, 19.3); doc.setFont('helvetica', 'bold'); }
  fill(GREEN); doc.rect(M, 23, 1.6, 8.5, 'F');
  color(GREEN); doc.setFontSize(19); doc.text(t('PAYSLIP'), M + 5, 30.3);
  color(INK); doc.setFontSize(9.5);
  doc.text(pdfText(d.info.find(i => i[0] === 'Period')[1]), R, 29.5, { align: 'right' });
  stroke(GREEN); doc.setLineWidth(0.8); doc.line(M, 35, R, 35);

  // Maklumat pekerja.
  let y = 45;
  doc.setFontSize(10);
  d.info.filter(i => i[0] !== 'Period').forEach(([k, v]) => {
    doc.setFont('helvetica', 'normal'); color(GREY); doc.text(t(k), M + 1, y); doc.text(':', M + 29, y);
    doc.setFont('helvetica', 'bold'); color(INK); doc.text(pdfText(v), M + 35, y, { maxWidth: R - M - 35 });
    y += 6.5;
  });
  y += 1; stroke(LINE); doc.setLineWidth(0.3); doc.line(M, y, R, y); y += 7;

  // Jadual Perihal / Amaun.
  const split = R - 42, hH = 8.5, rH = d.compact ? 7 : 8.5;
  fill(GREEN); doc.rect(M, y, R - M, hH, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(t('Description'), M + 4, y + 5.7); doc.text(t('Amount (RM)'), R - 4, y + 5.7, { align: 'right' });
  stroke([255, 255, 255]); doc.setLineWidth(0.3); doc.line(split, y, split, y + hH);
  y += hH;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(d.compact ? 8.5 : 9.5); stroke(LINE);
  const ty = d.compact ? 4.8 : 5.7;
  d.items.forEach(([k, v]) => {
    doc.rect(M, y, R - M, rH); doc.line(split, y, split, y + rH);
    color(INK); doc.text(pdfText(k), M + 4, y + ty, { maxWidth: split - M - 8 });
    doc.text(pdfText(v), R - 4, y + ty, { align: 'right' });
    y += rH;
  });
  const tH = 11;
  fill([230, 245, 236]); doc.rect(M, y, R - M, tH, 'FD');
  color([11, 60, 36]); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
  doc.text(t('NET PAY'), M + 4, y + 7.3);
  doc.setFontSize(13); doc.text(pdfText(d.total), R - 4, y + 7.5, { align: 'right' });
  y += tH + 8;

  // Status.
  color(INK); doc.setFontSize(10); doc.text(t('Status:'), M, y);
  const sw = doc.getTextWidth(t('Status:') + ' ');
  doc.setFont('helvetica', 'normal'); doc.text(pdfText(d.status), M + sw, y, { maxWidth: R - M - sw });

  // Tandatangan dan kaki.
  const sy = 176;
  stroke([60, 70, 65]); doc.setLineWidth(0.3);
  doc.line(M + 1, sy, M + 50, sy); doc.line(R - 50, sy, R - 1, sy);
  color(INK); doc.setFontSize(9); doc.text(t('Employee signature'), M + 1, sy + 5.5); doc.text(t('Employer signature'), R - 50, sy + 5.5);
  stroke([180, 188, 184]); doc.line(M - 2, 191, R + 2, 191);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); color([110, 118, 114]);
  doc.text(t('Generated by BizProfit Pro · ') + new Date().toLocaleString(locale()), W / 2, 197, { align: 'center' });
}

let pdfFile = null;   // fail PDF terakhir, untuk dialog Muat turun / Kongsi

async function makePdf(list, filename, label, toData = slipData) {
  let JsPDF;
  try { JsPDF = await loadJsPdf(); }
  catch { toast(t('Could not create the PDF. Check your internet connection.'), 'error'); return; }
  const doc = new JsPDF({ unit: 'mm', format: 'a5' });
  list.forEach((r, i) => { if (i) doc.addPage(); drawSlip(doc, toData(r)); });
  const safe = filename.replace(/[^\w.-]+/g, '_');
  pdfFile = new File([doc.output('blob')], safe, { type: 'application/pdf' });
  $('pdfInfo').textContent = `${label} · ${safe}`;
  $('pdfShare').hidden = !(navigator.canShare && navigator.canShare({ files: [pdfFile] }));
  $('pdfDialog').showModal();
}

function downloadPdf() {
  if (!pdfFile) return;
  const url = URL.createObjectURL(pdfFile);
  const a = document.createElement('a');
  a.href = url; a.download = pdfFile.name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(t('PDF downloaded. Check your Downloads folder.'));
}

async function sharePdf() {
  if (!pdfFile) return;
  try { await navigator.share({ files: [pdfFile], title: pdfFile.name }); }
  catch (e) { if (e?.name !== 'AbortError') toast(t('Share failed. Try Download.'), 'error'); }
}

let payrollVersion = 0;   // hanya pemuatan terkini dipaparkan (elak paparan berganda)

async function renderPayroll() {
  const v = ++payrollVersion;
  const box = $('pkBody');
  if (!isPro()) { box.innerHTML = lockCard('Payroll', 'Calculate daily, weekly or monthly pay with OT, allowances, deductions and advances, then share a PDF payslip.'); return; }
  box.innerHTML = `
    <section class="card stack">
      <div class="seg" role="group" aria-label="${t('Pay period')}">
        ${[['bulan_ini', t('This month')], ['bulan_lepas', t('Last month')], ['minggu_ini', t('This week')]].map(([k, v]) =>
          `<button type="button" class="seg-opt ${state.preset === k ? 'on' : ''}" data-preset="${k}">${v}</button>`).join('')}
      </div>
      <div class="two">
        <label class="field">${t('From')}<input id="pyFrom" type="date" value="${state.from}"></label>
        <label class="field">${t('To')}<input id="pyTo" type="date" value="${state.to}"></label>
      </div>
      <div class="kv total" id="pyTotal"></div>
      <p class="greet-sub right" id="pyPaid"></p>
      <div class="two" id="pyPdfBtns" hidden>
        <button class="btn ghost" id="pyPdfAll" type="button">${icon('download')} ${t('PDF all payslips')}</button>
        <button class="btn ghost" id="pyPdfCombo" type="button">${icon('download')} ${t('1 slip per staff')}</button>
      </div>
    </section>
    <details class="card adv-box" id="pyAdvances"></details>
    <button class="btn ghost block" id="pyAdvanceBtn" type="button">${t('+ Give advance (early pay)')}</button>
    <div id="pyList" class="list"><div class="skel"></div></div>
    <p class="note-line small">${icon('lock')}${t('Daily wage = days present × rate (half day = 0.5). Monthly salary is paid in full for a full month; shorter periods are pro-rated by calendar days. Weekly and monthly absences follow each staff member\'s setting in the Staff tab. Paid payslips are locked.')}</p>`;

  $('pyAdvanceBtn').onclick = () => openAdvance(null);
  box.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    state.preset = b.dataset.preset; [state.from, state.to] = presetRange(state.preset); renderPayroll();
  });
  const onDates = () => {
    const f = $('pyFrom').value, to = $('pyTo').value;
    if (!f || !to || to < f) { toast(t('"To" date must be after "From".'), 'error'); return; }
    state.preset = 'tersuai'; state.from = f; state.to = to; renderPayroll();
  };
  $('pyFrom').onchange = onDates; $('pyTo').onchange = onDates;

  const ids = employees.map(e => e.id);
  if (!ids.length) { $('pyList').innerHTML = emptyStaff(); $('pyTotal').innerHTML = ''; return; }
  const [att, pr, adv, paidAdv] = await Promise.all([
    sb.from('attendance').select('employee_id,work_date,status,ot_hours').gte('work_date', state.from).lte('work_date', state.to).in('employee_id', ids),
    // Semua slip yang BERTINDIH dengan tempoh ini (contoh slip mingguan dalam paparan bulanan).
    sb.from('payroll').select('*').lte('period_start', state.to).gte('period_end', state.from).in('employee_id', ids).order('period_start'),
    sb.from('salary_advances').select('employee_id,amount,advance_date,note,created_at').in('employee_id', ids).order('created_at', { ascending: false }),
    sb.from('payroll').select('employee_id,advance_deduction').eq('status', 'dibayar').in('employee_id', ids)
  ]);
  if (v !== payrollVersion) return;   // pengguna dah tukar tempoh; abaikan hasil lama
  if (att.error || pr.error || adv.error || paidAdv.error) { $('pyList').innerHTML = `<div class="empty">${t('Could not load payroll data.')}</div>`; return; }
  // Slip tempoh ini (sama tepat: draf/dibayar) dan slip DIBAYAR lain yang bertindih.
  const exactOf = new Map(), paidOther = new Map();
  (pr.data || []).forEach(p => {
    if (p.period_start === state.from && p.period_end === state.to) exactOf.set(p.employee_id, p);
    else if (p.status === 'dibayar') paidOther.set(p.employee_id, [...(paidOther.get(p.employee_id) || []), p]);
  });
  // Baki advance belum ditolak (sen) = semua advance − yang sudah ditolak dalam gaji dibayar
  const balance = new Map();
  (adv.data || []).forEach(a => balance.set(a.employee_id, (balance.get(a.employee_id) || 0) + cents(a.amount)));
  (paidAdv.data || []).forEach(p => balance.set(p.employee_id, (balance.get(p.employee_id) || 0) - cents(p.advance_deduction)));

  const allDays = [];
  for (let d = state.from; d <= state.to; d = addDays(d, 1)) allDays.push(d);
  const paidRow = (e, slip) => ({ e, slip, paid: true, from: slip.period_start, to: slip.period_end,
    days: Number(slip.days_worked), ot: Number(slip.ot_hours), absent: 0,
    base: cents(slip.base_amount), otAmt: cents(slip.ot_amount), allow: cents(slip.allowance), ded: cents(slip.deduction),
    absDays: Number(slip.absent_days || 0), absDed: cents(slip.absent_deduction), absFull: cents(slip.absent_deduction),
    adv: cents(slip.advance_deduction), bal: Math.max(0, balance.get(e.id) || 0), net: cents(slip.net_amount),
    weeks: weeksIn(slip.period_start, slip.period_end), rate: Number(slip.rate), otRate: Number(slip.ot_rate), payType: slip.pay_type });

  // Kira dalam sen supaya tiada ralat pecahan.
  const rows = [];
  employees.forEach(e => {
    const others = paidOther.get(e.id) || [];
    const exact = exactOf.get(e.id);
    if (!e.active && !exact && !others.length) return;
    others.forEach(sl => rows.push(paidRow(e, sl)));
    if (exact?.status === 'dibayar') { rows.push(paidRow(e, exact)); return; }

    // Hari yang sudah dibayar dalam slip lain tidak dikira lagi (elak bayar dua kali).
    const covered = new Set(allDays.filter(d => others.some(sl => d >= sl.period_start && d <= sl.period_end)));
    const openDays = allDays.length - covered.size;
    if (covered.size && !openDays && !exact) return;          // semua hari dah dibayar
    const mine = (att.data || []).filter(a => a.employee_id === e.id && !covered.has(a.work_date));
    const days = mine.reduce((acc, a) => acc + DAY_VALUE[a.status], 0);
    const ot = mine.reduce((acc, a) => acc + Number(a.ot_hours), 0);
    const absent = mine.filter(a => a.status === 'tidak_hadir').length;
    const absDays = absentRuleOf(e) === 'penuh' ? 0 : mine.reduce((acc, a) => acc + (ABSENT_VALUE[a.status] || 0), 0);
    const absFull = Math.round(absDays * absentPerDay(e));
    const weeks = covered.size ? Math.round(openDays / 7 * 100) / 100 : weeksIn(state.from, state.to);
    const base = e.pay_type === 'harian' ? Math.round(days * cents(e.rate))
      : e.pay_type === 'mingguan' ? Math.round(weeks * cents(e.rate))
      : monthlyBase(cents(e.rate), allDays.filter(d => !covered.has(d)), state.from, state.to);
    const otAmt = Math.round(ot * cents(e.ot_rate));
    if (covered.size && !exact && base + otAmt === 0) return;  // baki hari tiada gaji
    const allow = cents(exact?.allowance), ded = cents(exact?.deduction);
    const bal = Math.max(0, balance.get(e.id) || 0);
    rows.push(recalc({ e, slip: exact, paid: false, from: state.from, to: state.to, partial: covered.size ? openDays : 0,
      days, ot, absent, absDays, absFull, absDed: 0, weeks, base, otAmt, allow, ded, bal, rate: Number(e.rate), otRate: Number(e.ot_rate), payType: e.pay_type }));
  });

  const total = rows.reduce((acc, r) => acc + r.net, 0);
  const paid = rows.filter(r => r.paid).reduce((acc, r) => acc + r.net, 0);
  $('pyTotal').innerHTML = `<span>${t('Total payroll {d}', { d: esc(dateRange(state.from, state.to)) })}</span><b>${rm(fromCents(total))}</b>`;
  const overlap = rows.filter(r => r.from !== state.from || r.to !== state.to).length;
  $('pyPaid').textContent = `${t('Paid')} ${rm(fromCents(paid))} · ${t('Unpaid')} ${rm(fromCents(total - paid))}`
    + (overlap ? ' · ' + t(overlap === 1 ? 'includes {n} payslip from other pay periods that overlap these dates'
      : 'includes {n} payslips from other pay periods that overlap these dates', { n: overlap }) : '');
  if (!rows.length) { $('pyList').innerHTML = emptyStaff(); return; }
  $('pyPdfBtns').hidden = false;
  $('pyPdfAll').onclick = () => makePdf(rows, `Payslips_All_${state.from}_${state.to}.pdf`, t('{n} payslips', { n: rows.length }));
  // Kumpulan slip ikut pekerja (baris pekerja sama sentiasa bersebelahan).
  const groups = [];
  rows.forEach((r, i) => {
    const g = groups.at(-1);
    if (g && g.e.id === r.e.id) g.idx.push(i); else groups.push({ e: r.e, idx: [i] });
  });
  const listOf = g => g.idx.map(i => rows[i]);
  $('pyPdfCombo').onclick = () => makePdf(groups.map(listOf), `Payslips_Combined_${state.from}_${state.to}.pdf`,
    t(groups.length === 1 ? '{n} combined payslip' : '{n} combined payslips', { n: groups.length }), comboData);

  $('pyList').innerHTML = rows.map((r, i) => {
    const st = r.paid ? `<span class="pill ok">${t('Paid')}</span>` : r.slip ? `<span class="pill rendah">${t('Draft')}</span>` : `<span class="pill">${t('Not saved')}</span>`;
    const absentNote = r.absent && !r.absFull ? ` (${t('{n} days absent', { n: r.absent })})` : '';
    const absLine = r.absFull
      ? `<div class="kv"><span>${t('Absent deduction ({n} days)', { n: r.absDays })}</span><b class="neg" data-absded>−${rm(fromCents(r.absDed))}</b></div>` : '';
    const baseLine = r.payType === 'harian'
      ? `<div class="kv"><span>${t('{n} days × {r}', { n: r.days, r: rm(r.rate) })}</span><b>${rm(fromCents(r.base))}</b></div>`
      : r.payType === 'mingguan'
      ? `<div class="kv"><span>${t('{n} weeks × {r}', { n: r.weeks, r: rm(r.rate) })}${absentNote}</span><b>${rm(fromCents(r.base))}</b></div>`
      : `<div class="kv"><span>${r.base === cents(r.rate) ? t('Monthly salary') : t('Monthly salary (pro-rated, {r}/month)', { r: rm(r.rate) })}${absentNote}</span><b>${rm(fromCents(r.base))}</b></div>`;
    const advLine = (r.adv || r.bal)
      ? `<div class="kv"><span>${t('Advance deduction')}${r.paid ? '' : ` (${t('balance')} ${rm(fromCents(r.bal))})`}</span><b class="neg" data-adv>−${rm(fromCents(r.adv))}</b></div>` : '';
    const own = r.from !== state.from || r.to !== state.to;
    const g = groups.find(x => x.idx[0] === i && x.idx.length > 1);
    const combo = g ? `<div class="combo-bar" data-combo="${groups.indexOf(g)}">
        <div><b>${esc(r.e.name)}</b><span>${t('{n} payslips', { n: g.idx.length })} · ${rm(fromCents(listOf(g).reduce((acc, x) => acc + x.net, 0)))}</span></div>
        <div class="combo-actions"><button class="btn ghost" type="button" data-combo-pdf>${icon('download')}${t('1 combined slip')}</button>
        <button class="btn ghost" type="button" data-combo-copy>${t('Copy')}</button></div></div>` : '';
    return `${combo}<section class="card slip" data-row="${i}">
      <div class="emp-head"><div><b>${esc(r.e.name)}</b><span class="sub">${esc(outletName(r.e.outlet_id))}${r.e.is_manager ? ' · ' + t('Management level') : ''}${own ? ' · ' + esc(dateRange(r.from, r.to)) : ''}</span></div>${st}</div>
      ${r.partial ? `<p class="note-line small">${icon('lock')}${t(r.partial === 1 ? 'Only {n} day not covered by paid payslips is counted.' : 'Only {n} days not covered by paid payslips are counted.', { n: r.partial })}</p>` : ''}
      <div class="kv-list">
        ${baseLine}
        <div class="kv"><span>${t('OT {n} hrs × {r}', { n: r.ot, r: rm(r.otRate) })}</span><b>${rm(fromCents(r.otAmt))}</b></div>
        ${r.paid
          ? `<div class="kv"><span>${t('Allowance')}</span><b>${rm(fromCents(r.allow))}</b></div><div class="kv"><span>${t('Deduction')}</span><b class="neg">−${rm(fromCents(r.ded))}</b></div>`
          : `<div class="two"><label class="field">${t('Allowance (RM)')}<input type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(r.allow)}" data-allow></label>
              <label class="field">${t('Deduction (RM)')}<input type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(r.ded)}" data-ded></label></div>`}
        ${absLine}
        ${advLine}
      </div>
      <div class="kv total"><span>${t('Total')}</span><b data-net>${rm(fromCents(r.net))}</b></div>
      ${r.paid ? `<p class="greet-sub">${t('Paid')} ${esc(new Date(r.slip.paid_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }))} · ${t('recorded as "Staff Wages"')}</p>` : ''}
      <div class="dialog-actions">
        <button class="btn ghost" type="button" data-pdf>${icon('download')}PDF</button>
        <button class="btn ghost" type="button" data-copy>${t('Copy payslip')}</button>
        ${r.e.active && !r.paid ? `<button class="btn ghost" type="button" data-advance>${t('+ Advance')}</button>` : ''}
        ${r.paid ? '' : `<button class="btn ghost" type="button" data-draft>${t('Save draft')}</button><button class="btn primary" type="button" data-pay>${t('Pay')}</button>`}
      </div>
    </section>`;
  }).join('');

  const rowOf = el => rows[Number(el.closest('[data-row]').dataset.row)];
  const readExtras = card => {
    const a = Number(card.querySelector('[data-allow]')?.value || 0), d = Number(card.querySelector('[data-ded]')?.value || 0);
    return (a >= 0 && d >= 0) ? { allow: Math.round(a * 100), ded: Math.round(d * 100) } : null;
  };
  $('pyList').addEventListener('input', e => {
    if (!e.target.matches('[data-allow],[data-ded]')) return;
    const card = e.target.closest('[data-row]'), r = rowOf(card), x = readExtras(card);
    if (!x) return;
    r.allow = x.allow; r.ded = x.ded; recalc(r);
    card.querySelector('[data-net]').textContent = rm(fromCents(r.net));
    const advEl = card.querySelector('[data-adv]');
    if (advEl) advEl.textContent = '−' + rm(fromCents(r.adv));
    const absEl = card.querySelector('[data-absded]');
    if (absEl) absEl.textContent = '−' + rm(fromCents(r.absDed));
  });

  async function saveDraft(r) {
    const payload = {
      employee_id: r.e.id, period_start: state.from, period_end: state.to, pay_type: r.payType,
      rate: r.rate, days_worked: r.days, ot_hours: r.ot, ot_rate: r.otRate,
      base_amount: fromCents(r.base), ot_amount: fromCents(r.otAmt), allowance: fromCents(r.allow), deduction: fromCents(r.ded),
      absent_days: r.absDays || 0, absent_deduction: fromCents(r.absDed || 0)
    };
    const res = r.slip
      ? await sb.from('payroll').update(payload).eq('id', r.slip.id).select('id').maybeSingle()
      : await sb.from('payroll').insert(payload).select('id').maybeSingle();
    if (res.error || !res.data) { toast(t('Could not save draft: ') + errText(res.error), 'error'); return null; }
    r.slip = { ...(r.slip || {}), id: res.data.id, status: 'draf' };
    return res.data.id;
  }

  $('pyList').addEventListener('click', async e => {
    const cb = e.target.closest('[data-combo] button');
    if (cb) {
      const list = listOf(groups[Number(cb.closest('[data-combo]').dataset.combo)]);
      if (cb.matches('[data-combo-pdf]')) {
        makePdf([list], `Payslip_${list[0].e.name}_${state.from}_${state.to}_combined.pdf`, t('Combined payslip {x}', { x: list[0].e.name }), comboData);
        return;
      }
      const d = comboData(list);
      const lines = [`${t('PAYSLIP (COMBINED)')} — ${d.business}${d.regNo ? ` (${d.regNo})` : ''}`, ...d.info.map(([k, v]) => `${t(k)}: ${v}`),
        ...d.items.map(([k, v]) => `${k}: ${v}`), `${t('TOTAL')}: ${d.total}`, `${t('Status:')} ${d.status}`];
      try { await navigator.clipboard.writeText(lines.join('\n')); toast(t('Combined payslip copied. Paste into WhatsApp.')); }
      catch { toast(t('Copy failed.'), 'error'); }
      return;
    }
    const btn = e.target.closest('button');
    if (!btn || !btn.closest('[data-row]')) return;
    const card = btn.closest('[data-row]'), r = rowOf(card);
    if (btn.matches('[data-copy]')) {
      const d = slipData(r);
      const lines = [`${t('PAYSLIP')} — ${d.business}${d.regNo ? ` (${d.regNo})` : ''}`, ...d.info.map(([k, v]) => `${t(k)}: ${v}`),
        ...d.items.map(([k, v]) => `${k}: ${v}`), `${t('TOTAL')}: ${d.total}`, `${t('Status:')} ${d.status}`];
      try { await navigator.clipboard.writeText(lines.join('\n')); toast(t('Payslip copied. Paste into WhatsApp.')); }
      catch { toast(t('Copy failed.'), 'error'); }
      return;
    }
    if (btn.matches('[data-pdf]')) {
      makePdf([r], `Payslip_${r.e.name}_${r.from}_${r.to}.pdf`, `Payslip ${r.e.name}`);
      return;
    }
    if (btn.matches('[data-advance]')) { openAdvance(r.e.id); return; }
    if (!readExtras(card)) { toast(t('Allowance and deduction must be 0 or more.'), 'error'); return; }
    if (btn.matches('[data-draft]')) {
      btn.disabled = true;
      if (await saveDraft(r)) { toast(t('Draft saved.')); renderPayroll(); }
      btn.disabled = false;
      return;
    }
    if (btn.matches('[data-pay]')) {
      if (r.net <= 0 && r.adv <= 0) { toast(t('Total is RM 0, nothing to pay.'), 'error'); return; }
      const methods = await loadPayMethods();
      $('payInfo').textContent = `${r.e.name} · ${dateRange(r.from, r.to)} · ${rm(fromCents(r.net))}` + (r.adv ? ` (${t('after advance deduction {a}', { a: rm(fromCents(r.adv)) })})` : '');
      $('payMethod').replaceChildren(...methods.map(m => new Option(m, m)));
      $('payDialog').dataset.row = rows.indexOf(r);
      $('payDialog').showModal();
    }
  });

  $('payConfirm').onclick = async () => {
    const r = rows[Number($('payDialog').dataset.row)];
    if (!r) return;
    $('payConfirm').disabled = true;
    const id = await saveDraft(r);            // simpan nilai terkini dahulu
    if (!id) { $('payConfirm').disabled = false; return; }
    const { error } = await sb.rpc('pay_payroll', { p_payroll: id, p_payment_method: $('payMethod').value });
    $('payConfirm').disabled = false;
    if (error) { toast(t('Payment failed: ') + errText(error), 'error'); return; }
    $('payDialog').close();
    toast(r.net > 0 ? t("{x}'s salary paid and recorded as Staff Wages.", { x: r.e.name }) : t("{x}'s salary is fully covered by advance.", { x: r.e.name }));
    renderPayroll();
  };

  // Senarai advance dalam tempoh ini
  const inPeriod = (adv.data || []).filter(a => a.advance_date >= state.from && a.advance_date <= state.to);
  const empName = id => employees.find(x => x.id === id)?.name || '-';
  $('pyAdvances').innerHTML = `<summary>${t('Advances in this period ({n})', { n: inPeriod.length })} · ${rm(fromCents(inPeriod.reduce((acc, a) => acc + cents(a.amount), 0)))}</summary>
    ${inPeriod.length ? inPeriod.map(a => `<div class="kv"><span>${esc(new Date(a.advance_date + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' }))} · ${esc(empName(a.employee_id))}${a.note ? ' · ' + esc(a.note) : ''}</span><b>${rm(a.amount)}</b></div>`).join('')
      : `<p class="note">${t('No advances in this period.')}</p>`}`;
}

// ================= Dialog =================
function dialogsHTML() {
  const outletSel = session.isOwner && session.outlets.length > 1
    ? `<label class="field">${t('Outlet')}<select id="empOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `
  <dialog id="empDialog"><form id="empForm" class="stack" novalidate>
    <h2 id="empTitle">${t('Add staff')}</h2>
    <label class="field">${t('Name')}<input id="empName" maxlength="120" autocomplete="off"></label>
    <div class="two">
      <label class="field">${t('Position')}<input id="empPosition" maxlength="60" placeholder="${t('Optional')}"></label>
      <label class="field">${t('Phone')}<input id="empPhone" type="tel" maxlength="20" placeholder="${t('Optional')}"></label>
    </div>
    ${outletSel}
    <div class="two">
      <label class="field">${t('Pay type')}<select id="empPayType"><option value="harian">${t('Daily')}</option><option value="mingguan">${t('Weekly')}</option><option value="bulanan">${t('Monthly')}</option></select></label>
      <label class="field" id="empRateLabel">${t('Daily wage (RM)')}<input id="empRate" type="number" inputmode="decimal" min="0" step="0.01"></label>
    </div>
    <label class="field">${t('OT rate per hour (RM)')}<input id="empOt" type="number" inputmode="decimal" min="0" step="0.01" value="0"></label>
    <fieldset class="field plain" id="empAbsBox">
      <legend>${t('If absent')}</legend>
      <select id="empAbsRule" aria-label="${t('If absent')}">${Object.entries(ABSENT_RULES).map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('')}</select>
      <label class="field" id="empAbsDaysWrap">${t('Working days per month')}<input id="empAbsDays" type="number" inputmode="numeric" min="1" max="31" step="1"></label>
      <label class="field" id="empAbsAmtWrap">${t('Deduction per absent day (RM)')}<input id="empAbsAmt" type="number" inputmode="decimal" min="0" step="0.01"></label>
      <p class="note small" id="empAbsHint"></p>
    </fieldset>
    ${session.isAdminUp ? `<label class="check"><input type="checkbox" id="empManager"> ${t('Management level')} <small>${t('(pay visible to owner &amp; admin only)')}</small></label>` : ''}
    <label class="check" id="empActiveWrap"><input type="checkbox" id="empActive" checked> ${t('Still working (active)')}</label>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="empDialog">${t('Cancel')}</button><button class="btn primary" id="empSave">${t('Save')}</button></div>
  </form></dialog>

  <dialog id="advDialog"><form id="advForm" class="stack" novalidate>
    <h2>${t('Give advance (early pay)')}</h2>
    <label class="field">${t('Staff')}<select id="advEmp"></select></label>
    <label class="field">${t('Amount (RM)')}<input id="advAmount" type="number" inputmode="decimal" min="0.01" step="0.01"></label>
    <label class="field">${t('Payment method')}<select id="advMethod"></select></label>
    <label class="field">${t('Note')}<input id="advNote" maxlength="120" placeholder="${t('Optional, e.g. house rent')}"></label>
    <p class="note">${t('The advance is recorded as "Staff Wages" today and deducted automatically at payday. It cannot be changed after saving.')}</p>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="advDialog">${t('Cancel')}</button><button class="btn primary" id="advSave">${t('Save advance')}</button></div>
  </form></dialog>

  <dialog id="pdfDialog">
    <div class="stack">
      <h2>${t('PDF payslip ready')}</h2>
      <p class="note" id="pdfInfo"></p>
      <button class="btn primary block" type="button" id="pdfShare">${t('Share (WhatsApp, email…)')}</button>
      <button class="btn ghost block" type="button" id="pdfDownload">${t('Download')}</button>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-close="pdfDialog">${t('Close')}</button></div>
    </div>
  </dialog>

  <dialog id="payDialog">
    <div class="stack">
      <h2>${t('Pay salary')}</h2>
      <p class="greet-sub" id="payInfo"></p>
      <label class="field">${t('Payment method')}<select id="payMethod"></select></label>
      <p class="note">${t('The salary will be recorded as a "Staff Wages" transaction today, and this payslip will be locked.')}</p>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-close="payDialog">${t('Cancel')}</button><button class="btn primary" type="button" id="payConfirm">${t('Confirm payment')}</button></div>
    </div>
  </dialog>`;
}

async function openAdvance(empId) {
  const list = employees.filter(e => e.active);
  if (!list.length) { toast(t('No active staff.'), 'error'); return; }
  $('advEmp').replaceChildren(...list.map(e => new Option(e.name + (session.outlets.length > 1 ? ' · ' + outletName(e.outlet_id) : ''), e.id)));
  if (empId) $('advEmp').value = empId;
  $('advMethod').replaceChildren(...(await loadPayMethods()).map(m => new Option(m, m)));
  $('advForm').reset();
  if (empId) $('advEmp').value = empId;
  $('advDialog').showModal();
  $('advAmount').focus();
}

async function saveAdvance(e) {
  e.preventDefault();
  const amount = Number($('advAmount').value);
  if (!(amount > 0)) { toast(t('Enter an advance amount above RM 0.'), 'error'); return; }
  const name = employees.find(x => x.id === $('advEmp').value)?.name || '';
  if (!confirm(t('Give an advance of {a} to {x}? It cannot be changed after saving.', { a: rm(amount), x: name }))) return;
  $('advSave').disabled = true;
  const { error } = await sb.rpc('give_advance', {
    p_employee: $('advEmp').value, p_amount: Math.round(amount * 100) / 100,
    p_payment_method: $('advMethod').value, p_note: $('advNote').value.trim() || null
  });
  $('advSave').disabled = false;
  if (error) { toast(t('Could not save advance: ') + errText(error), 'error'); return; }
  $('advDialog').close();
  toast(t('Advance of {a} for {x} recorded.', { a: rm(amount), x: name }));
  if (state.tab === 'gaji') renderPayroll();
}

function bindDialogs(view) {
  $('pdfDownload').onclick = downloadPdf;
  $('pdfShare').onclick = sharePdf;
  $('advForm').addEventListener('submit', saveAdvance);
  view.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
  ['empPayType', 'empAbsRule'].forEach(id => $(id).addEventListener('change', syncRateLabel));
  ['empRate', 'empAbsDays', 'empAbsAmt'].forEach(id => $(id).addEventListener('input', syncRateLabel));
  $('empForm').addEventListener('submit', saveEmployee);
}
