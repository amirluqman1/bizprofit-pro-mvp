// Stok: Smart Inventori dalam app baru.
// Semua role boleh tambah barang dan ubah "berapa ada" (outlet sendiri; owner semua outlet).
// Nama, unit dan "patut ada" hanya owner boleh ubah (dikunci di database).
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { qty, rm } from '../format.js';
import { smartListHTML, bindSmartList, openSmartList } from './smartlist.js';

const SAVE_DELAY = 3000;           // simpan selepas berhenti tekan − / +
const UNITS = ['kg', 'pcs', 'biji', 'pack', 'kotak', 'botol', 'ekor', 'papan', 'liter', 'g'];
const CATEGORIES = ['Barang Kering', 'Barang Plastik', 'Barang Air', 'Barang Basah'];
const OTHER = 'Lain-lain';
const LABEL = { habis: 'Out of stock', rendah: 'Low stock', ok: 'Stock OK', unset: 'Not set' };

let items = [];
let prices = new Map();           // inventory_item_id -> harga seunit (owner/admin sahaja)
let editing = null;
const pending = new Map();         // id -> timer
const inflight = new Set();        // simpanan yang sedang dihantar

// "Patut ada" 0 = owner belum tetapkan; jangan tanda Habis.
const status = x => (Number(x.target_qty) <= 0 ? 'unset' : Number(x.current_qty) <= 0 ? 'habis' : Number(x.current_qty) < Number(x.target_qty) ? 'rendah' : 'ok');
const kurang = x => Math.max(0, Number(x.target_qty) - Number(x.current_qty));
const find = id => items.find(x => x.id === id);
const allMode = () => session.outletId === ALL_OUTLETS;
const canSeeLogs = () => session.isManagerUp;
const stockChanged = () => window.dispatchEvent(new Event('bp:stock-changed'));
const errText = e => (e?.code === '23505' ? 'An item with this name already exists in this outlet.' : e?.message || 'Unknown error.');
const catOf = x => x.category || OTHER;
const catOptions = (sel = OTHER) => [...CATEGORIES, OTHER].map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const unitOptions = sel => UNITS.map(u => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('');

function cardHTML(x) {
  const st = status(x);
  return `<div class="item" data-id="${esc(x.id)}">
    <div class="item-top">
      <button class="item-name" type="button" data-open="${esc(x.id)}">
        <h3>${esc(x.name)}</h3>
        <span class="sub">${esc(catOf(x))} · Target ${qty(x.target_qty)} ${esc(x.unit)}${prices.has(x.id) ? ' · ' + esc(rm(prices.get(x.id))) + '/' + esc(x.unit) : ''}${allMode() ? ' · ' + esc(outletName(x.outlet_id)) : ''}</span>
      </button>
      <span class="pill ${st}">${LABEL[st]}</span>
    </div>
    <div class="item-bottom">
      <div>
        <button class="qty" type="button" data-open="${esc(x.id)}" aria-label="Type quantity for ${esc(x.name)}">${qty(x.current_qty)}<small>${esc(x.unit)}</small></button>
        <span class="saving" data-saving="${esc(x.id)}"></span>
      </div>
      <div class="steppers">
        <button class="step minus" type="button" data-step="-1" data-id="${esc(x.id)}" aria-label="One less ${esc(x.name)}" ${Number(x.current_qty) <= 0 ? 'disabled' : ''}>−</button>
        <button class="step plus" type="button" data-step="1" data-id="${esc(x.id)}" aria-label="One more ${esc(x.name)}">+</button>
      </div>
    </div>
  </div>`;
}

function renderSummary() {
  const habis = items.filter(x => status(x) === 'habis').length;
  const rendah = items.filter(x => status(x) === 'rendah').length;
  const parts = [];
  if (habis) parts.push(`${habis} out of stock`);
  if (rendah) parts.push(`${rendah} low stock`);
  const a = $('stokAlert');
  a.textContent = parts.length ? '⚠ ' + parts.join(', ') + '.' : '';
  a.hidden = !parts.length;
  a.classList.toggle('danger', habis > 0);
}

function renderAll() {
  renderSummary();
  $('stokItems').innerHTML = items.length ? items.map(cardHTML).join('')
    : '<div class="empty">No items yet' + (allMode() ? '' : ' in this outlet') + '.<br>Tap <b>+ Add</b> to start.</div>';
}

function renderCard(id, savingText) {
  const x = find(id);
  const el = document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (!x || !el) return;
  el.outerHTML = cardHTML(x);
  if (savingText !== undefined) setSaving(id, savingText);
  renderSummary();
}
function setSaving(id, text) {
  const el = document.querySelector(`[data-saving="${CSS.escape(id)}"]`);
  if (el) el.textContent = text;
}

async function load() {
  await flushAll();
  // '*' supaya tak gagal jika kolum created_at belum wujud.
  let q = sb.from('inventory_items').select('*');
  if (!allMode()) q = q.eq('outlet_id', session.outletId);
  const [{ data, error }, pr] = await Promise.all([
    q,
    session.isAdminUp ? sb.from('ingredient_costs').select('inventory_item_id,unit_price') : Promise.resolve({ data: [] })
  ]);
  if (error) throw error;
  prices = new Map((pr.data || []).map(p => [p.inventory_item_id, Number(p.unit_price)]));
  // Ikut turutan barang ditambah: barang baru sentiasa di bawah.
  // (Dulu disusun ikut status + abjad, jadi barang baru melompat ke atas/tengah.)
  const t = x => (x.created_at ? Date.parse(x.created_at) : 0);
  items = (data || []).sort((a, b) => t(a) - t(b) || a.name.localeCompare(b.name, 'ms-MY'));
}

// ---------- − / + : simpan sekali selepas berhenti menekan ----------
function bump(id, delta) {
  const x = find(id);
  if (!x) return;
  if (!pending.has(id)) x._saved = Number(x.current_qty);
  x.current_qty = Math.max(0, Math.round((Number(x.current_qty) + delta) * 1000) / 1000);
  clearTimeout(pending.get(id));
  pending.set(id, setTimeout(() => save(id), SAVE_DELAY));
  renderCard(id, 'Not saved yet…');
}

function save(id) {
  clearTimeout(pending.get(id));
  pending.delete(id);
  const p = doSave(id);
  inflight.add(p);
  p.finally(() => inflight.delete(p));
  return p;
}

async function doSave(id) {
  const x = find(id);
  if (!x) return;
  if (Number(x.current_qty) === x._saved) { setSaving(id, ''); return; }
  setSaving(id, 'Saving…');
  const { data, error } = await sb.from('inventory_items').update({ current_qty: x.current_qty })
    .eq('id', id).eq('outlet_id', x.outlet_id).select('id');
  if (error || !data?.length) {
    x.current_qty = x._saved;
    renderCard(id, '');
    toast(error ? 'Save failed: ' + errText(error) : 'No access to edit this item.', 'error');
    return;
  }
  x._saved = Number(x.current_qty);
  renderCard(id, '✓ Saved');
  setTimeout(() => setSaving(id, ''), 1800);
  stockChanged();
}

// Harga seunit untuk food cost. Kosong = buang harga.
async function savePrice(id, raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    if (!prices.has(id)) return null;
    const { error } = await sb.from('ingredient_costs').delete().eq('inventory_item_id', id);
    return error;
  }
  const { error } = await sb.from('ingredient_costs').upsert({ inventory_item_id: id, unit_price: Number(text) });
  return error;
}
const priceOk = raw => String(raw ?? '').trim() === '' || (Number.isFinite(Number(raw)) && Number(raw) >= 0);
const priceField = id => session.isAdminUp
  ? `<label class="field">Price per unit (RM) <small>optional · for food cost · only owner &amp; admin see this</small><input id="${id}" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 9.50"></label>` : '';

