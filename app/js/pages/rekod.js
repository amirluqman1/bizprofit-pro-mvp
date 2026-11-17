// Rekod: Key In transaksi, Sejarah transaksi, dan Log audit.
// Staff hanya nampak transaksi yang dia sendiri masukkan hari ini (dikunci di database).
// Owner & admin boleh ubah/padam transaksi (admin: outlet sendiri); setiap perubahan
// direkod dalam log audit oleh database, bukan oleh app.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, dateShort } from '../format.js';

const PAGE_SIZE = 30;
// Pilihan susunan Sejarah: [kolum, menaik?] — kolum seterusnya jadi pemutus seri.
const SORTS = [
  { label: 'Tarikh terbaru', order: [['transaction_date', false], ['created_at', false]] },
  { label: 'Tarikh terlama', order: [['transaction_date', true], ['created_at', true]] },
  { label: 'Baru dikey in', order: [['created_at', false]] },
  { label: 'Jumlah besar', order: [['amount', false], ['transaction_date', false]] },
  { label: 'Jumlah kecil', order: [['amount', true], ['transaction_date', false]] }
];
let lists = null;   // { categories, payments } — dimuat sekali sahaja

async function loadLists() {
  if (lists) return lists;
  const [{ data: cats, error: e1 }, { data: pays, error: e2 }] = await Promise.all([
    sb.from('categories').select('key,name,type').order('key'),
    sb.from('payment_methods').select('name').order('name')
  ]);
  if (e1 || e2) throw new Error('Senarai kategori tidak dapat dibaca.');
  lists = { categories: cats || [], payments: (pays || []).map(p => p.name) };
  return lists;
}

const tabFromHash = () => (location.hash.includes('t=sejarah') ? 'sejarah'
  : location.hash.includes('t=log') && session.isAdminUp ? 'log' : 'keyin');

function defaultOutlet() {
  if (session.outletId && session.outletId !== ALL_OUTLETS) return session.outletId;
  return session.profile.outlet_id;
}

