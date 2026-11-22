// Rekod: Key In transaksi, Sejarah transaksi, dan Log audit.
// Staff hanya nampak transaksi yang dia sendiri masukkan hari ini (dikunci di database).
// Owner & admin boleh ubah/padam transaksi (admin: outlet sendiri); setiap perubahan
// direkod dalam log audit oleh database, bukan oleh app.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, dateShort, addDays } from '../format.js';
import { isPro, HISTORY_DAYS_FREE } from '../plan.js';
import { t, locale } from '../i18n.js';

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
  if (e1 || e2) throw new Error(t('Could not load the category list.'));
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
  const date = `<label class="field">${t('Date')}<input id="kiDate" type="date"></label>`;
  const top = session.isOwner && session.outlets.length > 1
    ? `<div class="two ki-top">${date}<label class="field">${t('Outlet')}<select id="kiOutlet">${session.outlets.map(o =>
        `<option value="${esc(o.id)}" ${o.id === defaultOutlet() ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label></div>`
    : `${date}<p class="note-line">${icon('store')}For <b>${esc(outletName(defaultOutlet()))}</b></p>`;
  return `<form id="kiForm" class="card stack" novalidate>
    ${top}
    <div class="seg" role="radiogroup" aria-label="${t('Transaction type')}">
      <label class="seg-opt in"><input type="radio" name="kiType" value="In" checked>${icon('plus-box')}${t('Money in')}</label>
      <label class="seg-opt out"><input type="radio" name="kiType" value="Out">${icon('layers')}${t('Money out')}</label>
    </div>
    <label class="field">${t('Amount')}
      <span class="amount"><span>RM</span><input id="kiAmount" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="0.00"></span></label>
    <label class="field">${t('Category')}<select id="kiCategory"></select></label>
    <fieldset class="field plain"><legend>${t('Payment method')}</legend><div class="chips" id="kiPay"></div></fieldset>
    <label class="field">${t('Description')}<input id="kiDesc" maxlength="200" placeholder="${t('e.g. Breakfast sales')}"></label>
    <label class="field">${t('Reference no.')}<input id="kiRef" maxlength="50" placeholder="${t('Optional')}"></label>
    <button class="btn primary block" id="kiSave">${t('Save transaction')}</button>
  </form>`;
}

function rowHTML(tr) {
  const masuk = tr.type === 'In';
  const parts = [dateShort(tr.transaction_date), tr.category];
  if (session.outlets.length > 1) parts.push(outletName(tr.outlet_id));
  const edit = session.isAdminUp ? ` tabindex="0" role="button" data-tx="${esc(tr.id)}" aria-label="${t('Edit or delete transaction')}"` : '';
  return `<li class="tx${session.isAdminUp ? ' editable' : ''}"${edit}>
    <span class="tx-icon ${masuk ? 'in' : 'out'}" aria-hidden="true">${masuk ? '+' : '−'}</span>
    <div class="tx-copy"><p class="tx-title">${esc(tr.description || tr.category)}</p><p class="tx-detail">${esc(parts.join(' · '))}</p></div>
    <span class="tx-amount ${masuk ? 'in' : 'out'}">${masuk ? '+' : '−'}${esc(rm(tr.amount))}</span>
  </li>`;
}

export default {
  async render(view) {
    const tab = tabFromHash();
    view.innerHTML = `
      <div class="seg tabs" role="tablist">
        <a class="seg-opt ${tab === 'keyin' ? 'on' : ''}" href="#/rekod" role="tab" aria-selected="${tab === 'keyin'}">${t('Key In')}</a>
        <a class="seg-opt ${tab === 'sejarah' ? 'on' : ''}" href="#/rekod?t=sejarah" role="tab" aria-selected="${tab === 'sejarah'}">${t('History')}</a>
        ${session.isAdminUp ? `<a class="seg-opt ${tab === 'log' ? 'on' : ''}" href="#/rekod?t=log" role="tab" aria-selected="${tab === 'log'}">${t('Audit log')}</a>` : ''}
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
    if (!(amount > 0)) { toast(t('Enter an amount above RM 0.'), 'error'); $('kiAmount').focus(); return; }
    if (!$('kiCategory').value) { toast(t('Choose a category.'), 'error'); return; }
    if (!desc) { toast(t('Add a description so it is easy to check later.'), 'error'); $('kiDesc').focus(); return; }
    if (!$('kiDate').value) { toast(t('Choose the transaction date.'), 'error'); return; }
    const pay = document.querySelector('input[name="kiPay"]:checked');
    if (!pay) { toast(t('Choose a payment method.'), 'error'); return; }

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
    btn.disabled = false; btn.textContent = t('Save transaction');
    if (error) { toast(t('Transaction not saved: ') + error.message, 'error'); return; }
    $('kiAmount').value = ''; $('kiDesc').value = ''; $('kiRef').value = '';
    toast(t('Transaction saved.'));
    $('kiAmount').focus();
  });
}

