// List: senarai beli ringkas, berasingan dari Smart Inventori.
// - Tiada "patut ada", tiada noti habis/stok rendah.
// - Tak simpan ke database: disimpan dalam phone ni sahaja (localStorage),
//   jadi kuantiti kekal walaupun keluar/tutup app.
// - Kuantiti hanya reset ke 0 selepas "Copy ke WhatsApp" berjaya.
// - Tekan nama barang untuk edit (nama/kategori/unit); tekan lama untuk padam.
import { $, esc, toast, store } from '../ui.js';
import { session } from '../session.js';
import { t } from '../i18n.js';

const CATEGORIES = ['Barang Kering', 'Barang Plastik', 'Barang Air', 'Barang Basah'];
const OTHER = 'Lain-lain';
const UNITS = ['pack', 'pcs', 'kotak', 'botol', 'kg', 'biji', 'ekor', 'papan', 'liter', 'g', 'guni', 'tin'];
const LONG_PRESS = 600;

let list = [];
let editId = null;   // null = tambah baru, ada id = edit barang sedia ada
const key = () => 'bp:smartlist:' + (session.user?.id || 'anon');
const loadList = () => { try { list = JSON.parse(store.get(key()) || '[]'); } catch { list = []; } };
const saveList = () => store.set(key(), JSON.stringify(list));
const catOptions = () => [...CATEGORIES, OTHER].map(c => `<option value="${c}">${t(c)}</option>`).join('');
const unitOptions = () => `<option value="">${t('No unit')}</option>` + UNITS.map(u => `<option>${u}</option>`).join('');

function cardHTML(x) {
  return `<div class="item" data-id="${esc(x.id)}">
    <div class="item-top">
      <div class="item-name sl-name" data-hold="${esc(x.id)}">
        <h3>${esc(x.name)}</h3>
        <span class="sub">${esc(t(x.cat))}${x.unit ? ' · ' + esc(x.unit) : ''}</span>
      </div>
    </div>
    <div class="item-bottom">
      <div class="qty">${x.n}<small>${esc(x.unit)}</small></div>
      <div class="steppers">
        <button class="step minus" type="button" data-step="-1" data-id="${esc(x.id)}" aria-label="${t('One less {x}', { x: esc(x.name) })}" ${x.n <= 0 ? 'disabled' : ''}>−</button>
        <button class="step plus" type="button" data-step="1" data-id="${esc(x.id)}" aria-label="${t('One more {x}', { x: esc(x.name) })}">+</button>
      </div>
    </div>
  </div>`;
}

function render() {
  $('slItems').innerHTML = list.length ? list.map(cardHTML).join('')
    : `<div class="empty">${t('List is empty.')}<br>${t('Tap <b>+ Add</b> to add items.')}</div>`;
}

// Format WhatsApp ikut kategori; kuantiti 0 tak dimasukkan.
function buildText() {
  const order = [...CATEGORIES, OTHER];
  const groups = new Map();
  list.filter(x => x.n > 0).forEach(x => groups.set(x.cat, [...(groups.get(x.cat) || []), x]));
  return [...groups].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([cat, xs]) => [cat.toUpperCase(), ...xs.map(x => `• ${x.name} ${x.n}${x.unit ? ' ' + x.unit : ''}`)].join('\n'))
    .join('\n\n');
}

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

// Salin ke clipboard (sandaran) dan terus buka WhatsApp dengan mesej siap ditaip.
async function copyWhatsApp() {
  const count = list.filter(x => x.n > 0).length;
  if (!count) { toast(t('All quantities are 0. Tap + first.')); return; }
  const text = buildText();
  const copied = await copyText(text);
  list.forEach(x => { x.n = 0; });
  saveList(); render();
  toast(copied ? t('List copied ({n} items). Opening WhatsApp…', { n: count }) : t('Opening WhatsApp…'));
  location.href = 'whatsapp://send?text=' + encodeURIComponent(text);
}

export function smartListHTML() {
  return `
  <dialog id="slDialog" class="sl-dialog">
    <div class="sl-head">
      <h2>${t('List')}</h2>
      <div class="sl-head-btns">
        <button class="btn ghost" type="button" id="slClearAll">${t('Delete all')}</button>
        <button class="btn ghost" type="button" id="slImport">${t('Import from Stock')}</button>
        <button class="btn ghost" type="button" id="slClose">${t('Close')}</button>
      </div>
    </div>
    <div class="sl-tools">
      <button class="btn primary" id="slCopy" type="button">${t('Copy to WhatsApp')}</button>
      <button class="btn white" id="slOpenAdd" type="button">${t('+ Add')}</button>
    </div>
    <div id="slItems" class="sl-items"></div>
    <p class="greet-sub center">${t('Tap an item name to edit it. Long-press to delete. Quantities reset to 0 after copying.')}</p>
  </dialog>

  <dialog id="slAddDialog"><form id="slAddForm" class="stack" novalidate>
    <h2 id="slFormTitle">${t('Add to list')}</h2>
    <label class="field">${t('Item name')}<input id="slName" maxlength="120" placeholder="${t('e.g. Rice 10kg')}"></label>
    <div class="two">
      <label class="field">${t('Category')}<select id="slCat">${catOptions()}</select></label>
      <label class="field">${t('Unit')}<select id="slUnit">${unitOptions()}</select></label>
    </div>
    <div class="dialog-actions"><button class="btn ghost" type="button" id="slDelete" hidden>${t('Delete')}</button><button class="btn ghost" type="button" id="slAddCancel">${t('Cancel')}</button><button class="btn primary">${t('Save')}</button></div>
  </form></dialog>`;
}

