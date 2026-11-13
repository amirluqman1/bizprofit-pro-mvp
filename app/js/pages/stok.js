// Stok: Smart Inventori dalam app baru.
// Semua role boleh tambah barang dan ubah "berapa ada" (outlet sendiri; owner semua outlet).
// Nama, unit dan "patut ada" hanya owner boleh ubah (dikunci di database).
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { qty } from '../format.js';

const SAVE_DELAY = 3000;           // simpan selepas berhenti tekan − / +
const UNITS = ['kg', 'pcs', 'biji', 'pack', 'kotak', 'ekor', 'papan', 'liter', 'g'];
const CATEGORIES = ['Barang Kering', 'Barang Plastik', 'Barang Air', 'Barang Basah'];
const OTHER = 'Lain-lain';
const LABEL = { habis: 'Habis', rendah: 'Stok rendah', ok: 'Stok OK', unset: 'Belum set' };

let items = [];
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
const errText = e => (e?.code === '23505' ? 'Nama barang ini dah wujud dalam outlet ni.' : e?.message || 'Ralat tidak diketahui.');
const catOf = x => x.category || OTHER;
const catOptions = (sel = OTHER) => [...CATEGORIES, OTHER].map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
const unitOptions = sel => UNITS.map(u => `<option ${u === sel ? 'selected' : ''}>${u}</option>`).join('');

function cardHTML(x) {
  const st = status(x);
  return `<div class="item" data-id="${esc(x.id)}">
    <div class="item-top">
      <button class="item-name" type="button" data-open="${esc(x.id)}">
        <h3>${esc(x.name)}</h3>
        <span class="sub">${esc(catOf(x))} · Patut ada ${qty(x.target_qty)} ${esc(x.unit)}${allMode() ? ' · ' + esc(outletName(x.outlet_id)) : ''}</span>
      </button>
      <span class="pill ${st}">${LABEL[st]}</span>
    </div>
    <div class="item-bottom">
      <div>
        <button class="qty" type="button" data-open="${esc(x.id)}" aria-label="Taip jumlah ${esc(x.name)}">${qty(x.current_qty)}<small>${esc(x.unit)}</small></button>
        <span class="saving" data-saving="${esc(x.id)}"></span>
      </div>
      <div class="steppers">
        <button class="step minus" type="button" data-step="-1" data-id="${esc(x.id)}" aria-label="Kurang satu ${esc(x.name)}" ${Number(x.current_qty) <= 0 ? 'disabled' : ''}>−</button>
        <button class="step plus" type="button" data-step="1" data-id="${esc(x.id)}" aria-label="Tambah satu ${esc(x.name)}">+</button>
      </div>
    </div>
  </div>`;
}

function renderSummary() {
  const habis = items.filter(x => status(x) === 'habis').length;
  const rendah = items.filter(x => status(x) === 'rendah').length;
  const parts = [];
  if (habis) parts.push(`${habis} barang habis`);
  if (rendah) parts.push(`${rendah} stok rendah`);
  const a = $('stokAlert');
  a.textContent = parts.length ? '⚠ ' + parts.join(', ') + '.' : '';
  a.hidden = !parts.length;
  a.classList.toggle('danger', habis > 0);
}

function renderAll() {
  renderSummary();
  $('stokItems').innerHTML = items.length ? items.map(cardHTML).join('')
    : '<div class="empty">Belum ada barang' + (allMode() ? '' : ' dalam outlet ini') + '.<br>Tekan <b>+ Tambah</b> untuk mula.</div>';
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
  const { data, error } = await q;
  if (error) throw error;
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
  renderCard(id, 'Belum disimpan…');
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
  setSaving(id, 'Menyimpan…');
  const { data, error } = await sb.from('inventory_items').update({ current_qty: x.current_qty })
    .eq('id', id).eq('outlet_id', x.outlet_id).select('id');
  if (error || !data?.length) {
    x.current_qty = x._saved;
    renderCard(id, '');
    toast(error ? 'Gagal simpan: ' + errText(error) : 'Tiada akses untuk ubah barang ini.', 'error');
    return;
  }
  x._saved = Number(x.current_qty);
  renderCard(id, '✓ Disimpan');
  setTimeout(() => setSaving(id, ''), 1800);
  stockChanged();
}

function flushAll() { return Promise.all([...[...pending.keys()].map(save), ...inflight]); }

