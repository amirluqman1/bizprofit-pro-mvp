// Mod "Edit menu" dalam POS (owner/admin): tambah / ubah / padam menu, kategori (nama + warna),
// dan seret untuk susun menu & kategori. Semua sekatan dikuatkuasa di database (Fasa 12 + Fasa 22):
// manager & staff tidak boleh ubah, pakej Free baca sahaja. UI ini hanya menyusun paparan.
import { $, esc, toast } from '../../app/js/ui.js';
import { sb, session } from '../../app/js/session.js';
import { t } from '../../app/js/i18n.js';

export const OTHER = '__other';                       // kunci kategori untuk menu tanpa kategori
export const PALETTE = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#94a3b8'];
export const canEdit = () => session.isAdminUp;       // owner / admin (DB semak outlet + pakej)

let ctx = null;   // { st, reload, render }

// Kategori ikut susunan: dari menu_categories, kemudian kategori menu yang belum ada dalam table
// (cth. sebelum Fasa 22 dijalankan), dan "Lain-lain" (tanpa kategori) paling akhir.
export function categoryList(st) {
  const known = [...st.categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const names = new Set(known.map(c => c.name));
  const extra = [...new Set(st.menus.map(m => m.category).filter(c => c && !names.has(c)))].sort()
    .map(name => ({ name, color: null, sort_order: 1e6 }));
  const list = [...known, ...extra].map(c => ({ key: c.name, name: c.name, color: c.color }));
  if (st.menus.some(m => !m.category)) list.push({ key: OTHER, name: t('Other'), color: null });
  return list;
}
export const catKey = m => m.category || OTHER;
export function sortedMenus(st) {
  const order = new Map(categoryList(st).map((c, i) => [c.key, i]));
  return [...st.menus].sort((a, b) => (order.get(catKey(a)) ?? 1e6) - (order.get(catKey(b)) ?? 1e6)
    || a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
export const colorOf = (st, m) => st.categories.find(c => c.name === m.category)?.color || null;

const errText = e => {
  if (e?.code === '23505') return t('A menu with this name already exists.');
  if (e?.code === '23503') return t('This menu is used as a side dish in another menu\'s recipe (Food Cost). Remove it from that recipe first.');
  return e?.message || t('Unknown error.');
};

// ================= Seret untuk susun =================
// Seret elemen `item` dalam `container` (melalui `handle` jika diberi). Kotak lain beralih.
// onDrop(senarai data-id ikut susunan baru). Klik selepas seret diabaikan.
export function sortable(container, { item, handle, onDrop }) {
  container.addEventListener('click', ev => {
    if (Date.now() - (container.dragEndedAt || 0) < 400) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  container.addEventListener('pointerdown', e => {
    if (!container.classList.contains('editing')) return;
    const grip = e.target.closest(handle || item);
    const el = grip?.closest(item);
    if (!el || !container.contains(el) || el.dataset.id == null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    let ghost = null, timer = null, last = null;
    const scroll = () => {   // tatal automatik bila hampir tepi
      if (!last) return;
      const r = container.getBoundingClientRect();
      if (last.y < r.top + 40) container.scrollTop -= 14; else if (last.y > r.bottom - 40) container.scrollTop += 14;
      if (last.x < r.left + 30) container.scrollLeft -= 14; else if (last.x > r.right - 30) container.scrollLeft += 14;
    };
    const move = ev => {
      last = { x: ev.clientX, y: ev.clientY };
      if (!ghost) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        ghost = el.cloneNode(true);
        ghost.classList.add('drag-ghost');
        Object.assign(ghost.style, { width: rect.width + 'px', height: rect.height + 'px' });
        document.body.append(ghost);
        el.classList.add('drag-ph');
        timer = setInterval(scroll, 30);
      }
      ev.preventDefault();
      ghost.style.transform = `translate(${ev.clientX - rect.width / 2}px, ${ev.clientY - rect.height / 2}px)`;
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest(item);
      if (over && over !== el && container.contains(over) && over.dataset.id != null) {
        const all = [...container.querySelectorAll(item)];
        if (all.indexOf(el) < all.indexOf(over)) over.after(el); else over.before(el);
      }
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      clearInterval(timer);
      if (!ghost) return;
      ghost.remove();
      el.classList.remove('drag-ph');
      container.dragEndedAt = Date.now();   // klik yang terhasil selepas seret diabaikan (lihat bawah)
      onDrop([...container.querySelectorAll(item)].filter(x => x.dataset.id != null).map(x => x.dataset.id));
    };
    addEventListener('pointermove', move, { passive: false });
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// ================= Simpan susunan =================
async function saveMenuOrder(ids) {
  ids.forEach((id, i) => { const m = ctx.st.menus.find(x => x.id === id); if (m) m.sort_order = i + 1; });
  const { error } = await sb.rpc('reorder_menu', { p_outlet: ctx.st.outletId, p_ids: ids });
  if (error) { toast(t('Could not save the order: ') + errText(error), 'error'); await ctx.reload(); }
  ctx.render();
}
async function saveCategoryOrder(keys) {
  const names = keys.filter(k => k && k !== OTHER);
  names.forEach((n, i) => { const c = ctx.st.categories.find(x => x.name === n); if (c) c.sort_order = i + 1; });
  const { error } = await sb.rpc('reorder_menu_categories', { p_outlet: ctx.st.outletId, p_names: names });
  if (error) { toast(t('Could not save the order: ') + errText(error), 'error'); await ctx.reload(); }
  ctx.render();
}

// ================= Dialog menu =================
let editingMenu = null;
export function openMenuDialog(menu) {
  const st = ctx.st;
  editingMenu = menu || null;
  $('meTitle').textContent = menu ? t('Edit menu') : t('Add menu');
  $('meName').value = menu?.name || '';
  $('mePrice').value = menu ? Number(menu.selling_price).toFixed(2) : '';
  const cats = categoryList(st).filter(c => c.key !== OTHER);
  const current = menu ? (menu.category || '') : (st.cat && st.cat !== OTHER ? st.cat : '');
  $('meCat').innerHTML = [`<option value="">${esc(t('No category'))}</option>`,
    ...cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`),
    `<option value="__new">${esc(t('+ New category…'))}</option>`].join('');
  $('meCat').value = current;
  $('meNewCat').value = ''; $('meNewCat').hidden = true;
  $('meAvail').checked = menu ? menu.available : true;
  $('meDelete').hidden = !menu;
  $('menuEditDialog').showModal();
  if (!menu) $('meName').focus();
}

async function saveMenu(e) {
  e.preventDefault();
  const st = ctx.st;
  const name = $('meName').value.trim(), price = Number($('mePrice').value);
  if (!name) { toast(t('Enter the menu name.'), 'error'); return; }
  if (!(price > 0)) { toast(t('Enter a price above RM 0 (menus at RM 0 are not shown at the POS).'), 'error'); return; }
  let category = $('meCat').value;
  if (category === '__new') {
    category = $('meNewCat').value.trim();
    if (!category) { toast(t('Enter the new category name.'), 'error'); return; }
  }
  category = category || null;
  const row = { name, selling_price: Math.round(price * 100) / 100, category, available: $('meAvail').checked };
  // Tukar kategori: letak di hujung kategori baru.
  if (editingMenu && (editingMenu.category || null) !== category) {
    row.sort_order = Math.max(0, ...st.menus.filter(m => (m.category || null) === category).map(m => m.sort_order)) + 1;
  }
  $('meSave').disabled = true;
  const res = editingMenu
    ? await sb.from('menu_items').update(row).eq('id', editingMenu.id).select('id')
    : await sb.from('menu_items').insert({ ...row, outlet_id: st.outletId }).select('id');
  $('meSave').disabled = false;
  if (res.error || !res.data?.length) { toast(t('Save failed: ') + (res.error ? errText(res.error) : t('no access.')), 'error'); return; }
  $('menuEditDialog').close();
  toast(editingMenu ? t('Menu updated.') : t('Menu added.'));
  if (category && !editingMenu) st.cat = category;
  await ctx.reload(); ctx.render();
}

async function deleteMenu() {
  const m = editingMenu;
  if (!m || !confirm(t('Delete "{x}"? Past orders keep their name and price. Its recipe in Food Cost is also deleted.', { x: m.name }))) return;
  const { error, data } = await sb.from('menu_items').delete().eq('id', m.id).select('id');
  if (error || !data?.length) { toast(t('Could not delete: ') + (error ? errText(error) : t('no access.')), 'error'); return; }
  $('menuEditDialog').close();
  toast(t('"{x}" deleted.', { x: m.name }));
  await ctx.reload(); ctx.render();
}

// ================= Dialog kategori =================
let editingCat = null, pickedColor = null;
export function openCategoryDialog(name) {
  const st = ctx.st;
  editingCat = name ? st.categories.find(c => c.name === name) || { name, color: null, missing: true } : null;
  pickedColor = editingCat?.color || null;
  $('ceTitle').textContent = editingCat ? t('Edit category') : t('Add category');
  $('ceName').value = editingCat?.name || '';
  paintSwatches();
  const used = editingCat ? st.menus.filter(m => m.category === editingCat.name).length : 0;
  $('ceDelete').hidden = !editingCat;
  $('ceDelete').disabled = used > 0;
  $('ceInfo').textContent = editingCat ? (used ? t('{n} menus in this category. Move or delete them before deleting the category.', { n: used }) : t('This category is empty.')) : '';
  $('catEditDialog').showModal();
  if (!editingCat) $('ceName').focus();
}
function paintSwatches() {
  $('ceColors').innerHTML = [null, ...PALETTE].map(c => `<button type="button" class="sw-btn ${c === pickedColor ? 'on' : ''}" data-color="${c || ''}"
    style="${c ? `--c:${c}` : ''}" aria-label="${c || esc(t('No colour'))}" aria-pressed="${c === pickedColor}">${c ? '' : '∅'}</button>`).join('');
}

async function saveCategory(e) {
  e.preventDefault();
  const st = ctx.st;
  const name = $('ceName').value.trim();
  if (!name || name.length > 40) { toast(t('Category name must be 1 to 40 characters.'), 'error'); return; }
  $('ceSave').disabled = true;
  let error = null;
  if (!editingCat) {
    const max = Math.max(0, ...st.categories.map(c => c.sort_order));
    ({ error } = await sb.from('menu_categories').insert({ outlet_id: st.outletId, name, color: pickedColor, sort_order: max + 1 }));
    if (!error) st.cat = name;
  } else {
    if (name !== editingCat.name) {
      ({ error } = await sb.rpc('rename_menu_category', { p_outlet: st.outletId, p_old: editingCat.name, p_new: name }));
      if (!error && st.cat === editingCat.name) st.cat = name;
    }
    if (!error && pickedColor !== (editingCat.color || null)) {
      const res = await sb.from('menu_categories').update({ color: pickedColor }).eq('outlet_id', st.outletId).eq('name', name).select('name');
      error = res.error || (res.data?.length ? null : { message: t('no access.') });
    }
  }
  $('ceSave').disabled = false;
  if (error) { toast(t('Save failed: ') + errText(error), 'error'); return; }
  $('catEditDialog').close();
  toast(t('Category saved.'));
  await ctx.reload(); ctx.render();
}

async function deleteCategory() {
  const c = editingCat;
  if (!c || !confirm(t('Delete the category "{x}"?', { x: c.name }))) return;
  const { error, data } = await sb.from('menu_categories').delete().eq('outlet_id', ctx.st.outletId).eq('name', c.name).select('name');
  if (error || !data?.length) { toast(t('Could not delete: ') + (error ? errText(error) : t('no access.')), 'error'); return; }
  $('catEditDialog').close();
  if (ctx.st.cat === c.name) ctx.st.cat = null;
  toast(t('Category deleted.'));
  await ctx.reload(); ctx.render();
}

// ================= Pasang =================
export function setupMenuEdit(c) {
  ctx = c;
  document.body.insertAdjacentHTML('beforeend', `
  <dialog id="menuEditDialog"><form id="meForm" class="stack" novalidate>
    <h2 id="meTitle"></h2>
    <label class="field"><span>${t('Name')}</span><input id="meName" maxlength="80" autocomplete="off" placeholder="${esc(t('e.g. Nasi Lemak Ayam'))}"></label>
    <label class="field"><span>${t('Price (RM)')}</span><input id="mePrice" type="number" inputmode="decimal" min="0" step="0.01"></label>
    <label class="field"><span>${t('Category')}</span><select id="meCat"></select></label>
    <input id="meNewCat" maxlength="40" placeholder="${esc(t('New category name'))}" hidden>
    <label class="check"><input type="checkbox" id="meAvail"> <span>${t('Available today')}</span></label>
    <p class="muted small">${t('Recipes and cost per plate are set in BizProfit → Food Cost.')}</p>
    <div class="dialog-actions">
      <button type="button" class="btn ghost" data-close="menuEditDialog">${t('Cancel')}</button>
      <button class="btn primary" id="meSave">${t('Save')}</button>
    </div>
    <button type="button" class="btn link danger" id="meDelete">${t('Delete menu')}</button>
  </form></dialog>
  <dialog id="catEditDialog"><form id="ceForm" class="stack" novalidate>
    <h2 id="ceTitle"></h2>
    <label class="field"><span>${t('Category name')}</span><input id="ceName" maxlength="40" autocomplete="off" placeholder="${esc(t('e.g. Drinks'))}"></label>
    <div class="field"><span>${t('Colour')}</span><div id="ceColors" class="swatches"></div></div>
    <p class="muted small" id="ceInfo"></p>
    <div class="dialog-actions">
      <button type="button" class="btn ghost" data-close="catEditDialog">${t('Cancel')}</button>
      <button class="btn primary" id="ceSave">${t('Save')}</button>
    </div>
    <button type="button" class="btn link danger" id="ceDelete">${t('Delete category')}</button>
  </form></dialog>`);
  document.querySelectorAll('#menuEditDialog [data-close], #catEditDialog [data-close]').forEach(b => b.onclick = () => $(b.dataset.close).close());
  $('meCat').onchange = () => { $('meNewCat').hidden = $('meCat').value !== '__new'; if (!$('meNewCat').hidden) $('meNewCat').focus(); };
  $('meForm').addEventListener('submit', saveMenu);
  $('meDelete').onclick = deleteMenu;
  $('ceForm').addEventListener('submit', saveCategory);
  $('ceDelete').onclick = deleteCategory;
  $('ceColors').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) { pickedColor = b.dataset.color || null; paintSwatches(); } });
  sortable($('menuGrid'), { item: '.mi', handle: '.grip', onDrop: saveMenuOrder });
  sortable($('cats'), { item: '.cat', onDrop: saveCategoryOrder });
}
