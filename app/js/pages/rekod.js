// Rekod: Key In transaksi, Sejarah transaksi, dan Log audit.
// Staff hanya nampak transaksi yang dia sendiri masukkan hari ini (dikunci di database).
// Owner & admin boleh ubah/padam transaksi (admin: outlet sendiri); setiap perubahan
// direkod dalam log audit oleh database, bukan oleh app.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, dateShort, addDays } from '../format.js';
import { isPro, HISTORY_DAYS_FREE } from '../plan.js';

const PAGE_SIZE = 30;
// Pilihan susunan Sejarah: [kolum, menaik?] — kolum seterusnya jadi pemutus seri.
const SORTS = [
  { label: 'Newest date', order: [['transaction_date', false], ['created_at', false]] },
  { label: 'Oldest date', order: [['transaction_date', true], ['created_at', true]] },
  { label: 'Recently keyed in', order: [['created_at', false]] },
  { label: 'Largest amount', order: [['amount', false], ['transaction_date', false]] },
  { label: 'Smallest amount', order: [['amount', true], ['transaction_date', false]] }
];
let lists = null;   // { categories, payments } — dimuat sekali sahaja

async function loadLists() {
  if (lists) return lists;
  const [{ data: cats, error: e1 }, { data: pays, error: e2 }] = await Promise.all([
    sb.from('categories').select('key,name,type').order('key'),
    sb.from('payment_methods').select('name').order('name')
  ]);
  if (e1 || e2) throw new Error('Could not load the category list.');
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
  // Tarikh & outlet dahulu: kebanyakan orang set "bila & di mana" sebelum isi amaun.
  const date = '<label class="field">Date<input id="kiDate" type="date"></label>';
  const top = session.isOwner && session.outlets.length > 1
    ? `<div class="two ki-top">${date}<label class="field">Outlet<select id="kiOutlet">${session.outlets.map(o =>
        `<option value="${esc(o.id)}" ${o.id === defaultOutlet() ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div>`
    : `${date}<p class="note-line">${icon('store')}For <b>${esc(outletName(defaultOutlet()))}</b></p>`;
  return `<form id="kiForm" class="card stack" novalidate>
    ${top}
    <div class="seg" role="radiogroup" aria-label="Transaction type">
      <label class="seg-opt in"><input type="radio" name="kiType" value="In" checked>${icon('plus-box')}Money in</label>
      <label class="seg-opt out"><input type="radio" name="kiType" value="Out">${icon('layers')}Money out</label>
    </div>
    <label class="field">Amount
      <span class="amount"><span>RM</span><input id="kiAmount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"></span></label>
    <label class="field">Category<select id="kiCategory"></select></label>
    <fieldset class="field plain"><legend>Payment method</legend><div class="chips" id="kiPay"></div></fieldset>
    <label class="field">Description<input id="kiDesc" maxlength="200" placeholder="e.g. Breakfast sales"></label>
    <label class="field">Reference no.<input id="kiRef" maxlength="50" placeholder="Optional"></label>
    <button class="btn primary block" id="kiSave">Save transaction</button>
  </form>`;
}

function rowHTML(t) {
  const masuk = t.type === 'In';
  const parts = [dateShort(t.transaction_date), t.category];
  if (session.outlets.length > 1) parts.push(outletName(t.outlet_id));
  const edit = session.isAdminUp ? ` tabindex="0" role="button" data-tx="${esc(t.id)}" aria-label="Edit or delete transaction"` : '';
  return `<li class="tx${session.isAdminUp ? ' editable' : ''}"${edit}>
    <span class="tx-icon ${masuk ? 'in' : 'out'}" aria-hidden="true">${masuk ? '+' : '−'}</span>
    <div class="tx-copy"><p class="tx-title">${esc(t.description || t.category)}</p><p class="tx-detail">${esc(parts.join(' · '))}</p></div>
    <span class="tx-amount ${masuk ? 'in' : 'out'}">${masuk ? '+' : '−'}${esc(rm(t.amount))}</span>
  </li>`;
}

export default {
  async render(view) {
    const tab = tabFromHash();
    view.innerHTML = `
      <div class="seg tabs" role="tablist">
        <a class="seg-opt ${tab === 'keyin' ? 'on' : ''}" href="#/rekod" role="tab" aria-selected="${tab === 'keyin'}">Key In</a>
        <a class="seg-opt ${tab === 'sejarah' ? 'on' : ''}" href="#/rekod?t=sejarah" role="tab" aria-selected="${tab === 'sejarah'}">History</a>
        ${session.isAdminUp ? `<a class="seg-opt ${tab === 'log' ? 'on' : ''}" href="#/rekod?t=log" role="tab" aria-selected="${tab === 'log'}">Audit log</a>` : ''}
      </div>
      <div id="rekodBody"><div class="skel"></div></div>`;
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
    if (!(amount > 0)) { toast('Enter an amount above RM 0.', 'error'); $('kiAmount').focus(); return; }
    if (!$('kiCategory').value) { toast('Choose a category.', 'error'); return; }
    if (!desc) { toast('Add a description so it is easy to check later.', 'error'); $('kiDesc').focus(); return; }
    if (!$('kiDate').value) { toast('Choose the transaction date.', 'error'); return; }
    const pay = document.querySelector('input[name="kiPay"]:checked');
    if (!pay) { toast('Choose a payment method.', 'error'); return; }

    const btn = $('kiSave');
    btn.disabled = true; btn.textContent = 'Saving…';
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
    btn.disabled = false; btn.textContent = 'Save transaction';
    if (error) { toast('Transaction not saved: ' + error.message, 'error'); return; }
    $('kiAmount').value = ''; $('kiDesc').value = ''; $('kiRef').value = '';
    toast('Transaction saved.');
    $('kiAmount').focus();
  });
}

// ---------------- Sejarah ----------------
async function renderHistory(box) {
  let offset = 0, runId = 0;
  const rows = new Map();
  box.innerHTML = `
    ${session.role === 'staff' ? '<p class="note-line">' + icon('lock') + 'You only see transactions you entered today.</p>'
      : isPro() ? '' : `<p class="note-line">${icon('lock')}Free plan shows the last ${HISTORY_DAYS_FREE} days. Older records are kept. <a href="#/pakej">Upgrade to see all</a></p>`}
    <section class="card stack filter-bar" aria-label="Sort and filter transactions">
      <div class="seg" role="radiogroup" aria-label="Transaction type">
        <label class="seg-opt"><input type="radio" name="fType" value="" checked>All</label>
        <label class="seg-opt in"><input type="radio" name="fType" value="In">${icon('plus-box')}In</label>
        <label class="seg-opt out"><input type="radio" name="fType" value="Out">${icon('layers')}Out</label>
      </div>
      <div class="two">
        <label class="field">Category<select id="fCat"><option value="">All categories</option></select></label>
        <label class="field">Sort by<select id="fSort">${SORTS.map((o, i) =>
          `<option value="${i}">${esc(o.label)}</option>`).join('')}</select></label>
      </div>
      <p class="note-line small" id="fCount" hidden></p>
    </section>
    <section class="card"><ul class="tx-list" id="txList"></ul>
      <p class="greet-sub" id="txStatus">Loading…</p>
      <button class="btn ghost block" id="txMore" type="button" hidden>Load more</button></section>
    ${session.isAdminUp ? editDialogHTML() : ''}`;

  async function more() {
    $('txMore').hidden = true;
    $('txStatus').hidden = false; $('txStatus').textContent = 'Loading…';
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
    if (!isPro()) q = q.gte('transaction_date', addDays(todayKL(), -(HISTORY_DAYS_FREE - 1)));   // Percuma: sebulan terakhir
    if (type) q = q.eq('type', type);
    if (cat) q = q.eq('category', cat);
    const { data, error, count } = await q;
    if (run !== runId) return;   // tapisan dah berubah semasa menunggu
    if (error) { $('txStatus').textContent = 'Could not load transactions. Try again.'; return; }
    data.forEach(t => rows.set(String(t.id), t));
    $('txList').insertAdjacentHTML('beforeend', data.map(rowHTML).join(''));
    offset += data.length;
    if (count != null) {
      const filtered = type || cat;
      $('fCount').hidden = !filtered;
      $('fCount').textContent = `${count} transactions found`;
    }
    if (!offset) {
      $('txStatus').textContent = type || cat ? 'No transactions match this filter.' : 'No transactions yet.';
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
    $('fCat').replaceChildren(new Option('All categories', ''), ...names.map(n => new Option(n, n)));
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
    <h2>Edit transaction</h2>
    <p class="alert" id="edLinked" hidden></p>
    <div class="seg" role="radiogroup" aria-label="Transaction type">
      <label class="seg-opt in"><input type="radio" name="edType" value="In">${icon('plus-box')}Money in</label>
      <label class="seg-opt out"><input type="radio" name="edType" value="Out">${icon('layers')}Money out</label>
    </div>
    <label class="field">Amount
      <span class="amount"><span>RM</span><input id="edAmount" type="number" inputmode="decimal" step="0.01" min="0.01"></span></label>
    <label class="field">Category<select id="edCategory"></select></label>
    <label class="field">Payment method<select id="edPay"></select></label>
    <label class="field">Description<input id="edDesc" maxlength="200"></label>
    <div class="two">
      <label class="field">Date<input id="edDate" type="date"></label>
      <label class="field">Reference no.<input id="edRef" maxlength="50" placeholder="Optional"></label>
    </div>
    ${outletPicker}
    <div class="dialog-actions">
      <button class="btn danger" type="button" id="edDelete">Delete</button>
      <button class="btn ghost" type="button" id="edCancel">Cancel</button>
      <button class="btn primary" id="edSave">Save</button>
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
    ? 'This is a salary payment record. The amount cannot be changed here. If it is wrong, delete this record: the payslip reopens as a draft so it can be paid again in Staff.'
    : linked === 'advance'
      ? 'This is an advance record. The amount cannot be changed here. If it is wrong, delete this record (the advance is cancelled) and give it again in Staff.'
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
    if (!(amount > 0)) { toast('Enter an amount above RM 0.', 'error'); return; }
    if (!desc) { toast('Enter a description.', 'error'); return; }
    if (!$('edDate').value) { toast('Choose a date.', 'error'); return; }
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
    if (error) { toast('Not saved: ' + error.message, 'error'); return; }
    if (!data?.length) { toast('No access to edit this transaction.', 'error'); return; }
    $('edDialog').close();
    toast('Transaction updated. The change is recorded in the Audit log.');
    editing.done();
  });

  $('edDelete').onclick = async () => {
    if (!editing) return;
    const { t, linked } = editing;
    const extra = linked === 'gaji' ? '\n\nThe payslip will reopen as a draft.'
      : linked === 'advance' ? '\n\nThis advance will be cancelled.' : '';
    if (!confirm(`Delete this transaction?\n\n${t.description || t.category} · ${rm(t.amount)}${extra}\n\nThe original record is kept in the Audit log.`)) return;
    $('edDelete').disabled = true;
    const { data, error } = await sb.from('transactions').delete().eq('id', t.id).select('id');
    $('edDelete').disabled = false;
    if (error) { toast('Not deleted: ' + error.message, 'error'); return; }
    if (!data?.length) { toast('No access to delete this transaction.', 'error'); return; }
    $('edDialog').close();
    toast(linked === 'gaji' ? 'Deleted. The payslip is a draft again in Staff.' : 'Transaction deleted.');
    editing.done();
  };
}

// ---------------- Log audit (owner & admin) ----------------
const FIELD = {
  amount: 'Amount', type: 'Type', category: 'Category', description: 'Description',
  payment_method: 'Payment method', transaction_date: 'Date', reference_no: 'Reference no.', outlet_id: 'Outlet'
};
function fieldVal(k, v) {
  if (v == null || v === '') return '-';
  if (k === 'amount') return rm(v);
  if (k === 'type') return v === 'In' ? 'Money in' : 'Money out';
  if (k === 'transaction_date') return dateShort(v);
  if (k === 'outlet_id') return outletName(v) || 'Other outlet';
  return String(v);
}

function auditHTML(a) {
  const o = a.old_data || {};
  const when = new Date(a.changed_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  const who = a.changed_by === session.user.id ? 'You'
    : a.changed_by ? [ROLE_LABEL[a.changed_by_role] || 'User', a.changed_by_email].filter(Boolean).join(' · ')
    : 'System (cleanup by owner)';
  let body;
  if (a.action === 'ubah') {
    const n = a.new_data || {};
    const diffs = Object.keys(FIELD).filter(k => String(o[k] ?? '') !== String(n[k] ?? ''));
    body = diffs.length
      ? diffs.map(k => `<div class="kv"><span>${FIELD[k]}</span><b>${esc(fieldVal(k, o[k]))} → ${esc(fieldVal(k, n[k]))}</b></div>`).join('')
      : '<p class="note">No changes to the main details.</p>';
  } else {
    body = `<div class="kv"><span>${esc(fieldVal('transaction_date', o.transaction_date))} · ${esc(o.category || '')}</span><b>${esc(fieldVal('amount', o.amount))}</b></div>`;
  }
  return `<div class="log">
    <b><i class="tag ${a.action === 'padam' ? 'off' : ''}">${a.action === 'padam' ? 'Deleted' : 'Edited'}</i> ${esc(o.description || o.category || 'Transaction')}</b>
    ${body}
    ${a.note ? `<p class="note small">${esc(a.note)}</p>` : ''}
    <span>${esc(when)} · ${esc(who)}${session.outlets.length > 1 ? ' · ' + esc(outletName(a.outlet_id)) : ''}</span>
  </div>`;
}
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' };

async function renderAudit(box) {
  let offset = 0;
  box.innerHTML = `
    <p class="note-line small">${icon('lock')}Only the owner and admins can see this log. It cannot be edited or deleted.</p>
    <section class="card"><div id="auList"></div>
      <p class="greet-sub" id="auStatus">Loading…</p>
      <button class="btn ghost block" id="auMore" type="button" hidden>Load more</button></section>`;
  async function more() {
    $('auMore').hidden = true;
    let q = sb.from('transaction_audit')
      .select('id,outlet_id,transaction_id,action,old_data,new_data,note,changed_by,changed_by_email,changed_by_role,changed_at')
      .order('changed_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
    const { data, error } = await q;
    if (error) { $('auStatus').textContent = 'Could not load the audit log. Try again.'; return; }
    $('auList').insertAdjacentHTML('beforeend', data.map(auditHTML).join(''));
    offset += data.length;
    if (!offset) { $('auStatus').textContent = 'No transactions have been edited or deleted yet.'; return; }
    $('auStatus').hidden = true;
    $('auMore').hidden = data.length < PAGE_SIZE;
  }
  $('auMore').onclick = more;
  await more();
}
