// Pekerja: Kehadiran harian, senarai pekerja, payroll ringkas.
// Owner: semua pekerja. Manager: pekerja outlet sendiri yang bukan peringkat pengurus.
// Semua sekatan ini dikuatkuasa di database; UI hanya menyusun paparan.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, addDays, endOfMonth, dateRange, dateLong } from '../format.js';

const STATUS = { hadir: 'Hadir', separuh: 'Separuh', cuti: 'Cuti', tidak_hadir: 'Tidak hadir' };
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
const PAY_TYPE = { harian: ['Harian', '/hari', 'Gaji sehari (RM)'], mingguan: ['Mingguan', '/minggu', 'Gaji seminggu (RM)'], bulanan: ['Bulanan', '/bulan', 'Gaji sebulan (RM)'] };
const payLabel = e => `${PAY_TYPE[e.pay_type][0]} ${rm(e.rate)}${PAY_TYPE[e.pay_type][1]}${Number(e.ot_rate) ? ' · OT ' + rm(e.ot_rate) + '/jam' : ''}`;
// Bilangan minggu dalam tempoh (contoh 7 hari = 1, 30 hari = 4.29)
const weeksIn = (from, to) => Math.round(((new Date(to) - new Date(from)) / 86400000 + 1) / 7 * 100) / 100;
const errText = e => e?.message || 'Ralat tidak diketahui.';

async function loadEmployees() {
  let q = sb.from('employees').select('id,outlet_id,name,position,phone,pay_type,rate,ot_rate,is_manager,active').order('name');
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
  const t = todayKL();
  if (preset === 'bulan_lepas') { const s = addDays(t.slice(0, 7) + '-01', -1).slice(0, 7) + '-01'; return [s, endOfMonth(s)]; }
  if (preset === 'minggu_ini') { const dow = new Date(t + 'T00:00:00Z').getUTCDay(); const s = addDays(t, -((dow + 6) % 7)); return [s, addDays(s, 6)]; }
  const s = t.slice(0, 7) + '-01'; return [s, endOfMonth(s)];
}

// ================= Halaman =================
export default {
  subtitle: 'Kehadiran dan gaji pekerja.',
  async render(view) {
    state.tab = tabFromHash();
    state.date = state.date || todayKL();
    if (!state.from) [state.from, state.to] = presetRange(state.preset);
    const tabs = { kehadiran: 'Kehadiran', pekerja: 'Pekerja', gaji: 'Gaji' };
    view.innerHTML = `
      <div class="seg tabs" role="tablist">${Object.entries(tabs).map(([k, v]) =>
        `<a class="seg-opt ${state.tab === k ? 'on' : ''}" href="#/pekerja?t=${k}" role="tab" aria-selected="${state.tab === k}">${v}</a>`).join('')}</div>
      <div id="pkBody"><section class="card"><p class="greet-sub">Memuatkan…</p></section></div>
      ${dialogsHTML()}`;
    bindDialogs(view);
    try { await loadEmployees(); }
    catch { $('pkBody').innerHTML = '<div class="empty">Senarai pekerja tak dapat dibaca. Semak internet dan cuba lagi.</div>'; return; }
    if (state.tab === 'pekerja') return renderStaffList();
    if (state.tab === 'gaji') return renderPayroll();
    return renderAttendance();
  }
};