function keyInHTML() {
  const outletPicker = session.isOwner && session.outlets.length > 1
    ? `<label class="field">Outlet<select id="kiOutlet">${session.outlets.map(o =>
        `<option value="${esc(o.id)}" ${o.id === defaultOutlet() ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>`
    : `<p class="note-line">${icon('store')}Untuk <b>${esc(outletName(defaultOutlet()))}</b></p>`;
  return `<form id="kiForm" class="card stack" novalidate>
    <div class="seg" role="radiogroup" aria-label="Jenis transaksi">
      <label class="seg-opt in"><input type="radio" name="kiType" value="In" checked>${icon('plus-box')}Duit masuk</label>
      <label class="seg-opt out"><input type="radio" name="kiType" value="Out">${icon('layers')}Duit keluar</label>
    </div>
    <label class="field">Jumlah
      <span class="amount"><span>RM</span><input id="kiAmount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"></span></label>
    <label class="field">Kategori<select id="kiCategory"></select></label>
    <fieldset class="field plain"><legend>Cara bayaran</legend><div class="chips" id="kiPay"></div></fieldset>
    <label class="field">Keterangan<input id="kiDesc" maxlength="200" placeholder="Contoh: Jualan sarapan pagi"></label>
    <div class="two">
      <label class="field">Tarikh<input id="kiDate" type="date"></label>
      <label class="field">No. rujukan<input id="kiRef" maxlength="50" placeholder="Pilihan"></label>
    </div>
    ${outletPicker}
    <button class="btn primary block" id="kiSave">Simpan transaksi</button>
  </form>`;
}

function rowHTML(t) {
  const masuk = t.type === 'In';
  const parts = [dateShort(t.transaction_date), t.category];
  if (session.outlets.length > 1) parts.push(outletName(t.outlet_id));
  const edit = session.isAdminUp ? ` tabindex="0" role="button" data-tx="${esc(t.id)}" aria-label="Ubah atau padam transaksi"` : '';
  return `<li class="tx${session.isAdminUp ? ' editable' : ''}"${edit}>
    <span class="tx-icon ${masuk ? 'in' : 'out'}" aria-hidden="true">${masuk ? '+' : '−'}</span>
    <div class="tx-copy"><p class="tx-title">${esc(t.description || t.category)}</p><p class="tx-detail">${esc(parts.join(' · '))}</p></div>
    <span class="tx-amount ${masuk ? 'in' : 'out'}">${masuk ? '+' : '−'}${esc(rm(t.amount))}</span>
  </li>`;
}

export default {
  subtitle: 'Key in dan semak transaksi.',
  async render(view) {
    const tab = tabFromHash();
    view.innerHTML = `
      <div class="seg tabs" role="tablist">
        <a class="seg-opt ${tab === 'keyin' ? 'on' : ''}" href="#/rekod" role="tab" aria-selected="${tab === 'keyin'}">Key In</a>
        <a class="seg-opt ${tab === 'sejarah' ? 'on' : ''}" href="#/rekod?t=sejarah" role="tab" aria-selected="${tab === 'sejarah'}">Sejarah</a>
        ${session.isAdminUp ? `<a class="seg-opt ${tab === 'log' ? 'on' : ''}" href="#/rekod?t=log" role="tab" aria-selected="${tab === 'log'}">Log audit</a>` : ''}
      </div>
      <div id="rekodBody"><section class="card"><p class="greet-sub">Memuatkan…</p></section></div>`;
    if (tab === 'sejarah') return renderHistory($('rekodBody'));
    if (tab === 'log') return renderAudit($('rekodBody'));
    return renderKeyIn($('rekodBody'));
  }
};

// ---------------- Key In ----------------
async function renderKeyIn(box) {
  let l;
  try { l = await loadLists(); }
  catch (e) { box.innerHTML = `<section class="card"><p class="greet-sub">${esc(e.message)}</p></section>`; return; }
  box.innerHTML = keyInHTML();

  const fillCategories = () => {
    const type = document.querySelector('input[name="kiType"]:checked').value;
    $('kiCategory').replaceChildren(...l.categories.filter(c => c.type === type).map(c => new Option(c.name, c.name)));
  };
  fillCategories();
  document.querySelectorAll('input[name="kiType"]').forEach(r => r.addEventListener('change', fillCategories));
  $('kiPay').innerHTML = l.payments.map((p, i) =>
    `<label class="chip"><input type="radio" name="kiPay" value="${esc(p)}" ${i === 0 ? 'checked' : ''}>${esc(p)}</label>`).join('');
  $('kiDate').value = todayKL();

  $('kiForm').addEventListener('submit', async e => {
    e.preventDefault();
    const amount = Number($('kiAmount').value);
    const desc = $('kiDesc').value.trim();
    if (!(amount > 0)) { toast('Masukkan jumlah lebih dari RM 0.', 'error'); $('kiAmount').focus(); return; }
    if (!$('kiCategory').value) { toast('Pilih kategori.', 'error'); return; }
    if (!desc) { toast('Isi keterangan supaya senang disemak nanti.', 'error'); $('kiDesc').focus(); return; }
    if (!$('kiDate').value) { toast('Pilih tarikh transaksi.', 'error'); return; }
    const pay = document.querySelector('input[name="kiPay"]:checked');
    if (!pay) { toast('Pilih cara bayaran.', 'error'); return; }

    const btn = $('kiSave');
    btn.disabled = true; btn.textContent = 'Menyimpan…';
    const { error } = await sb.from('transactions').insert({
      transaction_date: $('kiDate').value,
      type: document.querySelector('input[name="kiType"]:checked').value,
      category: $('kiCategory').value,
      amount: Math.round(amount * 100) / 100,
      description: desc,
      payment_method: pay.value,
      reference_no: $('kiRef').value.trim() || null,
      outlet_id: $('kiOutlet') ? $('kiOutlet').value : defaultOutlet()
    });
    btn.disabled = false; btn.textContent = 'Simpan transaksi';
    if (error) { toast('Transaksi tak disimpan: ' + error.message, 'error'); return; }
    $('kiAmount').value = ''; $('kiDesc').value = ''; $('kiRef').value = '';
    toast('Transaksi disimpan.');
    $('kiAmount').focus();
  });
}

// ---------------- Sejarah ----------------
async function renderHistory(box) {
  let offset = 0, runId = 0;
  const rows = new Map();
  box.innerHTML = `
    ${session.role === 'staff' ? '<p class="note-line">' + icon('lock') + 'Anda hanya nampak transaksi yang anda masukkan hari ini.</p>' : ''}
    ${session.isAdminUp ? '<p class="note-line small">' + icon('history') + 'Tekan transaksi untuk ubah atau padam. Setiap perubahan direkod dalam Log audit.</p>' : ''}
    <section class="card stack filter-bar" aria-label="Susun dan tapis transaksi">
      <div class="seg" role="radiogroup" aria-label="Jenis transaksi">
        <label class="seg-opt"><input type="radio" name="fType" value="" checked>Semua</label>
        <label class="seg-opt in"><input type="radio" name="fType" value="In">${icon('plus-box')}Masuk</label>
        <label class="seg-opt out"><input type="radio" name="fType" value="Out">${icon('layers')}Keluar</label>
      </div>
      <div class="two">
        <label class="field">Kategori<select id="fCat"><option value="">Semua kategori</option></select></label>
        <label class="field">Susun ikut<select id="fSort">${SORTS.map((o, i) =>
          `<option value="${i}">${esc(o.label)}</option>`).join('')}</select></label>
      </div>
      <p class="note-line small" id="fCount" hidden></p>
    </section>
    <section class="card"><ul class="tx-list" id="txList"></ul>
      <p class="greet-sub" id="txStatus">Memuatkan…</p>
      <button class="btn ghost block" id="txMore" type="button" hidden>Muat lagi</button></section>
    ${session.isAdminUp ? editDialogHTML() : ''}`;

  async function more() {
    $('txMore').hidden = true;
    $('txStatus').hidden = false; $('txStatus').textContent = 'Memuatkan…';
    const run = ++runId;
    const type = document.querySelector('input[name="fType"]:checked').value;
    const cat = $('fCat').value;
    const sort = SORTS[Number($('fSort').value)] || SORTS[0];
    let q = sb.from('transactions')
      .select('id,transaction_date,type,category,amount,description,payment_method,reference_no,outlet_id,created_at',
        { count: offset ? undefined : 'exact' });
    sort.order.forEach(([col, asc]) => { q = q.order(col, { ascending: asc }); });
    q = q.order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
    if (type) q = q.eq('type', type);
    if (cat) q = q.eq('category', cat);
    const { data, error, count } = await q;
    if (run !== runId) return;   // tapisan dah berubah semasa menunggu
    if (error) { $('txStatus').textContent = 'Senarai transaksi tak dapat dibaca. Cuba lagi.'; return; }
    data.forEach(t => rows.set(String(t.id), t));
    $('txList').insertAdjacentHTML('beforeend', data.map(rowHTML).join(''));
    offset += data.length;
    if (count != null) {
      const filtered = type || cat;
      $('fCount').hidden = !filtered;
      $('fCount').textContent = `${count} transaksi ditemui`;
    }
    if (!offset) {
      $('txStatus').textContent = type || cat ? 'Tiada transaksi untuk tapisan ini.' : 'Belum ada transaksi.';
      return;
    }
    $('txStatus').hidden = true;
    $('txMore').hidden = data.length < PAGE_SIZE;
  }
  $('txMore').onclick = more;
  const reload = () => { offset = 0; rows.clear(); $('txList').innerHTML = ''; return more(); };

  // Tapisan: jenis (masuk/keluar) → kategori ikut jenis; susun ikut tarikh/jumlah.
  let cats = [];
  const fillCats = () => {
    const type = document.querySelector('input[name="fType"]:checked').value;
    const keep = $('fCat').value;
    const names = [...new Set(cats.filter(c => !type || c.type === type).map(c => c.name))];
    $('fCat').replaceChildren(new Option('Semua kategori', ''), ...names.map(n => new Option(n, n)));
    $('fCat').value = names.includes(keep) ? keep : '';
  };
  loadLists().then(l => { cats = l.categories; fillCats(); }).catch(() => {});
  document.querySelectorAll('input[name="fType"]').forEach(r => r.addEventListener('change', () => { fillCats(); reload(); }));
  $('fCat').addEventListener('change', reload);
  $('fSort').addEventListener('change', reload);

  if (session.isAdminUp) {
    const open = e => {
      const li = e.target.closest('[data-tx]');
      if (li) openEdit(rows.get(li.dataset.tx), reload);
    };
    $('txList').addEventListener('click', open);
    $('txList').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
    bindEditDialog();
  }
  await more();
}

// ---------------- Ubah / padam (owner & admin) ----------------
let editing = null;   // { t, linked, done }

function editDialogHTML() {
  const outletPicker = session.isOwner && session.outlets.length > 1
    ? `<label class="field">Outlet<select id="edOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `<dialog id="edDialog"><form id="edForm" class="stack" novalidate>
    <h2>Ubah transaksi</h2>
    <p class="alert" id="edLinked" hidden></p>
    <div class="seg" role="radiogroup" aria-label="Jenis transaksi">
      <label class="seg-opt in"><input type="radio" name="edType" value="In">${icon('plus-box')}Duit masuk</label>
      <label class="seg-opt out"><input type="radio" name="edType" value="Out">${icon('layers')}Duit keluar</label>
    </div>
    <label class="field">Jumlah
      <span class="amount"><span>RM</span><input id="edAmount" type="number" inputmode="decimal" step="0.01" min="0.01"></span></label>
    <label class="field">Kategori<select id="edCategory"></select></label>
    <label class="field">Cara bayaran<select id="edPay"></select></label>
    <label class="field">Keterangan<input id="edDesc" maxlength="200"></label>
    <div class="two">
      <label class="field">Tarikh<input id="edDate" type="date"></label>
      <label class="field">No. rujukan<input id="edRef" maxlength="50" placeholder="Pilihan"></label>
    </div>
    ${outletPicker}
    <div class="dialog-actions">
      <button class="btn danger" type="button" id="edDelete">Padam</button>
      <button class="btn ghost" type="button" id="edCancel">Batal</button>
      <button class="btn primary" id="edSave">Simpan</button>
    </div>
  </form></dialog>`;
}

async function openEdit(t, done) {
  if (!t) return;
  let l;
  try { l = await loadLists(); } catch (e) { toast(e.message, 'error'); return; }
  // Rekod gaji/advance: jumlah, jenis, kategori & outlet dikunci (database juga menyekat).
  const [{ data: pay }, { data: adv }] = await Promise.all([
    sb.from('payroll').select('id').eq('transaction_id', t.id).limit(1),
    sb.from('salary_advances').select('id').eq('transaction_id', t.id).limit(1)
  ]);
  const linked = pay?.length ? 'gaji' : adv?.length ? 'advance' : null;
  editing = { t, linked, done, lists: l };

  document.querySelectorAll('input[name="edType"]').forEach(r => { r.checked = r.value === t.type; });
  fillEditCategories(t.category);
  const pays = l.payments.includes(t.payment_method) || !t.payment_method ? l.payments : [t.payment_method, ...l.payments];
  $('edPay').replaceChildren(...pays.map(p => new Option(p, p)));
  $('edPay').value = t.payment_method || pays[0] || '';
  $('edAmount').value = Number(t.amount).toFixed(2);
  $('edDesc').value = t.description || '';
  $('edDate').value = t.transaction_date;
  $('edRef').value = t.reference_no || '';
  if ($('edOutlet')) $('edOutlet').value = t.outlet_id;

  const lock = !!linked;
  ['edAmount', 'edCategory', 'edOutlet'].forEach(id => { if ($(id)) $(id).disabled = lock; });
  document.querySelectorAll('input[name="edType"]').forEach(r => { r.disabled = lock; });
  $('edLinked').hidden = !lock;
  $('edLinked').textContent = linked === 'gaji'
    ? 'Ini rekod bayaran gaji. Jumlah tidak boleh diubah di sini. Jika salah, padam rekod ini: slip gaji akan dibuka semula (draf) supaya boleh dibayar semula di Pekerja.'
    : linked === 'advance'
      ? 'Ini rekod advance. Jumlah tidak boleh diubah di sini. Jika salah, padam rekod ini (advance dibatalkan) dan beri semula di Pekerja.'
      : '';
  $('edDialog').showModal();
}

function fillEditCategories(selected) {
  const type = document.querySelector('input[name="edType"]:checked')?.value;
  const cats = editing.lists.categories.filter(c => c.type === type).map(c => c.name);
  if (selected && !cats.includes(selected)) cats.unshift(selected);
  $('edCategory').replaceChildren(...cats.map(c => new Option(c, c)));
  if (selected) $('edCategory').value = selected;
}

function bindEditDialog() {
  document.querySelectorAll('input[name="edType"]').forEach(r => r.addEventListener('change', () => fillEditCategories(null)));
  $('edCancel').onclick = () => $('edDialog').close();

  $('edForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!editing) return;
    const { t } = editing;
    const amount = Math.round(Number($('edAmount').value) * 100) / 100;
    const desc = $('edDesc').value.trim();
    if (!(amount > 0)) { toast('Masukkan jumlah lebih dari RM 0.', 'error'); return; }
    if (!desc) { toast('Isi keterangan.', 'error'); return; }
    if (!$('edDate').value) { toast('Pilih tarikh.', 'error'); return; }
    const payload = {
      transaction_date: $('edDate').value,
      description: desc,
      payment_method: $('edPay').value,
      reference_no: $('edRef').value.trim() || null
    };
    if (!editing.linked) {
      payload.type = document.querySelector('input[name="edType"]:checked').value;
      payload.category = $('edCategory').value;
      payload.amount = amount;
      if ($('edOutlet')) payload.outlet_id = $('edOutlet').value;
    }
    $('edSave').disabled = true;
    const { data, error } = await sb.from('transactions').update(payload).eq('id', t.id).select('id');
    $('edSave').disabled = false;
    if (error) { toast('Tak disimpan: ' + error.message, 'error'); return; }
    if (!data?.length) { toast('Tiada akses untuk ubah transaksi ini.', 'error'); return; }
    $('edDialog').close();
    toast('Transaksi dikemas kini. Perubahan direkod dalam Log audit.');
    editing.done();
  });

  $('edDelete').onclick = async () => {
    if (!editing) return;
    const { t, linked } = editing;
    const extra = linked === 'gaji' ? '\n\nSlip gaji akan dibuka semula (draf).'
      : linked === 'advance' ? '\n\nAdvance ini akan dibatalkan.' : '';
    if (!confirm(`Padam transaksi ini?\n\n${t.description || t.category} · ${rm(t.amount)}${extra}\n\nRekod asal disimpan dalam Log audit.`)) return;
    $('edDelete').disabled = true;
    const { data, error } = await sb.from('transactions').delete().eq('id', t.id).select('id');
    $('edDelete').disabled = false;
    if (error) { toast('Tak dipadam: ' + error.message, 'error'); return; }
    if (!data?.length) { toast('Tiada akses untuk padam transaksi ini.', 'error'); return; }
    $('edDialog').close();
    toast(linked === 'gaji' ? 'Dipadam. Slip gaji kini draf semula di Pekerja.' : 'Transaksi dipadam.');
    editing.done();
  };
}

// ---------------- Log audit (owner & admin) ----------------
const FIELD = {
  amount: 'Jumlah', type: 'Jenis', category: 'Kategori', description: 'Keterangan',
  payment_method: 'Cara bayaran', transaction_date: 'Tarikh', reference_no: 'No. rujukan', outlet_id: 'Outlet'
};
function fieldVal(k, v) {
  if (v == null || v === '') return '-';
  if (k === 'amount') return rm(v);
  if (k === 'type') return v === 'In' ? 'Duit masuk' : 'Duit keluar';
  if (k === 'transaction_date') return dateShort(v);
  if (k === 'outlet_id') return outletName(v) || 'Outlet lain';
  return String(v);
}

function auditHTML(a) {
  const o = a.old_data || {};
  const when = new Date(a.changed_at).toLocaleString('ms-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  const who = a.changed_by === session.user.id ? 'Anda'
    : a.changed_by ? [ROLE_LABEL[a.changed_by_role] || 'Pengguna', a.changed_by_email].filter(Boolean).join(' · ')
    : 'Sistem (pembersihan oleh owner)';
  let body;
  if (a.action === 'ubah') {
    const n = a.new_data || {};
    const diffs = Object.keys(FIELD).filter(k => String(o[k] ?? '') !== String(n[k] ?? ''));
    body = diffs.length
      ? diffs.map(k => `<div class="kv"><span>${FIELD[k]}</span><b>${esc(fieldVal(k, o[k]))} → ${esc(fieldVal(k, n[k]))}</b></div>`).join('')
      : '<p class="note">Tiada perubahan pada maklumat utama.</p>';
  } else {
    body = `<div class="kv"><span>${esc(fieldVal('transaction_date', o.transaction_date))} · ${esc(o.category || '')}</span><b>${esc(fieldVal('amount', o.amount))}</b></div>`;
  }
  return `<div class="log">
    <b><i class="tag ${a.action === 'padam' ? 'off' : ''}">${a.action === 'padam' ? 'Dipadam' : 'Diubah'}</i> ${esc(o.description || o.category || 'Transaksi')}</b>
    ${body}
    ${a.note ? `<p class="note small">${esc(a.note)}</p>` : ''}
    <span>${esc(when)} · ${esc(who)}${session.outlets.length > 1 ? ' · ' + esc(outletName(a.outlet_id)) : ''}</span>
  </div>`;
}
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' };

async function renderAudit(box) {
  let offset = 0;
  box.innerHTML = `
    <p class="note-line small">${icon('lock')}Hanya owner dan admin nampak log ini. Log tidak boleh diubah atau dipadam.</p>
    <section class="card"><div id="auList"></div>
      <p class="greet-sub" id="auStatus">Memuatkan…</p>
      <button class="btn ghost block" id="auMore" type="button" hidden>Muat lagi</button></section>`;
  async function more() {
    $('auMore').hidden = true;
    let q = sb.from('transaction_audit')
      .select('id,outlet_id,transaction_id,action,old_data,new_data,note,changed_by,changed_by_email,changed_by_role,changed_at')
      .order('changed_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
    const { data, error } = await q;
    if (error) { $('auStatus').textContent = 'Log audit tak dapat dibaca. Cuba lagi.'; return; }
    $('auList').insertAdjacentHTML('beforeend', data.map(auditHTML).join(''));
    offset += data.length;
    if (!offset) { $('auStatus').textContent = 'Belum ada transaksi yang diubah atau dipadam.'; return; }
    $('auStatus').hidden = true;
    $('auMore').hidden = data.length < PAGE_SIZE;
  }
  $('auMore').onclick = more;
  await more();
}