// Salin nama, kategori dan unit dari Smart Inventori (kuantiti mula 0).
// Barang yang namanya dah ada dalam List dilangkau.
function importFromStock(stock) {
  if (!stock.length) { toast(t('No stock items to import.')); return; }
  const have = new Set(list.map(x => x.name.toLowerCase()));
  let added = 0;
  stock.forEach((s, i) => {
    const name = String(s.name || '').trim();
    if (!name || have.has(name.toLowerCase())) return;
    have.add(name.toLowerCase());
    list.push({ id: Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 5),
      name, cat: s.category || OTHER, unit: s.unit || '', n: 0 });
    added++;
  });
  saveList(); render();
  toast(added ? t('{n} items imported from Stock.', { n: added }) : t('All stock items are already in the List.'));
}

export function bindSmartList(getStock = () => []) {
  let holdTimer = null;
  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

  $('slClose').onclick = () => $('slDialog').close();
  $('slCopy').onclick = copyWhatsApp;
  $('slImport').onclick = () => importFromStock(getStock());
  // Padam semua barang dalam List (contoh: nak import semula dari Stok).
  $('slClearAll').onclick = () => {
    if (!list.length) { toast(t('List is already empty.')); return; }
    if (!confirm(t('Delete all {n} items from the list? This cannot be undone.', { n: list.length }))) return;
    list = [];
    saveList(); render();
    toast(t('All items deleted. Tap Import from Stock to add them again.'));
  };
  $('slAddCancel').onclick = () => $('slAddDialog').close();
  const openForm = x => {
    editId = x ? x.id : null;
    $('slAddForm').reset();
    $('slFormTitle').textContent = x ? t('Edit item') : t('Add to list');
    $('slDelete').hidden = !x;
    if (x) {
      $('slName').value = x.name;
      $('slCat').value = [...CATEGORIES, OTHER].includes(x.cat) ? x.cat : OTHER;
      if (x.unit && ![...$('slUnit').options].some(o => o.value === x.unit)) $('slUnit').add(new Option(x.unit, x.unit));
      $('slUnit').value = x.unit || '';
    }
    $('slAddDialog').showModal();
    $('slName').focus();
  };
  $('slOpenAdd').onclick = () => openForm(null);
  $('slDelete').onclick = () => {
    const x = list.find(i => i.id === editId);
    if (!x || !confirm(t('Delete "{x}" from the list?', { x: x.name }))) return;
    list = list.filter(i => i !== x);
    saveList(); render();
    $('slAddDialog').close();
    toast(t('Item deleted from the list.'));
  };
  $('slAddForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('slName').value.trim();
    if (!name) { toast(t('Enter an item name.'), 'error'); return; }
    if (list.some(x => x.id !== editId && x.name.toLowerCase() === name.toLowerCase())) { toast(t('This item is already in the list.'), 'error'); return; }
    const x = editId && list.find(i => i.id === editId);
    if (x) Object.assign(x, { name, cat: $('slCat').value, unit: $('slUnit').value });  // kuantiti kekal
    else list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, cat: $('slCat').value, unit: $('slUnit').value, n: 0 });
    saveList(); render();
    if (x) toast(t('Item updated.'));
    $('slAddDialog').close();
  });

  const items = $('slItems');
  let holdFired = false;   // tekan lama dah jalan: jangan buka edit pada klik yang sama
  items.addEventListener('click', e => {
    const name = e.target.closest('[data-hold]');
    if (name) {
      if (holdFired) { holdFired = false; return; }
      openForm(list.find(i => i.id === name.dataset.hold));
      return;
    }
    const step = e.target.closest('[data-step]');
    if (!step) return;
    const x = list.find(i => i.id === step.dataset.id);
    if (!x) return;
    x.n = Math.max(0, x.n + Number(step.dataset.step));
    saveList();
    const el = items.querySelector(`.item[data-id="${CSS.escape(x.id)}"]`);
    if (el) el.outerHTML = cardHTML(x);
  });
  // Tekan lama untuk padam.
  items.addEventListener('pointerdown', e => {
    const hold = e.target.closest('[data-hold]');
    if (!hold) return;
    cancelHold();
    holdFired = false;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      holdFired = true;
      const x = list.find(i => i.id === hold.dataset.hold);
      if (x && confirm(t('Delete "{x}" from the list?', { x: x.name }))) {
        list = list.filter(i => i !== x);
        saveList(); render();
        toast(t('Item deleted from the list.'));
      }
    }, LONG_PRESS);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach(ev =>
    items.addEventListener(ev, e => { if (ev !== 'pointermove' || Math.abs(e.movementX) + Math.abs(e.movementY) > 6) cancelHold(); }));
  items.addEventListener('contextmenu', e => { if (e.target.closest('[data-hold]')) e.preventDefault(); });
}

export function openSmartList() {
  loadList();
  render();
  $('slDialog').showModal();
}