// ================= Kehadiran =================
async function renderAttendance() {
  const box = $('pkBody');
  const active = employees.filter(e => e.active);
  box.innerHTML = `
    <section class="card stack">
      <label class="field">Tarikh<input id="atDate" type="date" max="${todayKL()}" value="${state.date}"></label>
      <p class="greet-sub" id="atSummary"></p>
      <button class="btn ghost block" id="atAll" type="button">Tanda semua yang belum: Hadir</button>
    </section>
    <div id="atList" class="list"></div>`;
  if (!active.length) { $('atList').innerHTML = emptyStaff(); $('atAll').hidden = true; return; }

  let marks = new Map();
  async function load() {
    const { data, error } = await sb.from('attendance').select('employee_id,status,ot_hours')
      .eq('work_date', state.date).in('employee_id', active.map(e => e.id));
    if (error) { toast('Kehadiran tak dapat dibaca.', 'error'); return; }
    marks = new Map((data || []).map(a => [a.employee_id, a]));
    draw();
  }
  function draw() {
    $('atList').innerHTML = active.map(e => {
      const m = marks.get(e.id);
      return `<div class="card emp" data-emp="${esc(e.id)}">
        <div class="emp-head"><div><b>${esc(e.name)}</b><span class="sub">${esc([e.position, session.outletId === ALL_OUTLETS ? outletName(e.outlet_id) : ''].filter(Boolean).join(' · '))}</span></div>
          <label class="ot">OT<input type="number" inputmode="decimal" min="0" max="24" step="0.5" value="${m ? Number(m.ot_hours) : 0}" data-ot="${esc(e.id)}" aria-label="Jam OT ${esc(e.name)}">jam</label></div>
        <div class="chips st">${Object.entries(STATUS).map(([k, v]) =>
          `<button type="button" class="chip ${k} ${m?.status === k ? 'on' : ''}" data-status="${k}" data-id="${esc(e.id)}" aria-pressed="${m?.status === k}">${v}</button>`).join('')}</div>
      </div>`;
    }).join('');
    const count = k => [...marks.values()].filter(m => m.status === k).length;
    $('atSummary').textContent = `${dateLong(state.date)} · Hadir ${count('hadir')} · Separuh ${count('separuh')} · Cuti ${count('cuti')} · Tidak hadir ${count('tidak_hadir')} · Belum ditanda ${active.length - marks.size}`;
  }
  async function save(id, status, ot) {
    const { error } = await sb.from('attendance')
      .upsert({ employee_id: id, work_date: state.date, status, ot_hours: ot }, { onConflict: 'employee_id,work_date' });
    if (error) { toast('Gagal simpan: ' + errText(error), 'error'); return false; }
    marks.set(id, { employee_id: id, status, ot_hours: ot });
    return true;
  }

  $('atList').addEventListener('click', async e => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    const id = b.dataset.id, cur = marks.get(id);
    if (cur?.status === b.dataset.status) {          // tekan sekali lagi = buang tanda
      const { error } = await sb.from('attendance').delete().eq('employee_id', id).eq('work_date', state.date);
      if (error) { toast('Gagal buang tanda.', 'error'); return; }
      marks.delete(id); draw(); return;
    }
    if (await save(id, b.dataset.status, Number(cur?.ot_hours || 0))) draw();
  });
  $('atList').addEventListener('change', async e => {
    const inp = e.target.closest('[data-ot]');
    if (!inp) return;
    const ot = Number(inp.value);
    if (!(ot >= 0 && ot <= 24)) { toast('Jam OT mesti antara 0 dan 24.', 'error'); inp.value = marks.get(inp.dataset.ot)?.ot_hours || 0; return; }
    const cur = marks.get(inp.dataset.ot);
    if (await save(inp.dataset.ot, cur?.status || 'hadir', ot)) { draw(); toast('OT disimpan.'); }
  });
  $('atDate').addEventListener('change', e => {
    if (!e.target.value || e.target.value > todayKL()) { e.target.value = state.date; return; }
    state.date = e.target.value; load();
  });
  $('atAll').onclick = async () => {
    const todo = active.filter(e => !marks.has(e.id));
    if (!todo.length) { toast('Semua pekerja sudah ditanda.'); return; }
    const { error } = await sb.from('attendance').upsert(
      todo.map(e => ({ employee_id: e.id, work_date: state.date, status: 'hadir', ot_hours: 0 })), { onConflict: 'employee_id,work_date' });
    if (error) { toast('Gagal tanda: ' + errText(error), 'error'); return; }
    toast(`${todo.length} pekerja ditanda Hadir.`);
    load();
  };
  await load();
}

function emptyStaff() {
  return '<div class="empty">Belum ada pekerja.<br>Buka tab <b>Pekerja</b> dan tekan <b>+ Tambah pekerja</b>.</div>';
}

// ================= Senarai pekerja =================
function renderStaffList() {
  const box = $('pkBody');
  const sorted = [...employees].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'ms-MY'));
  box.innerHTML = `
    <div class="section-row"><h2 class="section-title">${employees.length} pekerja</h2><button class="btn white" id="empAdd" type="button">+ Tambah pekerja</button></div>
    <div class="list" id="empList">${sorted.length ? sorted.map(e => `
      <button type="button" class="row-btn emp-row ${e.active ? '' : 'inactive'}" data-edit="${esc(e.id)}">
        ${icon('user')}<span>${esc(e.name)}${e.is_manager ? ' <i class="tag">Peringkat pengurus</i>' : ''}${e.active ? '' : ' <i class="tag off">Tidak aktif</i>'}
        <small>${esc([e.position, outletName(e.outlet_id), payLabel(e)].filter(Boolean).join(' · '))}</small></span>${icon('chev-right')}
      </button>`).join('') : emptyStaff().replace('Buka tab <b>Pekerja</b> dan tekan', 'Tekan')}</div>
    ${session.isOwner ? '' : '<p class="note-line small">' + icon('lock') + 'Pekerja peringkat pengurus hanya diurus oleh owner.</p>'}`;
  $('empAdd').onclick = () => openEmployee(null);
  $('empList').addEventListener('click', e => {
    const b = e.target.closest('[data-edit]');
    if (b) openEmployee(employees.find(x => x.id === b.dataset.edit));
  });
}

