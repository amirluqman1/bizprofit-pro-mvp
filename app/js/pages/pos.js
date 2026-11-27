// POS (back office): tetapan POS seoutlet + menu yang dijual di POS.
// Owner/admin sahaja (router). Database kunci: tetapan & ubah menu = can_admin_outlet; menu perlu Pro (Fasa 12).
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm } from '../format.js';
import { isPro, lockCard } from '../plan.js';
import { t } from '../i18n.js';

let outletId = null;   // outlet yang sedang diurus di halaman ini
let menus = [];

const pickOutlet = () => {
  if (session.outletId !== ALL_OUTLETS) return session.outletId;
  return outletId && session.outlets.some(o => o.id === outletId) ? outletId : session.outlets[0]?.id;
};

export default {
  async render(view) {
    outletId = pickOutlet();
    const many = session.outletId === ALL_OUTLETS && session.outlets.length > 1;
    view.innerHTML = `
      <section class="card stack">
        <div class="section-row"><h2 class="section-title">${t('Point of sale')}</h2>
          <a class="btn primary" href="../pos/" target="_blank" rel="noopener">${icon('cart')}${t('Open POS')}</a></div>
        <p class="note">${t('Open POS on the counter tablet in Chrome. Staff log in with their own account. Sales go straight into Records as "Jualan POS".')}</p>
        ${many ? `<label class="field">${t('Outlet')}<select id="posOutlet">${session.outlets.map(o => `<option value="${esc(o.id)}" ${o.id === outletId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>` : ''}
      </section>
      <section class="card stack" id="posSet"><div class="skel"></div></section>
      <div class="section-row"><h2 class="section-title">${t('POS menu')}</h2>${isPro() ? `<button class="btn white" id="pmAdd" type="button">${t('+ Add menu')}</button>` : ''}</div>
      <div id="pmList" class="list"><div class="skel"></div></div>
      ${dialogHTML()}`;
    if ($('posOutlet')) $('posOutlet').onchange = e => { outletId = e.target.value; this.render(view); };
    bindDialog(() => loadMenus());
    if ($('pmAdd')) $('pmAdd').onclick = () => openMenu(null);
    await Promise.all([loadSettings(), loadMenus()]);
  }
};

// ---------- Tetapan ----------
async function loadSettings() {
  const box = $('posSet');
  const { data, error } = await sb.from('pos_settings').select('*').eq('outlet_id', outletId).maybeSingle();
  if (error) { box.innerHTML = `<div class="empty">${t('Could not load POS settings. Has the POS database update (Fasa 19) been applied?')}</div>`; return; }
  const s = data || {};
  const chk = (id, on, label, hint) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> <span>${label}<br><small>${hint}</small></span></label>`;
  box.innerHTML = `
    <h2 class="section-title">${t('POS settings')} · ${esc(outletName(outletId))}</h2>
    ${chk('psNo', s.order_numbers, t('Order numbers'), t('#1, #2… restarting every day, printed large on the receipt.'))}
    ${chk('psTable', s.table_numbers, t('Table numbers'), t('Ask for a table number for dine-in orders.'))}
    ${chk('psKitchen', s.kitchen_slip, t('Kitchen slip'), t('Print a second slip (items and notes, no prices) for the kitchen.'))}
    <label class="field">${t('Receipt header')} <small>${t('optional, e.g. address or phone')}</small><textarea id="psHead" rows="2" maxlength="300">${esc(s.receipt_header || '')}</textarea></label>
    <label class="field">${t('Receipt footer')} <small>${t('optional')}</small><textarea id="psFoot" rows="2" maxlength="300" placeholder="${t('e.g. Thank you, come again!')}">${esc(s.receipt_footer || '')}</textarea></label>
    <button class="btn primary" id="psSave" type="button">${t('Save settings')}</button>`;
  $('psSave').onclick = async () => {
    const row = {
      outlet_id: outletId, order_numbers: $('psNo').checked, table_numbers: $('psTable').checked, kitchen_slip: $('psKitchen').checked,
      receipt_header: $('psHead').value.trim() || null, receipt_footer: $('psFoot').value.trim() || null, updated_at: new Date().toISOString()
    };
    $('psSave').disabled = true;
    const { error: e } = await sb.from('pos_settings').upsert(row, { onConflict: 'outlet_id' });
    $('psSave').disabled = false;
    if (e) { toast(t('Save failed: ') + e.message, 'error'); return; }
    toast(t('POS settings saved.'));
  };
}

// ---------- Menu ----------
async function loadMenus() {
  const box = $('pmList');
  if (!isPro()) { box.innerHTML = lockCard('POS menu', 'Set up the menu sold at the POS counter, with categories and sold-out status.'); return; }
  const { data, error } = await sb.from('menu_items').select('id,outlet_id,name,selling_price,category,available,sort_order')
    .eq('outlet_id', outletId).order('category', { nullsFirst: false }).order('sort_order').order('name');
  if (error) { box.innerHTML = `<div class="empty">${t('Could not load the menu.')}</div>`; return; }
  menus = data || [];
  if (!menus.length) { box.innerHTML = `<div class="empty">${t('No menu yet.')}<br>${t('Tap <b>+ Add menu</b> to add the first item.')}</div>`; return; }
  let lastCat = null;
  box.innerHTML = menus.map(m => {
    const cat = m.category || t('Other');
    const head = cat !== lastCat ? `<h3 class="pm-cat">${esc(cat)}</h3>` : '';
    lastCat = cat;
    const sold = Number(m.selling_price) > 0;
    return `${head}<div class="row-btn pm-row ${m.available ? '' : 'inactive'}">
      <button type="button" class="pm-main" data-edit="${esc(m.id)}"><span>${esc(m.name)}<small>${sold ? rm(m.selling_price) : t('Price RM 0: not shown at POS')}</small></span></button>
      <button type="button" class="pill ${m.available ? 'ok' : ''}" data-avail="${esc(m.id)}" aria-pressed="${m.available}">${m.available ? t('Available') : t('Sold out')}</button>
    </div>`;
  }).join('');
}

function dialogHTML() {
  return `<dialog id="pmDialog"><form id="pmForm" class="stack" novalidate>
    <h2 id="pmTitle">${t('Add menu')}</h2>
    <label class="field">${t('Name')}<input id="pmName" maxlength="80" autocomplete="off" placeholder="${t('e.g. Nasi Lemak Ayam')}"></label>
    <div class="two">
      <label class="field">${t('Price (RM)')}<input id="pmPrice" type="number" inputmode="decimal" min="0" step="0.01"></label>
      <label class="field">${t('Category')}<input id="pmCat" maxlength="40" list="pmCats" placeholder="${t('e.g. Drinks')}"></label>
    </div>
    <datalist id="pmCats"></datalist>
    <label class="field">${t('Order in list')} <small>${t('smaller number shows first')}</small><input id="pmSort" type="number" inputmode="numeric" step="1" value="0"></label>
    <label class="check"><input type="checkbox" id="pmAvail" checked> ${t('Available today')}</label>
    <p class="note">${t('Recipes and cost per plate are set in Food Cost.')}</p>
    <div class="dialog-actions"><button class="btn ghost" type="button" id="pmCancel">${t('Cancel')}</button><button class="btn primary" id="pmSave">${t('Save')}</button></div>
  </form></dialog>`;
}

let editing = null;
function openMenu(m) {
  editing = m;
  $('pmTitle').textContent = m ? t('Edit menu') : t('Add menu');
  $('pmName').value = m?.name || '';
  $('pmPrice').value = m ? Number(m.selling_price).toFixed(2) : '';
  $('pmCat').value = m?.category || '';
  $('pmSort').value = m?.sort_order ?? 0;
  $('pmAvail').checked = m ? m.available : true;
  $('pmCats').innerHTML = [...new Set(menus.map(x => x.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join('');
  $('pmDialog').showModal();
  $('pmName').focus();
}

function bindDialog(refresh) {
  $('pmCancel').onclick = () => $('pmDialog').close();
  $('pmForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('pmName').value.trim(), price = Number($('pmPrice').value);
    if (!name) { toast(t('Enter the menu name.'), 'error'); return; }
    if ($('pmPrice').value.trim() === '' || !(price >= 0)) { toast(t('Enter a valid price.'), 'error'); return; }
    const row = { name, selling_price: Math.round(price * 100) / 100, category: $('pmCat').value.trim() || null,
      sort_order: Math.trunc(Number($('pmSort').value) || 0), available: $('pmAvail').checked };
    $('pmSave').disabled = true;
    const res = editing
      ? await sb.from('menu_items').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editing.id).select('id')
      : await sb.from('menu_items').insert({ ...row, outlet_id: outletId }).select('id');
    $('pmSave').disabled = false;
    if (res.error || !res.data?.length) { toast(t('Save failed: ') + (res.error?.message || t('no access.')), 'error'); return; }
    $('pmDialog').close();
    toast(editing ? t('Menu updated.') : t('Menu added.'));
    refresh();
  });
  $('pmList').addEventListener('click', async e => {
    const ed = e.target.closest('[data-edit]');
    if (ed) { openMenu(menus.find(m => m.id === ed.dataset.edit)); return; }
    const av = e.target.closest('[data-avail]');
    if (!av) return;
    const m = menus.find(x => x.id === av.dataset.avail);
    av.disabled = true;
    const { error } = await sb.rpc('pos_set_available', { p_menu: m.id, p_available: !m.available });
    av.disabled = false;
    if (error) { toast(t('Save failed: ') + error.message, 'error'); return; }
    toast(!m.available ? t('"{x}" is available.', { x: m.name }) : t('"{x}" marked sold out.', { x: m.name }));
    refresh();
  });
}