// ---------------- Sejarah ----------------
async function renderHistory(box) {
  let offset = 0, runId = 0;
  const rows = new Map();
  box.innerHTML = `
    ${session.role === 'staff' ? '<p class="note-line">' + icon('lock') + t('You only see transactions you entered today.') + '</p>'
      : isPro() ? '' : `<p class="note-line">${icon('lock')}${t('Free plan shows the last {n} days. Older records are kept.', { n: HISTORY_DAYS_FREE })} <a href="#/pakej">${t('Upgrade to see all')}</a></p>`}
    <section class="card stack filter-bar" aria-label="${t('Sort and filter transactions')}">
      <div class="seg" role="radiogroup" aria-label="${t('Transaction type')}">
        <label class="seg-opt"><input type="radio" name="fType" value="" checked>${t('All')}</label>
        <label class="seg-opt in"><input type="radio" name="fType" value="In">${icon('plus-box')}${t('In')}</label>
        <label class="seg-opt out"><input type="radio" name="fType" value="Out">${icon('layers')}${t('Out')}</label>
      </div>
      <div class="two">
        <label class="field">${t('Category')}<select id="fCat"><option value="">${t('All categories')}</option></select></label>
        <label class="field">${t('Sort by')}<select id="fSort">${SORTS.map((o, i) =>
          `<option value="${i}">${esc(t(o.label))}</option>`).join('')}</select></label>
      </div>
      <p class="note-line small" id="fCount" hidden></p>
    </section>
    <section class="card"><ul class="tx-list" id="txList"></ul>
      <p class="greet-sub" id="txStatus">Loading…</p>
      <button class="btn ghost block" id="txMore" type="button" hidden>${t('Load more')}</button></section>
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
    if (error) { $('txStatus').textContent = t('Could not load transactions. Try again.'); return; }
    data.forEach(tr => rows.set(String(tr.id), tr));
    $('txList').insertAdjacentHTML('beforeend', data.map(rowHTML).join(''));
    offset += data.length;
    if (count != null) {
      const filtered = type || cat;
      $('fCount').hidden = !filtered;
      $('fCount').textContent = t('{n} transactions found', { n: count });
    }
    if (!offset) {
      $('txStatus').textContent = type || cat ? t('No transactions match this filter.') : t('No transactions yet.');
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
    $('fCat').replaceChildren(new Option(t('All categories'), ''), ...names.map(n => new Option(n, n)));
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
let editing = null;   // { tr, linked, done }

function editDialogHTML() {
  const outletPicker = session.isOwner && session.outlets.length > 1
    ? `<label class="field">${t('Outlet')}<select id="edOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `<dialog id="edDialog"><form id="edForm" class="stack" novalidate>
    <h2>${t('Edit transaction')}</h2>
    <p class="alert" id="edLinked" hidden></p>
    <div class="seg" role="radiogroup" aria-label="${t('Transaction type')}">
      <label class="seg-opt in"><input type="radio" name="edType" value="In">${icon('plus-box')}${t('Money in')}</label>
      <label class="seg-opt out"><input type="radio" name="edType" value="Out">${icon('layers')}${t('Money out')}</label>
    </div>
    <label class="field">${t('Amount')}
      <span class="amount"><span>RM</span><input id="edAmount" type="number" inputmode="decimal" step="0.01" min="0.01"></span></label>
    <label class="field">${t('Category')}<select id="edCategory"></select></label>
    <label class="field">${t('Payment method')}<select id="edPay"></select></label>
    <label class="field">${t('Description')}<input id="edDesc" maxlength="200"></label>
    <div class="two">
      <label class="field">${t('Date')}<input id="edDate" type="date"></label>
      <label class="field">${t('Reference no.')}<input id="edRef" maxlength="50" placeholder="${t('Optional')}"></label>
    </div>
    ${outletPicker}
    <div class="dialog-actions">
      <button class="btn danger" type="button" id="edDelete">${t('Delete')}</button>
      <button class="btn ghost" type="button" id="edCancel">${t('Cancel')}</button>
      <button class="btn primary" id="edSave">${t('Save')}</button>
    </div>
  </form></dialog>`;
}

async function openEdit(tr, done) {
  if (!tr) return;
  let l;
  try { l = await loadLists(); } catch (e) { toast(e.message, 'error'); return; }
  // Rekod gaji/advance: jumlah, jenis, kategori & outlet dikunci (database juga menyekat).
  const [{ data: pay }, { data: adv }] = await Promise.all([
    sb.from('payroll').select('id').eq('transaction_id', tr.id).limit(1),
    sb.from('salary_advances').select('id').eq('transaction_id', tr.id).limit(1)
  ]);
  const linked = pay?.length ? 'gaji' : adv?.length ? 'advance' : null;
  editing = { tr, linked, done, lists: l };

  document.querySelectorAll('input[name="edType"]').forEach(r => { r.checked = r.value === tr.type; });
  fillEditCategories(tr.category);
  const pays = l.payments.includes(tr.payment_method) || !tr.payment_method ? l.payments : [tr.payment_method, ...l.payments];
  $('edPay').replaceChildren(...pays.map(p => new Option(p, p)));
  $('edPay').value = tr.payment_method || pays[0] || '';
  $('edAmount').value = Number(tr.amount).toFixed(2);
  $('edDesc').value = tr.description || '';
  $('edDate').value = tr.transaction_date;
  $('edRef').value = tr.reference_no || '';
  if ($('edOutlet')) $('edOutlet').value = tr.outlet_id;

  const lock = !!linked;
  ['edAmount', 'edCategory', 'edOutlet'].forEach(id => { if ($(id)) $(id).disabled = lock; });
  document.querySelectorAll('input[name="edType"]').forEach(r => { r.disabled = lock; });
  $('edLinked').hidden = !lock;
  $('edLinked').textContent = linked === 'gaji'
    ? t('This is a salary payment record. The amount cannot be changed here. If it is wrong, delete this record: the payslip reopens as a draft so it can be paid again in Staff.')
    : linked === 'advance'
      ? t('This is an advance record. The amount cannot be changed here. If it is wrong, delete this record (the advance is cancelled) and give it again in Staff.')
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
    const { tr } = editing;
    const amount = Math.round(Number($('edAmount').value) * 100) / 100;
    const desc = $('edDesc').value.trim();
    if (!(amount > 0)) { toast(t('Enter an amount above RM 0.'), 'error'); return; }
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
    const { data, error } = await sb.from('transactions').update(payload).eq('id', tr.id).select('id');
    $('edSave').disabled = false;
    if (error) { toast(t('Not saved: ') + error.message, 'error'); return; }
    if (!data?.length) { toast(t('No access to edit this transaction.'), 'error'); return; }
    $('edDialog').close();
    toast(t('Transaction updated. The change is recorded in the Audit log.'));
    editing.done();
  });

  $('edDelete').onclick = async () => {
    if (!editing) return;
    const { tr, linked } = editing;
    const extra = linked === 'gaji' ? '\n\n' + t('The payslip will reopen as a draft.')
      : linked === 'advance' ? '\n\n' + t('This advance will be cancelled.') : '';
    if (!confirm(`${t('Delete this transaction?')}\n\n${tr.description || tr.category} · ${rm(tr.amount)}${extra}\n\n${t('The original record is kept in the Audit log.')}`)) return;
    $('edDelete').disabled = true;
    const { data, error } = await sb.from('transactions').delete().eq('id', tr.id).select('id');
    $('edDelete').disabled = false;
    if (error) { toast(t('Not deleted: ') + error.message, 'error'); return; }
    if (!data?.length) { toast(t('No access to delete this transaction.'), 'error'); return; }
    $('edDialog').close();
    toast(linked === 'gaji' ? t('Deleted. The payslip is a draft again in Staff.') : t('Transaction deleted.'));
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
  if (k === 'type') return v === 'In' ? t('Money in') : t('Money out');
  if (k === 'transaction_date') return dateShort(v);
  if (k === 'outlet_id') return outletName(v) || t('Other outlet');
  return String(v);
}

function auditHTML(a) {
  const o = a.old_data || {};
  const when = new Date(a.changed_at).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' });
  const who = a.changed_by === session.user.id ? t('You')
    : a.changed_by ? [t(ROLE_LABEL[a.changed_by_role] || 'User'), a.changed_by_email].filter(Boolean).join(' · ')
    : t('System (cleanup by owner)');
  let body;
  if (a.action === 'ubah') {
    const n = a.new_data || {};
    const diffs = Object.keys(FIELD).filter(k => String(o[k] ?? '') !== String(n[k] ?? ''));
    body = diffs.length
      ? diffs.map(k => `<div class="kv"><span>${t(FIELD[k])}</span><b>${esc(fieldVal(k, o[k]))} → ${esc(fieldVal(k, n[k]))}</b></div>`).join('')
      : `<p class="note">${t('No changes to the main details.')}</p>`;
  } else {
    body = `<div class="kv"><span>${esc(fieldVal('transaction_date', o.transaction_date))} · ${esc(o.category || '')}</span><b>${esc(fieldVal('amount', o.amount))}</b></div>`;
  }
  return `<div class="log">
    <b><i class="tag ${a.action === 'padam' ? 'off' : ''}">${a.action === 'padam' ? t('Deleted') : t('Edited')}</i> ${esc(o.description || o.category || t('Transaction'))}</b>
    ${body}
    ${a.note ? `<p class="note small">${esc(a.note)}</p>` : ''}
    <span>${esc(when)} · ${esc(who)}${session.outlets.length > 1 ? ' · ' + esc(outletName(a.outlet_id)) : ''}</span>
  </div>`;
}
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' };

async function renderAudit(box) {
  let offset = 0;
  box.innerHTML = `
    <p class="note-line small">${icon('lock')}${t('Only the owner and admins can see this log. It cannot be edited or deleted.')}</p>
    <section class="card"><div id="auList"></div>
      <p class="greet-sub" id="auStatus">Loading…</p>
      <button class="btn ghost block" id="auMore" type="button" hidden>${t('Load more')}</button></section>`;
  async function more() {
    $('auMore').hidden = true;
    let q = sb.from('transaction_audit')
      .select('id,outlet_id,transaction_id,action,old_data,new_data,note,changed_by,changed_by_email,changed_by_role,changed_at')
      .order('changed_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
    const { data, error } = await q;
    if (error) { $('auStatus').textContent = t('Could not load the audit log. Try again.'); return; }
    $('auList').insertAdjacentHTML('beforeend', data.map(auditHTML).join(''));
    offset += data.length;
    if (!offset) { $('auStatus').textContent = t('No transactions have been edited or deleted yet.'); return; }
    $('auStatus').hidden = true;
    $('auMore').hidden = data.length < PAGE_SIZE;
  }
  $('auMore').onclick = more;
  await more();
}