function openEmployee(emp) {
  $('empTitle').textContent = emp ? 'Ubah pekerja' : 'Tambah pekerja';
  $('empForm').dataset.id = emp?.id || '';
  $('empName').value = emp?.name || '';
  $('empPosition').value = emp?.position || '';
  $('empPhone').value = emp?.phone || '';
  if ($('empOutlet')) $('empOutlet').value = emp?.outlet_id || (session.outletId !== ALL_OUTLETS ? session.outletId : session.profile.outlet_id);
  $('empPayType').value = emp?.pay_type || 'harian';
  $('empRate').value = emp ? emp.rate : '';
  $('empOt').value = emp ? emp.ot_rate : 0;
  if ($('empManager')) $('empManager').checked = !!emp?.is_manager;
  $('empActiveWrap').hidden = !emp;
  $('empActive').checked = emp ? emp.active : true;
  syncRateLabel();
  $('empDialog').showModal();
}
function syncRateLabel() {
  $('empRateLabel').firstChild.textContent = PAY_TYPE[$('empPayType').value][2];
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
    active: $('empActive').checked
  };
  if ($('empManager')) payload.is_manager = $('empManager').checked;
  if (!payload.name) { toast('Isi nama pekerja.', 'error'); return; }
  if ($('empRate').value.trim() === '' || !(payload.rate >= 0) || !(payload.ot_rate >= 0)) { toast('Masukkan kadar gaji yang sah.', 'error'); return; }
  $('empSave').disabled = true;
  const res = id
    ? await sb.from('employees').update(payload).eq('id', id).select('id')
    : await sb.from('employees').insert(payload).select('id');
  $('empSave').disabled = false;
  if (res.error) { toast('Gagal simpan: ' + errText(res.error), 'error'); return; }
  if (!res.data?.length) { toast('Tiada perubahan disimpan. Anda mungkin tiada akses.', 'error'); return; }
  $('empDialog').close();
  toast(id ? 'Pekerja dikemas kini.' : 'Pekerja ditambah.');
  await loadEmployees();
  renderStaffList();
}

