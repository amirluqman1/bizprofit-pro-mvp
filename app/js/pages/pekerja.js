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
const payLabel = e => e.pay_type === 'harian'
  ? `Harian ${rm(e.rate)}/hari${Number(e.ot_rate) ? ' · OT ' + rm(e.ot_rate) + '/jam' : ''}`
  : `Bulanan ${rm(e.rate)}${Number(e.ot_rate) ? ' · OT ' + rm(e.ot_rate) + '/jam' : ''}`;
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
  $('empRateLabel').firstChild.textContent = $('empPayType').value === 'harian' ? 'Gaji sehari (RM)' : 'Gaji sebulan (RM)';
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
async function renderPayroll() {
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
    </section>
    <div id="pyList" class="list"><section class="card"><p class="greet-sub">Mengira…</p></section></div>
    <p class="note-line small">${icon('lock')}Gaji harian = hari hadir × kadar (separuh hari = 0.5). Gaji bulanan dibayar penuh; tolak ketidakhadiran secara manual dalam "Potongan". Slip yang sudah dibayar dikunci.</p>`;

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
  const [att, pr] = await Promise.all([
    sb.from('attendance').select('employee_id,status,ot_hours').gte('work_date', state.from).lte('work_date', state.to).in('employee_id', ids),
    sb.from('payroll').select('*').eq('period_start', state.from).eq('period_end', state.to).in('employee_id', ids)
  ]);
  if (att.error || pr.error) { $('pyList').innerHTML = '<div class="empty">Data gaji tak dapat dibaca.</div>'; return; }
  const slips = new Map((pr.data || []).map(p => [p.employee_id, p]));

  // Kira dalam sen supaya tiada ralat pecahan.
  const rows = employees.filter(e => e.active || slips.has(e.id)).map(e => {
    const mine = (att.data || []).filter(a => a.employee_id === e.id);
    const days = mine.reduce((t, a) => t + DAY_VALUE[a.status], 0);
    const ot = mine.reduce((t, a) => t + Number(a.ot_hours), 0);
    const absent = mine.filter(a => a.status === 'tidak_hadir').length;
    const slip = slips.get(e.id);
    if (slip?.status === 'dibayar') {
      return { e, slip, paid: true, days: Number(slip.days_worked), ot: Number(slip.ot_hours), absent,
        base: cents(slip.base_amount), otAmt: cents(slip.ot_amount), allow: cents(slip.allowance), ded: cents(slip.deduction), net: cents(slip.net_amount),
        rate: Number(slip.rate), otRate: Number(slip.ot_rate), payType: slip.pay_type };
    }
    const base = e.pay_type === 'harian' ? Math.round(days * cents(e.rate)) : cents(e.rate);
    const otAmt = Math.round(ot * cents(e.ot_rate));
    const allow = cents(slip?.allowance), ded = cents(slip?.deduction);
    return { e, slip, paid: false, days, ot, absent, base, otAmt, allow, ded, net: Math.max(0, base + otAmt + allow - ded),
      rate: Number(e.rate), otRate: Number(e.ot_rate), payType: e.pay_type };
  });

  const total = rows.reduce((t, r) => t + r.net, 0);
  const paid = rows.filter(r => r.paid).reduce((t, r) => t + r.net, 0);
  $('pyTotal').innerHTML = `<span>Jumlah gaji ${esc(dateRange(state.from, state.to))}</span><b>${rm(fromCents(total))}</b>`;
  $('pyTotal').insertAdjacentHTML('afterend', `<p class="greet-sub right" id="pyPaid">Sudah dibayar ${rm(fromCents(paid))} · Belum ${rm(fromCents(total - paid))}</p>`);
  if (!rows.length) { $('pyList').innerHTML = emptyStaff(); return; }

  $('pyList').innerHTML = rows.map(r => {
    const st = r.paid ? '<span class="pill ok">Dibayar</span>' : r.slip ? '<span class="pill rendah">Draf</span>' : '<span class="pill">Belum disimpan</span>';
    const baseLine = r.payType === 'harian'
      ? `<div class="kv"><span>${r.days} hari × ${rm(r.rate)}</span><b>${rm(fromCents(r.base))}</b></div>`
      : `<div class="kv"><span>Gaji bulanan${r.absent ? ` (${r.absent} hari tidak hadir)` : ''}</span><b>${rm(fromCents(r.base))}</b></div>`;
    return `<section class="card slip" data-emp="${esc(r.e.id)}">
      <div class="emp-head"><div><b>${esc(r.e.name)}</b><span class="sub">${esc(outletName(r.e.outlet_id))}${r.e.is_manager ? ' · Peringkat pengurus' : ''}</span></div>${st}</div>
      <div class="kv-list">
        ${baseLine}
        <div class="kv"><span>OT ${r.ot} jam × ${rm(r.otRate)}</span><b>${rm(fromCents(r.otAmt))}</b></div>
        ${r.paid
          ? `<div class="kv"><span>Elaun</span><b>${rm(fromCents(r.allow))}</b></div><div class="kv"><span>Potongan</span><b class="neg">−${rm(fromCents(r.ded))}</b></div>`
          : `<div class="two"><label class="field">Elaun (RM)<input type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(r.allow)}" data-allow></label>
              <label class="field">Potongan (RM)<input type="number" inputmode="decimal" min="0" step="0.01" value="${fromCents(r.ded)}" data-ded></label></div>`}
      </div>
      <div class="kv total"><span>Jumlah</span><b data-net>${rm(fromCents(r.net))}</b></div>
      ${r.paid ? `<p class="greet-sub">Dibayar ${esc(new Date(r.slip.paid_at).toLocaleDateString('ms-MY', { day: 'numeric', month: 'short', year: 'numeric' }))} · direkod sebagai "Staff Wages"</p>` : ''}
      <div class="dialog-actions">
        <button class="btn ghost" type="button" data-copy>Copy slip</button>
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
    r.allow = x.allow; r.ded = x.ded; r.net = Math.max(0, r.base + r.otAmt + r.allow - r.ded);
    card.querySelector('[data-net]').textContent = rm(fromCents(r.net));
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
      const lines = [
        `SLIP GAJI — ${session.business?.name || 'BizProfit Pro'}`,
        `Nama: ${r.e.name} (${outletName(r.e.outlet_id)})`,
        `Tempoh: ${dateRange(state.from, state.to)}`,
        r.payType === 'harian' ? `Hari bekerja: ${r.days} × ${rm(r.rate)} = ${rm(fromCents(r.base))}` : `Gaji bulanan: ${rm(fromCents(r.base))}`,
        `OT: ${r.ot} jam × ${rm(r.otRate)} = ${rm(fromCents(r.otAmt))}`,
        `Elaun: ${rm(fromCents(r.allow))}`, `Potongan: ${rm(fromCents(r.ded))}`,
        `JUMLAH: ${rm(fromCents(r.net))}`,
        r.paid ? `Status: Dibayar ${new Date(r.slip.paid_at).toLocaleDateString('ms-MY')}` : 'Status: Belum dibayar'
      ];
      try { await navigator.clipboard.writeText(lines.join('\n')); toast('Slip disalin. Tampal ke WhatsApp.'); }
      catch { toast('Gagal salin.', 'error'); }
      return;
    }
    if (!readExtras(card)) { toast('Elaun dan potongan mesti 0 atau lebih.', 'error'); return; }
    if (btn.matches('[data-draft]')) {
      btn.disabled = true;
      if (await saveDraft(r)) { toast('Draf disimpan.'); renderPayroll(); }
      btn.disabled = false;
      return;
    }
    if (btn.matches('[data-pay]')) {
      if (r.net <= 0) { toast('Jumlah RM 0, tiada apa untuk dibayar.', 'error'); return; }
      const methods = await loadPayMethods();
      $('payInfo').textContent = `${r.e.name} · ${dateRange(state.from, state.to)} · ${rm(fromCents(r.net))}`;
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
    toast(`Gaji ${r.e.name} dibayar dan direkod sebagai Staff Wages.`);
    renderPayroll();
  };
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
      <label class="field">Jenis gaji<select id="empPayType"><option value="harian">Harian</option><option value="bulanan">Bulanan</option></select></label>
      <label class="field" id="empRateLabel">Gaji sehari (RM)<input id="empRate" type="number" inputmode="decimal" min="0" step="0.01"></label>
    </div>
    <label class="field">Kadar OT sejam (RM)<input id="empOt" type="number" inputmode="decimal" min="0" step="0.01" value="0"></label>
    ${session.isOwner ? '<label class="check"><input type="checkbox" id="empManager"> Peringkat pengurus <small>(gaji hanya owner nampak)</small></label>' : ''}
    <label class="check" id="empActiveWrap"><input type="checkbox" id="empActive" checked> Masih bekerja (aktif)</label>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="empDialog">Batal</button><button class="btn primary" id="empSave">Simpan</button></div>
  </form></dialog>

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

function bindDialogs(view) {
  view.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
  $('empPayType').addEventListener('change', syncRateLabel);
  $('empForm').addEventListener('submit', saveEmployee);
}