function flushAll() { return Promise.all([...[...pending.keys()].map(save), ...inflight]); }

// ---------- Dialog ----------
function dialogsHTML() {
  const outletSel = session.isOwner && session.outlets.length > 1
    ? `<label class="field">Outlet<select id="addOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `
  <dialog id="addDialog"><form id="addForm" class="stack" novalidate>
    <h2>Add item</h2>
    <p class="note">After saving, only the owner or an admin can change the name, category, unit or "target".</p>
    ${outletSel}
    <label class="field">Item name<input id="addName" maxlength="120" placeholder="e.g. Chicken fillet"></label>
    <div class="two">
      <label class="field">Category<select id="addCat">${catOptions()}</select></label>
      <label class="field">Unit<select id="addUnit">${unitOptions('kg')}</select></label>
    </div>
    <div class="two">
      <label class="field">In stock<input id="addCurrent" type="number" inputmode="decimal" min="0" step="any" value="0"></label>
      <label class="field">Target<input id="addTarget" type="number" inputmode="decimal" min="0" step="any" placeholder="20"></label>
    </div>
    ${priceField('addPrice')}
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="addDialog">Cancel</button><button class="btn primary" id="addSave">Save</button></div>
  </form></dialog>

  <dialog id="editDialog"><form id="editForm" class="stack" novalidate>
    <h2 id="editTitle"></h2>
    <label class="field">In stock now<input id="editCurrent" type="number" inputmode="decimal" min="0" step="any"></label>
    <div id="ownerFields" class="stack">
      <label class="field">Item name<input id="editName" maxlength="120"></label>
      <label class="field">Category<select id="editCat">${catOptions()}</select></label>
      <div class="two">
        <label class="field">Unit<select id="editUnit">${unitOptions()}</select></label>
        <label class="field">Target<input id="editTarget" type="number" inputmode="decimal" min="0" step="any"></label>
      </div>
      ${priceField('editPrice')}
    </div>
    <p id="editNote" class="note"></p>
    <div class="dialog-actions">
      <button class="btn ghost" type="button" id="openHistory">History</button>
      <button class="btn ghost" type="button" data-close="editDialog">Cancel</button>
      <button class="btn primary" id="editSave">Save</button>
    </div>
  </form></dialog>

  <dialog id="historyDialog">
    <div class="trend-head"><h2 id="historyTitle"></h2><button class="btn ghost" type="button" data-close="historyDialog">Close</button></div>
    <div id="historyList"></div>
  </dialog>`;
}

function openEdit(x) {
  if (!x) return;
  editing = x;
  $('editTitle').textContent = x.name;
  $('editCurrent').value = x.current_qty;
  $('ownerFields').hidden = !session.isAdminUp;
  if (session.isAdminUp) {
    $('editName').value = x.name;
    $('editCat').value = catOf(x);
    if (![...$('editUnit').options].some(o => o.value === x.unit)) $('editUnit').add(new Option(x.unit, x.unit));
    $('editUnit').value = x.unit;
    $('editTarget').value = x.target_qty;
    $('editPrice').value = prices.has(x.id) ? prices.get(x.id) : '';
  }
  $('editNote').textContent = session.isAdminUp ? 'Every quantity change is recorded in history.'
    : `Target: ${qty(x.target_qty)} ${x.unit}. Only the owner or an admin can change the name, category, unit or target.`;
  $('openHistory').hidden = !canSeeLogs();
  $('editDialog').showModal();
}

async function openHistory() {
  const x = editing;
  if (!x || !canSeeLogs()) return;
  $('editDialog').close();
  $('historyTitle').textContent = 'History · ' + x.name;
  $('historyList').innerHTML = '<p class="note">Loading…</p>';
  $('historyDialog').showModal();
  const [{ data, error }, { data: staff }] = await Promise.all([
    sb.from('inventory_stock_logs').select('previous_qty,new_qty,note,changed_by,created_at')
      .eq('inventory_item_id', x.id).order('created_at', { ascending: false }).limit(30),
    sb.from('staff_profiles').select('user_id,role')
  ]);
  if (error) { $('historyList').innerHTML = `<p class="note">Could not load history: ${esc(error.message)}</p>`; return; }
  if (!data.length) { $('historyList').innerHTML = '<p class="note">No history yet.</p>'; return; }
  const roles = new Map((staff || []).map(s => [s.user_id, s.role]));
  const roleName = r => ({ owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' }[r] || 'Outlet member');
  $('historyList').innerHTML = data.map(l => {
    const who = l.changed_by === session.user.id ? 'You' : roleName(roles.get(l.changed_by));
    const when = new Date(l.created_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' });
    return `<div class="log"><b>${qty(l.previous_qty)} → ${qty(l.new_qty)} ${esc(x.unit)}</b><br>
      <span>${esc(when)} · ${esc(who)}${l.note ? ' · ' + esc(l.note) : ''}</span></div>`;
  }).join('');
}

// ---------- Copy ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

// Senarai beli untuk WhatsApp, dikumpul ikut outlet kemudian kategori:
//   BARANG KERING
//   • Ayam 6 kg
async function copyList() {
  await flushAll();
  const perlu = items.filter(x => kurang(x) > 0);
  if (!perlu.length) { toast('All stock is sufficient. Nothing to buy.'); return; }
  const groupBy = (list, key) => list.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) || []), x]), new Map());
  const order = [...CATEGORIES, OTHER];
  const block = list => [...groupBy(list, catOf)].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([cat, xs]) => [cat.toUpperCase(), ...xs.map(x => `• ${x.name} ${qty(kurang(x))} ${x.unit}`)].join('\n')).join('\n\n');
  const byOutlet = groupBy(perlu, x => x.outlet_id);
  const text = byOutlet.size > 1 || allMode()
    ? [...byOutlet].map(([oid, list]) => `*${outletName(oid)}*\n\n${block(list)}`).join('\n\n')
    : block(perlu);
  toast(await copyText(text) ? `Shopping list copied (${perlu.length} items). Paste into WhatsApp.` : 'Copy failed. Try again.',
    undefined);
}

// ---------- Halaman ----------
export default {
  async render(view) {
    view.innerHTML = `
      <div id="stokAlert" class="alert" role="status" hidden></div>
      <div class="section-row">
        <h2 class="section-title">Raw Material Stock</h2>
        <button class="btn white" id="openAdd" type="button">+ Add</button>
      </div>
      <div class="tools">
        <button class="btn primary" id="copyList" type="button">Copy shopping list</button>
        <button class="btn ghost" id="openSmartList" type="button">List</button>
        <button class="btn ghost" id="stokRefresh" type="button" aria-label="Refresh">↻</button>
      </div>
      <div id="stokItems"><div class="skel"></div></div>
      <p class="greet-sub center">Tap the number to type an exact quantity. Every change is recorded.</p>
      ${dialogsHTML()}
      ${smartListHTML()}`;

    try { await load(); renderAll(); }
    catch { $('stokItems').innerHTML = '<div class="empty">Could not load stock. Check your internet and tap ↻.</div>'; }

    view.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
    $('stokItems').addEventListener('click', e => {
      const step = e.target.closest('[data-step]');
      if (step) { bump(step.dataset.id, Number(step.dataset.step)); return; }
      const open = e.target.closest('[data-open]');
      if (open) openEdit(find(open.dataset.open));
    });
    $('stokRefresh').onclick = async () => {
      try { await load(); renderAll(); } catch { toast('Could not load stock.', 'error'); }
    };
    $('copyList').onclick = copyList;
    $('openSmartList').onclick = openSmartList;
    bindSmartList(() => items);
    $('openHistory').onclick = openHistory;

    $('openAdd').onclick = () => {
      $('addForm').reset();
      if ($('addOutlet')) $('addOutlet').value = allMode() ? session.profile.outlet_id : session.outletId;
      $('addDialog').showModal();
      $('addName').focus();
    };
    $('addForm').addEventListener('submit', async e => {
      e.preventDefault();
      const payload = {
        outlet_id: $('addOutlet') ? $('addOutlet').value : (allMode() ? session.profile.outlet_id : session.outletId),
        name: $('addName').value.trim(),
        unit: $('addUnit').value,
        category: $('addCat').value === OTHER ? null : $('addCat').value,
        current_qty: Number($('addCurrent').value),
        target_qty: Number($('addTarget').value)
      };
      const ok = v => Number.isFinite(v) && v >= 0;
      if (!payload.name) { toast('Enter an item name.', 'error'); return; }
      if ($('addTarget').value.trim() === '' || !ok(payload.current_qty) || !ok(payload.target_qty)) {
        toast('Please enter a valid quantity (0 or more).', 'error'); return;
      }
      if ($('addPrice') && !priceOk($('addPrice').value)) { toast('Invalid price.', 'error'); return; }
      $('addSave').disabled = true;
      const { data: added, error } = await sb.from('inventory_items').insert(payload).select('id').single();
      if (error) { $('addSave').disabled = false; toast('Add failed: ' + errText(error), 'error'); return; }
      const pErr = $('addPrice') ? await savePrice(added.id, $('addPrice').value) : null;
      $('addSave').disabled = false;
      $('addDialog').close();
      toast(pErr ? 'Item added, but the price was not saved: ' + errText(pErr) : 'Item added.', pErr ? 'error' : undefined);
      await load(); renderAll(); stockChanged();
    });

    $('editForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!editing) return;
      await flushAll();
      const payload = { current_qty: Number($('editCurrent').value) };
      const ok = v => Number.isFinite(v) && v >= 0;
      if ($('editCurrent').value.trim() === '' || !ok(payload.current_qty)) { toast('Invalid quantity.', 'error'); return; }
      if (session.isAdminUp) {
        payload.name = $('editName').value.trim();
        payload.unit = $('editUnit').value;
        payload.category = $('editCat').value === OTHER ? null : $('editCat').value;
        payload.target_qty = Number($('editTarget').value);
        if (!payload.name || !ok(payload.target_qty)) { toast('Invalid name or target.', 'error'); return; }
        if (!priceOk($('editPrice').value)) { toast('Invalid price.', 'error'); return; }
      }
      $('editSave').disabled = true;
      const { data, error } = await sb.from('inventory_items').update(payload)
        .eq('id', editing.id).eq('outlet_id', editing.outlet_id).select('id');
      $('editSave').disabled = false;
      if (error) { toast('Save failed: ' + errText(error), 'error'); return; }
      if (!data?.length) { toast('Nothing was saved. You may not have access.', 'error'); return; }
      const pErr = session.isAdminUp ? await savePrice(editing.id, $('editPrice').value) : null;
      $('editDialog').close();
      toast(pErr ? 'Stock updated, but the price was not saved: ' + errText(pErr) : 'Stock updated.', pErr ? 'error' : undefined);
      await load(); renderAll(); stockChanged();
    });

    // Bila tinggalkan halaman (tukar tab/outlet), simpan apa yang belum disimpan.
    const onHide = () => { if (document.hidden) flushAll(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushAll(); };
  }
};