// ================= Gaji =================
// Advance ditolak automatik (maksimum = gaji kasar); lebihan dibawa ke gaji seterusnya.
function recalc(r) {
  const gross = Math.max(0, r.base + r.otAmt + r.allow - r.ded);
  r.adv = Math.min(r.bal, gross);
  r.net = gross - r.adv;
  return r;
}
// Data slip (satu sumber untuk teks WhatsApp dan PDF).
function slipData(r) {
  const money = c => rm(fromCents(c));
  const baseItem = r.payType === 'harian' ? [`Gaji harian (${r.days} hari × ${rm(r.rate)})`, money(r.base)]
    : r.payType === 'mingguan' ? [`Gaji mingguan (${r.weeks} minggu × ${rm(r.rate)})`, money(r.base)]
    : ['Gaji bulanan', money(r.base)];
  const items = [baseItem, [`OT (${r.ot} jam × ${rm(r.otRate)})`, money(r.otAmt)], ['Elaun', money(r.allow)], ['Potongan', '-' + money(r.ded)]];
  if (r.adv) items.push(['Tolak advance', '-' + money(r.adv)]);
  return {
    business: session.business?.name || 'BizProfit Pro',
    info: [['Nama', r.e.name], ...(r.e.position ? [['Jawatan', r.e.position]] : []), ['Outlet', outletName(r.e.outlet_id)],
      ['Tempoh', dateRange(state.from, state.to)]],
    items, total: money(r.net),
    status: r.paid ? `Dibayar ${new Date(r.slip.paid_at).toLocaleDateString('ms-MY', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : r.slip ? 'Draf (belum dibayar)' : 'Belum dibayar'
  };
}

// jsPDF dimuat hanya bila diperlukan (tidak melambatkan app).
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
function loadJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = JSPDF_URL;
    sc.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF')));
    sc.onerror = () => reject(new Error('jsPDF'));
    document.head.append(sc);
  });
}

// Fon asas PDF tiada simbol tolak (−); guna "-" biasa.
const pdfText = t => String(t).replace(/−/g, '-').replace(/—/g, '-');

function drawSlip(doc, d) {
  const W = 148, M = 12, R = W - M;
  const GREEN = [17, 90, 55], INK = [22, 28, 25], GREY = [95, 105, 100], LINE = [214, 221, 217];
  const fill = c => doc.setFillColor(...c), stroke = c => doc.setDrawColor(...c), color = c => doc.setTextColor(...c);

  // Kepala: nama perniagaan, tajuk SLIP GAJI dengan bar hijau, tempoh di kanan.
  color(INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(pdfText(d.business), M, 17, { maxWidth: W - M * 2 });
  fill(GREEN); doc.rect(M, 23, 1.6, 8.5, 'F');
  color(GREEN); doc.setFontSize(19); doc.text('SLIP GAJI', M + 5, 30.3);
  color(INK); doc.setFontSize(9.5);
  doc.text(pdfText(d.info.find(i => i[0] === 'Tempoh')[1]), R, 29.5, { align: 'right' });
  stroke(GREEN); doc.setLineWidth(0.8); doc.line(M, 35, R, 35);

  // Maklumat pekerja.
  let y = 45;
  doc.setFontSize(10);
  d.info.filter(i => i[0] !== 'Tempoh').forEach(([k, v]) => {
    doc.setFont('helvetica', 'normal'); color(GREY); doc.text(k, M + 1, y); doc.text(':', M + 29, y);
    doc.setFont('helvetica', 'bold'); color(INK); doc.text(pdfText(v), M + 35, y, { maxWidth: R - M - 35 });
    y += 6.5;
  });
  y += 1; stroke(LINE); doc.setLineWidth(0.3); doc.line(M, y, R, y); y += 7;

  // Jadual Perihal / Amaun.
  const split = R - 42, hH = 8.5, rH = 8.5;
  fill(GREEN); doc.rect(M, y, R - M, hH, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('Perihal', M + 4, y + 5.7); doc.text('Amaun (RM)', R - 4, y + 5.7, { align: 'right' });
  stroke([255, 255, 255]); doc.setLineWidth(0.3); doc.line(split, y, split, y + hH);
  y += hH;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); stroke(LINE);
  d.items.forEach(([k, v]) => {
    doc.rect(M, y, R - M, rH); doc.line(split, y, split, y + rH);
    color(INK); doc.text(pdfText(k), M + 4, y + 5.7, { maxWidth: split - M - 8 });
    doc.text(pdfText(v), R - 4, y + 5.7, { align: 'right' });
    y += rH;
  });
  const tH = 11;
  fill([230, 245, 236]); doc.rect(M, y, R - M, tH, 'FD');
  color([11, 60, 36]); doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
  doc.text('JUMLAH BERSIH', M + 4, y + 7.3);
  doc.setFontSize(13); doc.text(pdfText(d.total), R - 4, y + 7.5, { align: 'right' });
  y += tH + 8;

  // Status.
  color(INK); doc.setFontSize(10); doc.text('Status:', M, y);
  const sw = doc.getTextWidth('Status: ');
  doc.setFont('helvetica', 'normal'); doc.text(pdfText(d.status), M + sw, y);

  // Tandatangan dan kaki.
  const sy = 176;
  stroke([60, 70, 65]); doc.setLineWidth(0.3);
  doc.line(M + 1, sy, M + 50, sy); doc.line(R - 50, sy, R - 1, sy);
  color(INK); doc.setFontSize(9); doc.text('Tandatangan pekerja', M + 1, sy + 5.5); doc.text('Tandatangan majikan', R - 50, sy + 5.5);
  stroke([180, 188, 184]); doc.line(M - 2, 191, R + 2, 191);
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); color([110, 118, 114]);
  doc.text('Dijana oleh BizProfit Pro · ' + new Date().toLocaleString('ms-MY'), W / 2, 197, { align: 'center' });
}

let pdfFile = null;   // fail PDF terakhir, untuk dialog Muat turun / Kongsi

async function makePdf(list, filename, label) {
  let JsPDF;
  try { JsPDF = await loadJsPdf(); }
  catch { toast('PDF tidak dapat disediakan. Semak sambungan internet.', 'error'); return; }
  const doc = new JsPDF({ unit: 'mm', format: 'a5' });
  list.forEach((r, i) => { if (i) doc.addPage(); drawSlip(doc, slipData(r)); });
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
  toast('PDF dimuat turun. Semak folder Download.');
}

async function sharePdf() {
  if (!pdfFile) return;
  try { await navigator.share({ files: [pdfFile], title: pdfFile.name }); }
  catch (e) { if (e?.name !== 'AbortError') toast('Gagal kongsi. Cuba Muat turun.', 'error'); }
}

let payrollVersion = 0;   // hanya pemuatan terkini dipaparkan (elak paparan berganda)

async function renderPayroll() {
  const v = ++payrollVersion;
  const box = $('pkBody');
  box.innerHTML = `
    <section class="card stack">
      <div class="seg" role="group" aria-label="Tempoh gaji">
        ${[['bulan_ini', 'Bulan ini'], ['bulan_lepas', 'Bulan lepas'], ['minggu_ini', 'Minggu ini']].map(([k, v]) =>
          `<button type="button" class="seg-opt ${state.preset === k ? 'on' : ''}" data-preset="${k}">${v}</button>`).join('')}
      </div>
      <div class="two">
        <label class="field">Dari<input id="pyFrom" type="date" value="${state.from}"></label>
        <label class="field">Hingga<input id="pyTo" type="date" value="${state.to}"></label>
      </div>
      <div class="kv total" id="pyTotal"></div>
      <p class="greet-sub right" id="pyPaid"></p>
      <button class="btn ghost block" id="pyPdfAll" type="button" hidden>${icon('download')} PDF semua slip</button>
    </section>
    <details class="card adv-box" id="pyAdvances"></details>
    <button class="btn ghost block" id="pyAdvanceBtn" type="button">+ Beri advance (gaji awal)</button>
    <div id="pyList" class="list"><section class="card"><p class="greet-sub">Mengira…</p></section></div>
    <p class="note-line small">${icon('lock')}Gaji harian = hari hadir × kadar (separuh hari = 0.5). Gaji bulanan dibayar penuh; tolak ketidakhadiran secara manual dalam "Potongan". Slip yang sudah dibayar dikunci.</p>`;

  $('pyAdvanceBtn').onclick = () => openAdvance(null);
  box.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
    state.preset = b.dataset.preset; [state.from, state.to] = presetRange(state.preset); renderPayroll();
  });
  const onDates = () => {
    const f = $('pyFrom').value, t = $('pyTo').value;
    if (!f || !t || t < f) { toast('Tarikh "Hingga" mesti selepas "Dari".', 'error'); return; }
    state.preset = 'tersuai'; state.from = f; state.to = t; renderPayroll();
  };
  $('pyFrom').onchange = onDates; $('pyTo').onchange = onDates;

  const ids = employees.map(e => e.id);
  if (!ids.length) { $('pyList').innerHTML = emptyStaff(); $('pyTotal').innerHTML = ''; return; }
  const [att, pr, adv, paidAdv] = await Promise.all([
    sb.from('attendance').select('employee_id,status,ot_hours').gte('work_date', state.from).lte('work_date', state.to).in('employee_id', ids),
    sb.from('payroll').select('*').eq('period_start', state.from).eq('period_end', state.to).in('employee_id', ids),
    sb.from('salary_advances').select('employee_id,amount,advance_date,note,created_at').in('employee_id', ids).order('created_at', { ascending: false }),
    sb.from('payroll').select('employee_id,advance_deduction').eq('status', 'dibayar').in('employee_id', ids)
  ]);
  if (v !== payrollVersion) return;   // pengguna dah tukar tempoh; abaikan hasil lama
  if (att.error || pr.error || adv.error || paidAdv.error) { $('pyList').innerHTML = '<div class="empty">Data gaji tak dapat dibaca.</div>'; return; }
  const slips = new Map((pr.data || []).map(p => [p.employee_id, p]));
  // Baki advance belum ditolak (sen) = semua advance − yang sudah ditolak dalam gaji dibayar
  const balance = new Map();
  (adv.data || []).forEach(a => balance.set(a.employee_id, (balance.get(a.employee_id) || 0) + cents(a.amount)));
  (paidAdv.data || []).forEach(p => balance.set(p.employee_id, (balance.get(p.employee_id) || 0) - cents(p.advance_deduction)));

  // Kira dalam sen supaya tiada ralat pecahan.
  const rows = employees.filter(e => e.active || slips.has(e.id)).map(e => {
    const mine = (att.data || []).filter(a => a.employee_id === e.id);
    const days = mine.reduce((t, a) => t + DAY_VALUE[a.status], 0);
    const ot = mine.reduce((t, a) => t + Number(a.ot_hours), 0);
    const absent = mine.filter(a => a.status === 'tidak_hadir').length;
    const slip = slips.get(e.id);
    if (slip?.status === 'dibayar') {
      return { e, slip, paid: true, days: Number(slip.days_worked), ot: Number(slip.ot_hours), absent,
        base: cents(slip.base_amount), otAmt: cents(slip.ot_amount), allow: cents(slip.allowance), ded: cents(slip.deduction),
        adv: cents(slip.advance_deduction), bal: Math.max(0, balance.get(e.id) || 0), net: cents(slip.net_amount), weeks: weeksIn(slip.period_start, slip.period_end),
        rate: Number(slip.rate), otRate: Number(slip.ot_rate), payType: slip.pay_type };
    }
    const weeks = weeksIn(state.from, state.to);
    const base = e.pay_type === 'harian' ? Math.round(days * cents(e.rate))
      : e.pay_type === 'mingguan' ? Math.round(weeks * cents(e.rate)) : cents(e.rate);
    const otAmt = Math.round(ot * cents(e.ot_rate));
    const allow = cents(slip?.allowance), ded = cents(slip?.deduction);
    const bal = Math.max(0, balance.get(e.id) || 0);
    const r = { e, slip, paid: false, days, ot, absent, weeks, base, otAmt, allow, ded, bal,
      rate: Number(e.rate), otRate: Number(e.ot_rate), payType: e.pay_type };
    return recalc(r);
  });

  const total = rows.reduce((t, r) => t + r.net, 0);
  const paid = rows.filter(r => r.paid).reduce((t, r) => t + r.net, 0);
  $('pyTotal').innerHTML = `<span>Jumlah gaji ${esc(dateRange(state.from, state.to))}</span><b>${rm(fromCents(total))}</b>`;
  $('pyPaid').textContent = `Sudah dibayar ${rm(fromCents(paid))} · Belum ${rm(fromCents(total - paid))}`;
  if (!rows.length) { $('pyList').innerHTML = emptyStaff(); return; }
  $('pyPdfAll').hidden = false;
  $('pyPdfAll').onclick = () => makePdf(rows, `Slip-Gaji_Semua_${state.from}_${state.to}.pdf`, `${rows.length} slip gaji`);

  $('pyList').innerHTML = rows.map(r => {
    const st = r.paid ? '<span class="pill ok">Dibayar</span>' : r.slip ? '<span class="pill rendah">Draf</span>' : '<span class="pill">Belum disimpan</span>';
    const absentNote = r.absent ? ` (${r.absent} hari tidak hadir)` : '';
    const baseLine = r.payType === 'harian'
      ? `<div class="kv"><span>${r.days} hari × ${rm(r.rate)}</span><b>${rm(fromCents(r.base))}</b></div>`
      : r.payType === 'mingguan'
      ? `<div class="kv"><span>${r.weeks} minggu × ${rm(r.rate)}${absentNote}</span><b>${rm(fromCents(r.base))}</b></div>`
      : `<div class="kv"><span>Gaji bulanan${absentNote}</span><b>${rm(fromCents(r.base))}</b></div>`;
    const advLine = (r.adv || r.bal)
      ? `<div class="kv"><span>Tolak advance${r.paid ? '' : ` (baki ${rm(fromCents(r.bal))})`}</span><b class="neg" data-adv>−${rm(fromCents(r.adv))}</b></div>` : '';
    return `<section class="card slip" data-emp="${esc(r.e.id)}">
      <div class="emp-head"><div><b>${esc(r.e.name)}</b><span class="sub">${esc(outletName(r.e.outlet_id))}${r.e.is_manager ? ' · Peringkat pengurus' : ''}</span></div>${st}</div>
      <div class="kv-list">
        ${baseLine}
        <div class="kv"><span>OT ${r.ot} jam × ${rm(r.otRate)}</span><b>${rm(fromCents(r.otAmt))}</b></div>
        ${r.paid
          ? `<div class="kv"><span>Elaun</span><b>${rm(fromCents(r.allow))}</b></div><div class="kv"><span>Potongan</span><b class="neg">−${rm(fromCents(r.ded))}</b></div>`
          : `<div class="two"><label class="field">Elaun (RM)<input type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(r.allow)}" data-allow></label>
              <label class="field">Potongan (RM)<input type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(r.ded)}" data-ded></label></div>`}
        ${advLine}
      </div>
      <div class="kv total"><span>Jumlah</span><b data-net>${rm(fromCents(r.net))}</b></div>
      ${r.paid ? `<p class="greet-sub">Dibayar ${esc(new Date(r.slip.paid_at).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }))} · direkod sebagai "Staff Wages"</p>` : ''}
      <div class="dialog-actions">
        <button class="btn ghost" type="button" data-pdf>${icon('download')}PDF</button>
        <button class="btn ghost" type="button" data-copy>Copy slip</button>
        ${r.e.active ? '<button class="btn ghost" type="button" data-advance>+ Advance</button>' : ''}
        ${r.paid ? '' : '<button class="btn ghost" type="button" data-draft>Simpan draf</button><button class="btn primary" type="button" data-pay>Bayar</button>'}
      </div>
    </section>`;
  }).join('');

  const rowOf = el => rows.find(r => r.e.id === el.closest('[data-emp]').dataset.emp);
  const readExtras = card => {
    const a = Number(card.querySelector('[data-allow]')?.value || 0), d = Number(card.querySelector('[data-ded]')?.value || 0);
    return (a >= 0 && d >= 0) ? { allow: Math.round(a * 100), ded: Math.round(d * 100) } : null;
  };
  $('pyList').addEventListener('input', e => {
    if (!e.target.matches('[data-allow],[data-ded]')) return;
    const card = e.target.closest('[data-emp]'), r = rowOf(card), x = readExtras(card);
    if (!x) return;
    r.allow = x.allow; r.ded = x.ded; recalc(r);
    card.querySelector('[data-net]').textContent = rm(fromCents(r.net));
    const advEl = card.querySelector('[data-adv]');
    if (advEl) advEl.textContent = '−' + rm(fromCents(r.adv));
  });

  async function saveDraft(r) {
    const payload = {
      employee_id: r.e.id, period_start: state.from, period_end: state.to, pay_type: r.payType,
      rate: r.rate, days_worked: r.days, ot_hours: r.ot, ot_rate: r.otRate,
      base_amount: fromCents(r.base), ot_amount: fromCents(r.otAmt), allowance: fromCents(r.allow), deduction: fromCents(r.ded)
    };
    const res = r.slip
      ? await sb.from('payroll').update(payload).eq('id', r.slip.id).select('id').maybeSingle()
      : await sb.from('payroll').insert(payload).select('id').maybeSingle();
    if (res.error || !res.data) { toast('Gagal simpan draf: ' + errText(res.error), 'error'); return null; }
    r.slip = { ...(r.slip || {}), id: res.data.id, status: 'draf' };
    return res.data.id;
  }

  $('pyList').addEventListener('click', async e => {
    const btn = e.target.closest('button');
    if (!btn || !btn.closest('[data-emp]')) return;
    const card = btn.closest('[data-emp]'), r = rowOf(card);
    if (btn.matches('[data-copy]')) {
      const d = slipData(r);
      const lines = [`SLIP GAJI — ${d.business}`, ...d.info.map(([k, v]) => `${k}: ${v}`),
        ...d.items.map(([k, v]) => `${k}: ${v}`), `JUMLAH: ${d.total}`, `Status: ${d.status}`];
      try { await navigator.clipboard.writeText(lines.join('\n')); toast('Slip disalin. Tampal ke WhatsApp.'); }
      catch { toast('Gagal salin.', 'error'); }
      return;
    }
    if (btn.matches('[data-pdf]')) {
      makePdf([r], `Slip-Gaji_${r.e.name}_${state.from}_${state.to}.pdf`, `Slip gaji ${r.e.name}`);
      return;
    }
    if (btn.matches('[data-advance]')) { openAdvance(r.e.id); return; }
    if (!readExtras(card)) { toast('Elaun dan potongan mesti 0 atau lebih.', 'error'); return; }
    if (btn.matches('[data-draft]')) {
      btn.disabled = true;
      if (await saveDraft(r)) { toast('Draf disimpan.'); renderPayroll(); }
      btn.disabled = false;
      return;
    }
    if (btn.matches('[data-pay]')) {
      if (r.net <= 0 && r.adv <= 0) { toast('Jumlah RM 0, tiada apa untuk dibayar.', 'error'); return; }
      const methods = await loadPayMethods();
      $('payInfo').textContent = `${r.e.name} · ${dateRange(state.from, state.to)} · ${rm(fromCents(r.net))}` + (r.adv ? ` (selepas tolak advance ${rm(fromCents(r.adv))})` : '');
      $('payMethod').replaceChildren(...methods.map(m => new Option(m, m)));
      $('payDialog').dataset.emp = r.e.id;
      $('payDialog').showModal();
    }
  });

  $('payConfirm').onclick = async () => {
    const r = rows.find(x => x.e.id === $('payDialog').dataset.emp);
    if (!r) return;
    $('payConfirm').disabled = true;
    const id = await saveDraft(r);            // simpan nilai terkini dahulu
    if (!id) { $('payConfirm').disabled = false; return; }
    const { error } = await sb.rpc('pay_payroll', { p_payroll: id, p_payment_method: $('payMethod').value });
    $('payConfirm').disabled = false;
    if (error) { toast('Gagal bayar: ' + errText(error), 'error'); return; }
    $('payDialog').close();
    toast(r.net > 0 ? `Gaji ${r.e.name} dibayar dan direkod sebagai Staff Wages.` : `Gaji ${r.e.name} ditampung sepenuhnya oleh advance.`);
    renderPayroll();
  };

  // Senarai advance dalam tempoh ini
  const inPeriod = (adv.data || []).filter(a => a.advance_date >= state.from && a.advance_date <= state.to);
  const empName = id => employees.find(x => x.id === id)?.name || '-';
  $('pyAdvances').innerHTML = `<summary>Advance dalam tempoh ini (${inPeriod.length}) · ${rm(fromCents(inPeriod.reduce((t, a) => t + cents(a.amount), 0)))}</summary>
    ${inPeriod.length ? inPeriod.map(a => `<div class="kv"><span>${esc(new Date(a.advance_date + 'T00:00:00').toLocaleDateString('ms-MY', { day: 'numeric', month: 'short' }))} · ${esc(empName(a.employee_id))}${a.note ? ' · ' + esc(a.note) : ''}</span><b>${rm(a.amount)}</b></div>`).join('')
      : '<p class="note">Tiada advance dalam tempoh ini.</p>'}`;
}

// ================= Dialog =================
function dialogsHTML() {
  const outletSel = session.isOwner && session.outlets.length > 1
    ? `<label class="field">Outlet<select id="empOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `
  <dialog id="empDialog"><form id="empForm" class="stack" novalidate>
    <h2 id="empTitle">Tambah pekerja</h2>
    <label class="field">Nama<input id="empName" maxlength="120" autocomplete="off"></label>
    <div class="two">
      <label class="field">Jawatan<input id="empPosition" maxlength="60" placeholder="Pilihan"></label>
      <label class="field">Telefon<input id="empPhone" type="tel" maxlength="20" placeholder="Pilihan"></label>
    </div>
    ${outletSel}
    <div class="two">
      <label class="field">Jenis gaji<select id="empPayType"><option value="harian">Harian</option><option value="mingguan">Mingguan</option><option value="bulanan">Bulanan</option></select></label>
      <label class="field" id="empRateLabel">Gaji sehari (RM)<input id="empRate" type="number" inputmode="decimal" min="0" step="0.01"></label>
    </div>
    <label class="field">Kadar OT sejam (RM)<input id="empOt" type="number" inputmode="decimal" min="0" step="0.01" value="0"></label>
    ${session.isOwner ? '<label class="check"><input type="checkbox" id="empManager"> Peringkat pengurus <small>(gaji hanya owner nampak)</small></label>' : ''}
    <label class="check" id="empActiveWrap"><input type="checkbox" id="empActive" checked> Masih bekerja (aktif)</label>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="empDialog">Batal</button><button class="btn primary" id="empSave">Simpan</button></div>
  </form></dialog>

  <dialog id="advDialog"><form id="advForm" class="stack" novalidate>
    <h2>Beri advance (gaji awal)</h2>
    <label class="field">Pekerja<select id="advEmp"></select></label>
    <label class="field">Jumlah (RM)<input id="advAmount" type="number" inputmode="decimal" min="0.01" step="0.01"></label>
    <label class="field">Cara bayaran<select id="advMethod"></select></label>
    <label class="field">Nota<input id="advNote" maxlength="120" placeholder="Pilihan, contoh: duit sewa rumah"></label>
    <p class="note">Advance direkod sebagai "Staff Wages" hari ini, dan ditolak automatik masa bayar gaji. Tidak boleh diubah selepas disimpan.</p>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="advDialog">Batal</button><button class="btn primary" id="advSave">Simpan advance</button></div>
  </form></dialog>

  <dialog id="pdfDialog">
    <div class="stack">
      <h2>Slip PDF siap</h2>
      <p class="note" id="pdfInfo"></p>
      <button class="btn primary block" type="button" id="pdfShare">Kongsi (WhatsApp, emel…)</button>
      <button class="btn ghost block" type="button" id="pdfDownload">Muat turun</button>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-close="pdfDialog">Tutup</button></div>
    </div>
  </dialog>

  <dialog id="payDialog">
    <div class="stack">
      <h2>Bayar gaji</h2>
      <p class="greet-sub" id="payInfo"></p>
      <label class="field">Cara bayaran<select id="payMethod"></select></label>
      <p class="note">Gaji akan direkod sebagai transaksi "Staff Wages" hari ini, dan slip ini dikunci.</p>
      <div class="dialog-actions"><button class="btn ghost" type="button" data-close="payDialog">Batal</button><button class="btn primary" type="button" id="payConfirm">Sahkan bayar</button></div>
    </div>
  </dialog>`;
}

async function openAdvance(empId) {
  const list = employees.filter(e => e.active);
  if (!list.length) { toast('Tiada pekerja aktif.', 'error'); return; }
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
  if (!(amount > 0)) { toast('Masukkan jumlah advance lebih dari RM 0.', 'error'); return; }
  const name = employees.find(x => x.id === $('advEmp').value)?.name || '';
  if (!confirm(`Beri advance ${rm(amount)} kepada ${name}? Ia tidak boleh diubah selepas disimpan.`)) return;
  $('advSave').disabled = true;
  const { error } = await sb.rpc('give_advance', {
    p_employee: $('advEmp').value, p_amount: Math.round(amount * 100) / 100,
    p_payment_method: $('advMethod').value, p_note: $('advNote').value.trim() || null
  });
  $('advSave').disabled = false;
  if (error) { toast('Gagal simpan advance: ' + errText(error), 'error'); return; }
  $('advDialog').close();
  toast(`Advance ${rm(amount)} untuk ${name} direkod.`);
  if (state.tab === 'gaji') renderPayroll();
}

function bindDialogs(view) {
  $('pdfDownload').onclick = downloadPdf;
  $('pdfShare').onclick = sharePdf;
  $('advForm').addEventListener('submit', saveAdvance);
  view.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
  $('empPayType').addEventListener('change', syncRateLabel);
  $('empForm').addEventListener('submit', saveEmployee);
}