// ---------- Dialog ----------
function dialogsHTML() {
  const outletSel = session.isOwner && session.outlets.length > 1
    ? `<label class="field">Outlet<select id="addOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `
  <dialog id="addDialog"><form id="addForm" class="stack" novalidate>
    <h2>Tambah barang</h2>
    <p class="note">Selepas disimpan, hanya owner boleh ubah nama, kategori, unit atau "patut ada".</p>
    ${outletSel}
    <label class="field">Nama barang<input id="addName" maxlength="120" placeholder="Contoh: Ayam fillet"></label>
    <div class="two">
      <label class="field">Kategori<select id="addCat">${catOptions()}</select></label>
      <label class="field">Unit<select id="addUnit">${unitOptions('kg')}</select></label>
    </div>
    <div class="two">
      <label class="field">Berapa ada<input id="addCurrent" type="number" inputmode="decimal" min="0" step="any" value="0"></label>
      <label class="field">Patut ada<input id="addTarget" type="number" inputmode="decimal" min="0" step="any" placeholder="20"></label>
    </div>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close="addDialog">Batal</button><button class="btn primary" id="addSave">Simpan</button></div>
  </form></dialog>

  <dialog id="editDialog"><form id="editForm" class="stack" novalidate>
    <h2 id="editTitle"></h2>
    <label class="field">Berapa ada sekarang<input id="editCurrent" type="number" inputmode="decimal" min="0" step="any"></label>
    <div id="ownerFields" class="stack">
      <label class="field">Nama barang<input id="editName" maxlength="120"></label>
      <label class="field">Kategori<select id="editCat">${catOptions()}</select></label>
      <div class="two">
        <label class="field">Unit<select id="editUnit">${unitOptions()}</select></label>
        <label class="field">Patut ada<input id="editTarget" type="number" inputmode="decimal" min="0" step="any"></label>
      </div>
    </div>
    <p id="editNote" class="note"></p>
    <div class="dialog-actions">
      <button class="btn ghost" type="button" id="openHistory">Sejarah</button>
      <button class="btn ghost" type="button" data-close="editDialog">Batal</button>
      <button class="btn primary" id="editSave">Simpan</button>
    </div>
  </form></dialog>

  <dialog id="historyDialog">
    <div class="trend-head"><h2 id="historyTitle"></h2><button class="btn ghost" type="button" data-close="historyDialog">Tutup</button></div>
    <div id="historyList"></div>
  </dialog>`;
}

function openEdit(x) {
  if (!x) return;
  editing = x;
  $('editTitle').textContent = x.name;
  $('editCurrent').value = x.current_qty;
  $('ownerFields').hidden = !session.isOwner;
  if (session.isOwner) {
    $('editName').value = x.name;
    $('editCat').value = catOf(x);
    if (![...$('editUnit').options].some(o => o.value === x.unit)) $('editUnit').add(new Option(x.unit, x.unit));
    $('editUnit').value = x.unit;
    $('editTarget').value = x.target_qty;
  }
  $('editNote').textContent = session.isOwner ? 'Setiap perubahan kuantiti direkod dalam sejarah.'
    : `Patut ada: ${qty(x.target_qty)} ${x.unit}. Hanya owner boleh ubah nama, kategori, unit atau patut ada.`;
  $('openHistory').hidden = !canSeeLogs();
  $('editDialog').showModal();
}

async function openHistory() {
  const x = editing;
  if (!x || !canSeeLogs()) return;
  $('editDialog').close();
  $('historyTitle').textContent = 'Sejarah · ' + x.name;
  $('historyList').innerHTML = '<p class="note">Memuatkan…</p>';
  $('historyDialog').showModal();
  const [{ data, error }, { data: staff }] = await Promise.all([
    sb.from('inventory_stock_logs').select('previous_qty,new_qty,note,changed_by,created_at')
      .eq('inventory_item_id', x.id).order('created_at', { ascending: false }).limit(30),
    sb.from('staff_profiles').select('user_id,role')
  ]);
  if (error) { $('historyList').innerHTML = `<p class="note">Gagal baca sejarah: ${esc(error.message)}</p>`; return; }
  if (!data.length) { $('historyList').innerHTML = '<p class="note">Tiada sejarah lagi.</p>'; return; }
  const roles = new Map((staff || []).map(s => [s.user_id, s.role]));
  const roleName = r => ({ owner: 'Owner', manager: 'Manager', staff: 'Staff' }[r] || 'Ahli outlet');
  $('historyList').innerHTML = data.map(l => {
    const who = l.changed_by === session.user.id ? 'Anda' : roleName(roles.get(l.changed_by));
    const when = new Date(l.created_at).toLocaleString('ms-MY', { dateStyle: 'medium', timeStyle: 'short' });
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
  if (!perlu.length) { toast('Semua stok cukup. Tiada apa perlu dibeli.'); return; }
  const groupBy = (list, key) => list.reduce((m, x) => m.set(key(x), [...(m.get(key(x)) || []), x]), new Map());
  const order = [...CATEGORIES, OTHER];
  const block = list => [...groupBy(list, catOf)].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([cat, xs]) => [cat.toUpperCase(), ...xs.map(x => `• ${x.name} ${qty(kurang(x))} ${x.unit}`)].join('\n')).join('\n\n');
  const byOutlet = groupBy(perlu, x => x.outlet_id);
  const text = byOutlet.size > 1 || allMode()
    ? [...byOutlet].map(([oid, list]) => `*${outletName(oid)}*\n\n${block(list)}`).join('\n\n')
    : block(perlu);
  toast(await copyText(text) ? `Senarai beli disalin (${perlu.length} barang). Tampal ke WhatsApp.` : 'Gagal salin. Cuba lagi.',
    undefined);
}

async function copyCsv() {
  await flushAll();
  if (!items.length) { toast('Tiada barang untuk disalin.'); return; }
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Outlet', 'Kategori', 'Nama', 'Unit', 'Ada', 'Patut ada', 'Kurang', 'Status'],
    ...items.map(x => [outletName(x.outlet_id), catOf(x), x.name, x.unit, x.current_qty, x.target_qty, kurang(x), LABEL[status(x)]])];
  toast(await copyText(rows.map(r => r.map(cell).join(',')).join('\n')) ? `CSV disalin (${items.length} barang). Tampal ke Google Sheets.` : 'Gagal salin. Cuba lagi.');
}

// ---------- Halaman ----------
export default {
  subtitle: 'Stok bahan mentah outlet.',
  async render(view) {
    view.innerHTML = `
      <div id="stokAlert" class="alert" role="status" hidden></div>
      <div class="section-row">
        <h2 class="section-title">Stok Bahan Mentah</h2>
        <button class="btn white" id="openAdd" type="button">+ Tambah</button>
      </div>
      <div class="tools">
        <button class="btn primary" id="copyList" type="button">Copy senarai beli</button>
        <button class="btn ghost" id="copyCsv" type="button">CSV</button>
        <button class="btn ghost" id="stokRefresh" type="button" aria-label="Muat semula">↻</button>
      </div>
      <div id="stokItems"><section class="card"><p class="greet-sub">Memuatkan…</p></section></div>
      <p class="greet-sub center">Tekan nombor untuk taip jumlah tepat. Setiap perubahan direkod.</p>
      ${dialogsHTML()}`;

    try { await load(); renderAll(); }
    catch { $('stokItems').innerHTML = '<div class="empty">Stok tak dapat dibaca. Semak internet dan tekan ↻.</div>'; }

    view.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
    $('stokItems').addEventListener('click', e => {
      const step = e.target.closest('[data-step]');
      if (step) { bump(step.dataset.id, Number(step.dataset.step)); return; }
      const open = e.target.closest('[data-open]');
      if (open) openEdit(find(open.dataset.open));
    });
    $('stokRefresh').onclick = async () => {
      try { await load(); renderAll(); } catch { toast('Stok tak dapat dibaca.', 'error'); }
    };
    $('copyList').onclick = copyList;
    $('copyCsv').onclick = copyCsv;
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
      if (!payload.name) { toast('Isi nama barang.', 'error'); return; }
      if ($('addTarget').value.trim() === '' || !ok(payload.current_qty) || !ok(payload.target_qty)) {
        toast('Sila masukkan kuantiti yang sah (0 atau lebih).', 'error'); return;
      }
      $('addSave').disabled = true;
      const { error } = await sb.from('inventory_items').insert(payload);
      $('addSave').disabled = false;
      if (error) { toast('Gagal tambah: ' + errText(error), 'error'); return; }
      $('addDialog').close();
      toast('Barang berjaya ditambah.');
      await load(); renderAll(); stockChanged();
    });

    $('editForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!editing) return;
      await flushAll();
      const payload = { current_qty: Number($('editCurrent').value) };
      const ok = v => Number.isFinite(v) && v >= 0;
      if ($('editCurrent').value.trim() === '' || !ok(payload.current_qty)) { toast('Kuantiti tidak sah.', 'error'); return; }
      if (session.isOwner) {
        payload.name = $('editName').value.trim();
        payload.unit = $('editUnit').value;
        payload.category = $('editCat').value === OTHER ? null : $('editCat').value;
        payload.target_qty = Number($('editTarget').value);
        if (!payload.name || !ok(payload.target_qty)) { toast('Nama atau patut ada tidak sah.', 'error'); return; }
      }
      $('editSave').disabled = true;
      const { data, error } = await sb.from('inventory_items').update(payload)
        .eq('id', editing.id).eq('outlet_id', editing.outlet_id).select('id');
      $('editSave').disabled = false;
      if (error) { toast('Gagal simpan: ' + errText(error), 'error'); return; }
      if (!data?.length) { toast('Tiada perubahan disimpan. Anda mungkin tiada akses.', 'error'); return; }
      $('editDialog').close();
      toast('Stok berjaya dikemas kini.');
      await load(); renderAll(); stockChanged();
    });

    // Bila tinggalkan halaman (tukar tab/outlet), simpan apa yang belum disimpan.
    const onHide = () => { if (document.hidden) flushAll(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flushAll(); };
  }
};
