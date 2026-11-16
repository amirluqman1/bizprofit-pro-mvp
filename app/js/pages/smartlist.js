// List: senarai beli ringkas, berasingan dari Smart Inventori.
// - Tiada "patut ada", tiada noti habis/stok rendah.
// - Tak simpan ke database: disimpan dalam phone ni sahaja (localStorage),
//   jadi kuantiti kekal walaupun keluar/tutup app.
// - Kuantiti hanya reset ke 0 selepas "Copy ke WhatsApp" berjaya.
// - Tekan lama nama barang untuk padam.
import { $, esc, toast, store } from '../ui.js';
import { session } from '../session.js';

const CATEGORIES = ['Barang Kering', 'Barang Plastik', 'Barang Air', 'Barang Basah'];
const OTHER = 'Lain-lain';
const UNITS = ['pack', 'pcs', 'kotak', 'botol', 'kg', 'biji', 'ekor', 'papan', 'liter', 'g', 'guni', 'tin'];
const LONG_PRESS = 600;

let list = [];
const key = () => 'bp:smartlist:' + (session.user?.id || 'anon');
const loadList = () => { try { list = JSON.parse(store.get(key()) || '[]'); } catch { list = []; } };
const saveList = () => store.set(key(), JSON.stringify(list));
const catOptions = () => [...CATEGORIES, OTHER].map(c => `<option>${c}</option>`).join('');
const unitOptions = () => '<option value="">(tiada unit)</option>' + UNITS.map(u => `<option>${u}</option>`).join('');

function cardHTML(x) {
  return `<div class="item" data-id="${esc(x.id)}">
    <div class="item-top">
      <div class="item-name sl-name" data-hold="${esc(x.id)}">
        <h3>${esc(x.name)}</h3>
        <span class="sub">${esc(x.cat)}${x.unit ? ' · ' + esc(x.unit) : ''}</span>
      </div>
    </div>
    <div class="item-bottom">
      <div class="qty">${x.n}<small>${esc(x.unit)}</small></div>
      <div class="steppers">
        <button class="step minus" type="button" data-step="-1" data-id="${esc(x.id)}" aria-label="Kurang satu ${esc(x.name)}" ${x.n <= 0 ? 'disabled' : ''}>−</button>
        <button class="step plus" type="button" data-step="1" data-id="${esc(x.id)}" aria-label="Tambah satu ${esc(x.name)}">+</button>
      </div>
    </div>
  </div>`;
}

function render() {
  $('slItems').innerHTML = list.length ? list.map(cardHTML).join('')
    : '<div class="empty">List kosong.<br>Tekan <b>+ Tambah</b> untuk masukkan barang.</div>';
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
  if (!count) { toast('Semua kuantiti 0. Tekan + dulu.'); return; }
  const text = buildText();
  const copied = await copyText(text);
  list.forEach(x => { x.n = 0; });
  saveList(); render();
  toast(copied ? `List disalin (${count} barang). Membuka WhatsApp…` : 'Membuka WhatsApp…');
  location.href = 'whatsapp://send?text=' + encodeURIComponent(text);
}

export function smartListHTML() {
  return `
  <dialog id="slDialog" class="sl-dialog">
    <div class="sl-head">
      <h2>List</h2>
      <div class="sl-head-btns">
        <button class="btn ghost" type="button" id="slImport">Ambil dari Stok</button>
        <button class="btn ghost" type="button" id="slClose">Tutup</button>
      </div>
    </div>
    <div class="sl-tools">
      <button class="btn primary" id="slCopy" type="button">Copy ke WhatsApp</button>
      <button class="btn white" id="slOpenAdd" type="button">+ Tambah</button>
    </div>
    <div id="slItems" class="sl-items"></div>
    <p class="greet-sub center">Tekan lama nama barang untuk padam. Kuantiti jadi 0 selepas copy.</p>
  </dialog>

  <dialog id="slAddDialog"><form id="slAddForm" class="stack" novalidate>
    <h2>Tambah ke list</h2>
    <label class="field">Nama barang<input id="slName" maxlength="120" placeholder="Contoh: Beras merong 10kg"></label>
    <div class="two">
      <label class="field">Kategori<select id="slCat">${catOptions()}</select></label>
      <label class="field">Unit<select id="slUnit">${unitOptions()}</select></label>
    </div>
    <div class="dialog-actions"><button class="btn ghost" type="button" id="slAddCancel">Batal</button><button class="btn primary">Simpan</button></div>
  </form></dialog>`;
}

// Salin nama, kategori dan unit dari Smart Inventori (kuantiti mula 0).
// Barang yang namanya dah ada dalam List dilangkau.
function importFromStock(stock) {
  if (!stock.length) { toast('Tiada barang dalam stok untuk diambil.'); return; }
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
  toast(added ? `${added} barang diambil dari Stok.` : 'Semua barang stok dah ada dalam List.');
}

export function bindSmartList(getStock = () => []) {
  let holdTimer = null;
  const cancelHold = () => { clearTimeout(holdTimer); holdTimer = null; };

  $('slClose').onclick = () => $('slDialog').close();
  $('slCopy').onclick = copyWhatsApp;
  $('slImport').onclick = () => importFromStock(getStock());
  $('slAddCancel').onclick = () => $('slAddDialog').close();
  $('slOpenAdd').onclick = () => {
    $('slAddForm').reset();
    $('slAddDialog').showModal();
    $('slName').focus();
  };
  $('slAddForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('slName').value.trim();
    if (!name) { toast('Isi nama barang.', 'error'); return; }
    if (list.some(x => x.name.toLowerCase() === name.toLowerCase())) { toast('Barang ni dah ada dalam list.', 'error'); return; }
    list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, cat: $('slCat').value, unit: $('slUnit').value, n: 0 });
    saveList(); render();
    $('slAddDialog').close();
  });

  const items = $('slItems');
  items.addEventListener('click', e => {
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
    holdTimer = setTimeout(() => {
      holdTimer = null;
      const x = list.find(i => i.id === hold.dataset.hold);
      if (x && confirm(`Padam "${x.name}" dari list?`)) {
        list = list.filter(i => i !== x);
        saveList(); render();
        toast('Barang dipadam dari list.');
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
