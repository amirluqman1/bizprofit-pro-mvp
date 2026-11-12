// Rekod: Key In transaksi dan Sejarah transaksi.
// Staff hanya nampak transaksi yang dia sendiri masukkan hari ini (dikunci di database).
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, dateShort } from '../format.js';

const PAGE_SIZE = 30;
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

const tabFromHash = () => (location.hash.includes('t=sejarah') ? 'sejarah' : 'keyin');

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
  return `<li class="tx">
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
      </div>
      <div id="rekodBody"><section class="card"><p class="greet-sub">Memuatkan…</p></section></div>`;
    if (tab === 'sejarah') return renderHistory($('rekodBody'));
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
  let offset = 0;
  box.innerHTML = `
    ${session.role === 'staff' ? '<p class="note-line">' + icon('lock') + 'Anda hanya nampak transaksi yang anda masukkan hari ini.</p>' : ''}
    <section class="card"><ul class="tx-list" id="txList"></ul>
      <p class="greet-sub" id="txStatus">Memuatkan…</p>
      <button class="btn ghost block" id="txMore" type="button" hidden>Muat lagi</button></section>`;

  async function more() {
    $('txMore').hidden = true;
    $('txStatus').hidden = false; $('txStatus').textContent = 'Memuatkan…';
    let q = sb.from('transactions')
      .select('id,transaction_date,type,category,amount,description,outlet_id,created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
    const { data, error } = await q;
    if (error) { $('txStatus').textContent = 'Senarai transaksi tak dapat dibaca. Cuba lagi.'; return; }
    $('txList').insertAdjacentHTML('beforeend', data.map(rowHTML).join(''));
    offset += data.length;
    if (!offset) { $('txStatus').textContent = 'Belum ada transaksi.'; return; }
    $('txStatus').hidden = true;
    $('txMore').hidden = data.length < PAGE_SIZE;
  }
  $('txMore').onclick = more;
  await more();
}
