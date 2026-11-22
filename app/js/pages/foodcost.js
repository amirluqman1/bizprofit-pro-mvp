// Food Cost (owner & admin sahaja; dikunci di database).
//  1. Food cost % ikut tempoh = belian bahan (kategori Ingredients) ÷ jualan.
//  2. Kos per pinggan setiap menu = Σ (kuantiti bahan × harga seunit) ÷ bilangan pinggan.
// Harga seunit diisi di Stock (butang barang → Price per unit).
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ALL_OUTLETS, outletName } from '../session.js';
import { rm, todayKL, addDays, endOfMonth, dateRange } from '../format.js';
import { isPro, lockCard } from '../plan.js';

const TARGET = 30;                       // % food cost sasaran untuk harga cadangan
const PERIODS = { week: 'This week', month: 'This month', last: 'Last month' };
const state = { period: 'month' };
let menus = [], lines = [], stock = [], prices = new Map();
let editing = null;                      // { id, outlet, rows: [{ item | menu, qty }] }
let version = 0;

function periodRange(p) {
  const t = todayKL();
  if (p === 'week') { const dow = new Date(t + 'T00:00:00Z').getUTCDay(); const s = addDays(t, -((dow + 6) % 7)); return [s, addDays(s, 6)]; }
  if (p === 'last') { const s = addDays(t.slice(0, 7) + '-01', -1).slice(0, 7) + '-01'; return [s, endOfMonth(s)]; }
  const s = t.slice(0, 7) + '-01'; return [s, endOfMonth(s)];
}

// Hijau ≤ 35%, kuning ≤ 40%, merah > 40% (panduan biasa F&B).
const level = pct => (pct == null ? '' : pct <= 35 ? 'ok' : pct <= 40 ? 'rendah' : 'habis');
const pctText = pct => (pct == null ? '—' : pct.toFixed(1) + '%');
const item = id => stock.find(s => s.id === id);

const menuOf = id => menus.find(m => m.id === id);
// Baris resipi: { item: <stok> } atau { menu: <lauk/menu lain> }, qty = unit stok / bilangan porsi.
const rowsOf = menuId => lines.filter(l => l.menu_item_id === menuId)
  .map(l => (l.sub_menu_id ? { menu: l.sub_menu_id, qty: Number(l.qty) } : { item: l.inventory_item_id, qty: Number(l.qty) }));

// Kos satu menu daripada baris resipi (termasuk lauk di dalamnya). missing = bahan tanpa harga.
function costOf(rows, portions, seen = new Set()) {
  let total = 0, missing = 0;
  rows.forEach(r => {
    if (r.menu) {
      const sub = menuOf(r.menu);
      if (!sub || seen.has(sub.id)) return;           // elak pusingan
      const c = costOf(rowsOf(sub.id), sub.portions, new Set([...seen, sub.id]));
      total += Number(r.qty) * c.perPlate; missing += c.missing;
    } else if (prices.has(r.item)) total += Number(r.qty) * prices.get(r.item);
    else missing++;
  });
  const perPlate = total / (Number(portions) || 1);
  return { total, perPlate, missing };
}
const plateCost = m => costOf(rowsOf(m.id), m.portions, new Set([m.id])).perPlate;
const pctOf = (cost, price) => (Number(price) > 0 ? cost / Number(price) * 100 : null);

async function loadAll() {
  const outletFilter = q => (session.outletId === ALL_OUTLETS ? q : q.eq('outlet_id', session.outletId));
  const [m, l, s, p] = await Promise.all([
    outletFilter(sb.from('menu_items').select('id,outlet_id,name,selling_price,portions')).order('name'),
    outletFilter(sb.from('menu_ingredients').select('menu_item_id,inventory_item_id,sub_menu_id,qty')),
    outletFilter(sb.from('inventory_items').select('id,outlet_id,name,unit')).order('name'),
    sb.from('ingredient_costs').select('inventory_item_id,unit_price')
  ]);
  const err = m.error || l.error || s.error || p.error;
  if (err) throw err;
  menus = m.data; lines = l.data; stock = s.data;
  prices = new Map(p.data.map(x => [x.inventory_item_id, Number(x.unit_price)]));
}

async function loadPeriod(from, to) {
  const f = q => (session.outletId === ALL_OUTLETS ? q : q.eq('outlet_id', session.outletId));
  const [s, c] = await Promise.all([
    f(sb.from('daily_summary').select('sales').gte('transaction_date', from).lte('transaction_date', to)),
    f(sb.from('daily_food_cost').select('ingredients').gte('transaction_date', from).lte('transaction_date', to))
  ]);
  if (s.error || c.error) throw s.error || c.error;
  const sum = (rows, k) => rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0) / 100;
  return { sales: sum(s.data, 'sales'), ingredients: sum(c.data, 'ingredients') };
}

// ---------------- Paparan ----------------
function periodHTML(d, from, to) {
  const pct = d.sales > 0 ? d.ingredients / d.sales * 100 : null;
  const lv = level(pct);
  return `
    <p class="overline">${icon('chart')}Food cost %</p>
    <div class="fc-big"><b class="fc-pct ${lv}" data-pct>${pctText(pct)}</b>
      ${pct == null ? '' : `<span class="pill ${lv}">${lv === 'ok' ? 'Healthy' : lv === 'rendah' ? 'Watch' : 'Too high'}</span>`}</div>
    <div class="fc-bar" aria-hidden="true"><i class="${lv}" style="width:${Math.min(100, pct || 0)}%"></i><s style="left:35%"></s></div>
    <p class="greet-sub">${esc(dateRange(from, to))} · ${esc(outletName())}</p>
    <div class="kv-list">
      <div class="kv"><span>Sales</span><b>${rm(d.sales)}</b></div>
      <div class="kv"><span>Ingredients bought</span><b class="neg">${rm(d.ingredients)}</b></div>
    </div>
    <p class="note-line small">${icon('lock')}Ingredients ÷ Sales, from Records (category "Ingredients"). Healthy F&amp;B is usually 25–35%.</p>
    ${pct == null ? '<p class="note">No sales in this period yet.</p>' : ''}`;
}

function menuCardHTML(m) {
  const rows = rowsOf(m.id);
  const c = costOf(rows, m.portions, new Set([m.id]));
  const usedIn = new Set(lines.filter(l => l.sub_menu_id === m.id).map(l => l.menu_item_id)).size;
  const pct = pctOf(c.perPlate, m.selling_price);
  const lv = level(pct);
  const lauk = !(Number(m.selling_price) > 0);        // harga jual 0 = lauk/komponen, tak dijual sendiri
  const info = lauk ? [`Cost ${rm(c.perPlate)} per portion`]
    : [`Sell ${rm(m.selling_price)}`, `Cost ${rm(c.perPlate)}`, `Profit ${rm(Number(m.selling_price) - c.perPlate)}`];
  return `<button type="button" class="row-btn fc-menu" data-menu="${esc(m.id)}">
    <span>${esc(m.name)}
      <small>${esc([session.outletId === ALL_OUTLETS ? outletName(m.outlet_id) : '', ...info].filter(Boolean).join(' · '))}</small>
      ${usedIn ? `<small>Used in ${usedIn} menu${usedIn > 1 ? 's' : ''}</small>` : ''}
      ${!rows.length ? '<small class="warn">No ingredients yet</small>' : c.missing ? `<small class="warn">⚠ ${c.missing} ingredient${c.missing > 1 ? 's have' : ' has'} no price</small>` : ''}
    </span>
    <span class="pill ${lauk ? '' : lv}">${lauk ? 'Lauk' : pctText(pct)}</span>
  </button>`;
}

function renderMenus() {
  $('fcMenus').innerHTML = menus.length ? menus.map(menuCardHTML).join('')
    : `<div class="empty">No menus yet.<br>Tap <b>+ Add menu</b>. Tip: add lauk first (e.g. Ayam Goreng, Sambal), then reuse them in set menus like Nasi Lemak Ayam.</div>`;
  const noPrice = stock.filter(s => !prices.has(s.id)).length;
  $('fcPriceNote').hidden = !noPrice;
  $('fcPriceNote').innerHTML = `${icon('box')}${noPrice} stock item${noPrice > 1 ? 's have' : ' has'} no price yet. Add prices in <a href="#/stok">Stock</a> (tap an item) so costs are accurate.`;
}

// ---------------- Dialog menu ----------------
function dialogHTML() {
  const outletSel = session.outlets.length > 1
    ? `<label class="field" id="fmOutletWrap">Outlet<select id="fmOutlet">${session.outlets
        .filter(o => session.isOwner || o.id === session.profile.outlet_id)
        .map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>` : '';
  return `<dialog id="fmDialog"><form id="fmForm" class="stack" novalidate>
    <h2 id="fmTitle">Add menu</h2>
    ${outletSel}
    <label class="field">Menu name<input id="fmName" maxlength="120" placeholder="e.g. Nasi Lemak Ayam"></label>
    <div class="two">
      <label class="field">Selling price (RM)<input id="fmPrice" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00"></label>
      <label class="field">Recipe makes (plates)<input id="fmPortions" type="number" inputmode="decimal" min="0.001" step="any" value="1"></label>
    </div>
    <div class="fc-lines-head"><b>Ingredients</b><small>Stock items: quantity in the item's unit (e.g. 0.15 kg = 150 g). Lauk: number of portions.</small></div>
    <div id="fmLines" class="fc-lines"></div>
    <div class="two">
      <button class="btn ghost" type="button" id="fmAddLine">+ Ingredient</button>
      <button class="btn ghost" type="button" id="fmAddLauk">+ Lauk / menu</button>
    </div>
    <p class="note small">Set selling price to 0 for a lauk that is not sold on its own (e.g. Sambal).</p>
    <div class="kv-list fc-sum" id="fmSum"></div>
    <div class="dialog-actions">
      <button class="btn danger" type="button" id="fmDelete">Delete</button>
      <button class="btn ghost" type="button" id="fmCancel">Cancel</button>
      <button class="btn primary" id="fmSave">Save</button>
    </div>
  </form></dialog>`;
}

const outletStock = () => stock.filter(s => s.outlet_id === editing.outlet);
// Lauk yang boleh dipilih: menu outlet sama, bukan menu yang sedang diubah.
const outletLauk = () => menus.filter(m => m.outlet_id === editing.outlet && m.id !== editing.id);
const isLauk = r => 'menu' in r;
const lineCost = r => {
  if (!(Number(r.qty) > 0)) return null;
  if (isLauk(r)) { const m = menuOf(r.menu); return m ? Number(r.qty) * plateCost(m) : null; }
  return prices.has(r.item) ? Number(r.qty) * prices.get(r.item) : null;
};

function lineHTML(r, i) {
  const lauk = isLauk(r);
  const opts = lauk
    ? outletLauk().map(m => `<option value="${esc(m.id)}" ${m.id === r.menu ? 'selected' : ''}>🍗 ${esc(m.name)} (${esc(rm(plateCost(m)))})</option>`).join('')
    : outletStock().map(s => `<option value="${esc(s.id)}" ${s.id === r.item ? 'selected' : ''}>${esc(s.name)}${prices.has(s.id) ? '' : ' (no price)'}</option>`).join('');
  const unit = lauk ? 'portion' : (item(r.item)?.unit || '');
  const c = lineCost(r);
  const cost = c == null ? '—' : rm(c);
  return `<div class="fc-line${lauk ? ' lauk' : ''}" data-i="${i}">
    <select data-f="${lauk ? 'menu' : 'item'}" aria-label="${lauk ? 'Lauk' : 'Ingredient'}"><option value="">${lauk ? 'Choose lauk…' : 'Choose…'}</option>${opts}</select>
    <label class="fc-qty"><input data-f="qty" type="number" inputmode="decimal" min="0" step="any" value="${r.qty ?? ''}" placeholder="0" aria-label="Quantity"><span>${esc(unit)}</span></label>
    <span class="fc-cost" data-cost>${cost}</span>
    <button type="button" class="fc-del" data-del aria-label="Remove ingredient">✕</button>
  </div>`;
}

function drawLines() {
  $('fmLines').innerHTML = editing.rows.length ? editing.rows.map(lineHTML).join('')
    : `<p class="note">${outletStock().length ? 'No ingredients yet. Tap + Ingredient or + Lauk / menu.' : 'This outlet has no stock items yet. Add them in Stock first.'}</p>`;
  drawSum();
}

function drawSum() {
  const valid = editing.rows.filter(r => (r.item || r.menu) && Number(r.qty) > 0);
  const c = costOf(valid, $('fmPortions').value, new Set(editing.id ? [editing.id] : []));
  const price = Number($('fmPrice').value);
  const pct = pctOf(c.perPlate, price);
  const suggest = c.perPlate > 0 ? c.perPlate / (TARGET / 100) : 0;
  $('fmSum').innerHTML = `
    <div class="kv"><span>Recipe cost</span><b>${rm(c.total)}</b></div>
    <div class="kv"><span>Cost per plate</span><b>${rm(c.perPlate)}</b></div>
    <div class="kv"><span>Food cost</span><b class="fc-pct ${level(pct)}">${pctText(pct)}</b></div>
    <div class="kv"><span>Profit per plate</span><b class="${price - c.perPlate < 0 ? 'neg' : 'pos'}">${rm(price - c.perPlate)}</b></div>
    <div class="kv"><span>Suggested price (${TARGET}% food cost)</span><b>${suggest ? rm(Math.ceil(suggest * 10) / 10) : '—'}</b></div>
    ${c.missing ? `<p class="note warn">⚠ ${c.missing} ingredient${c.missing > 1 ? 's have' : ' has'} no price. Add it in Stock for an accurate cost.</p>` : ''}`;
}

function openMenu(m) {
  const defaultOutlet = session.outletId !== ALL_OUTLETS ? session.outletId
    : (session.isOwner ? session.outlets[0]?.id : session.profile.outlet_id);
  editing = {
    id: m?.id || null,
    outlet: m?.outlet_id || defaultOutlet,
    rows: m ? rowsOf(m.id) : []
  };
  $('fmTitle').textContent = m ? 'Edit menu' : 'Add menu';
  $('fmName').value = m?.name || '';
  $('fmPrice').value = m ? Number(m.selling_price).toFixed(2) : '';
  $('fmPortions').value = m ? Number(m.portions) : 1;
  if ($('fmOutlet')) {
    $('fmOutlet').value = editing.outlet;
    $('fmOutlet').disabled = !!m;                       // menu tak boleh pindah outlet
    $('fmOutletWrap').hidden = !m && session.outletId !== ALL_OUTLETS;   // baru: guna outlet dipilih
  }
  $('fmDelete').hidden = !m;
  drawLines();
  $('fmDialog').showModal();
}

function bindDialog(refresh) {
  $('fmCancel').onclick = () => $('fmDialog').close();
  $('fmAddLine').onclick = () => {
    if (!outletStock().length) { toast('This outlet has no stock items yet. Add them in Stock first.', 'error'); return; }
    editing.rows.push({ item: '', qty: '' });
    drawLines();
    $('fmLines').lastElementChild?.querySelector('select')?.focus();
  };
  $('fmAddLauk').onclick = () => {
    if (!outletLauk().length) { toast('No other menus in this outlet yet. Add the lauk (e.g. Ayam Goreng) as a menu first.', 'error'); return; }
    editing.rows.push({ menu: '', qty: 1 });
    drawLines();
    $('fmLines').lastElementChild?.querySelector('select')?.focus();
  };
  if ($('fmOutlet')) $('fmOutlet').onchange = e => { editing.outlet = e.target.value; editing.rows = []; drawLines(); };
  $('fmPrice').oninput = drawSum;
  $('fmPortions').oninput = drawSum;
  $('fmLines').addEventListener('click', e => {
    if (!e.target.closest('[data-del]')) return;
    editing.rows.splice(Number(e.target.closest('[data-i]').dataset.i), 1);
    drawLines();
  });
  $('fmLines').addEventListener('change', e => {
    const f = e.target.dataset.f;
    if (f !== 'item' && f !== 'menu') return;
    const i = Number(e.target.closest('[data-i]').dataset.i);
    if (e.target.value && editing.rows.some((r, j) => j !== i && r[f] === e.target.value)) {
      toast('This is already in the recipe.', 'error'); e.target.value = editing.rows[i][f]; return;
    }
    editing.rows[i][f] = e.target.value;
    const line = e.target.closest('[data-i]');
    line.outerHTML = lineHTML(editing.rows[i], i);
    drawSum();
  });
  $('fmLines').addEventListener('input', e => {
    if (e.target.dataset.f !== 'qty') return;
    const line = e.target.closest('[data-i]'), i = Number(line.dataset.i);
    editing.rows[i].qty = e.target.value;
    const c = lineCost(editing.rows[i]);
    line.querySelector('[data-cost]').textContent = c == null ? '—' : rm(c);
    drawSum();
  });

  $('fmForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = $('fmName').value.trim();
    const price = Number($('fmPrice').value);
    const portions = Number($('fmPortions').value);
    if (!name) { toast('Enter the menu name.', 'error'); $('fmName').focus(); return; }
    if ($('fmPrice').value.trim() === '' || !(price >= 0)) { toast('Enter a valid selling price.', 'error'); return; }
    if (!(portions > 0)) { toast('"Recipe makes" must be more than 0.', 'error'); return; }
    if (editing.rows.some(r => !(r.item || r.menu) || !(Number(r.qty) > 0))) {
      toast('Each line needs an item or lauk and a quantity above 0 (or remove the line).', 'error'); return;
    }
    $('fmSave').disabled = true;
    const { error } = await sb.rpc('save_menu', {
      p_id: editing.id, p_outlet: editing.outlet, p_name: name, p_price: Math.round(price * 100) / 100, p_portions: portions,
      p_lines: editing.rows.map(r => (isLauk(r) ? { menu: r.menu, qty: Number(r.qty) } : { item: r.item, qty: Number(r.qty) }))
    });
    $('fmSave').disabled = false;
    if (error) {
      toast(error.code === '23505' ? 'A menu with this name already exists in this outlet.'
        : /loop/.test(error.message) ? 'Not saved: these menus would include each other (e.g. A uses B and B uses A).'
        : 'Not saved: ' + error.message, 'error');
      return;
    }
    $('fmDialog').close();
    toast(editing.id ? 'Menu updated.' : 'Menu added.');
    refresh();
  });

  $('fmDelete').onclick = async () => {
    if (!editing?.id) return;
    if (!confirm(`Delete "${$('fmName').value.trim()}" and its recipe?`)) return;
    $('fmDelete').disabled = true;
    const { data, error } = await sb.from('menu_items').delete().eq('id', editing.id).select('id');
    $('fmDelete').disabled = false;
    if (error?.code === '23503') { toast('This is used as a lauk in other menus. Remove it from those menus first.', 'error'); return; }
    if (error || !data?.length) { toast('Not deleted: ' + (error?.message || 'no access.'), 'error'); return; }
    $('fmDialog').close();
    toast('Menu deleted.');
    refresh();
  };
}

// ---------------- Halaman ----------------
export default {
  async render(view) {
    if (!isPro()) { view.innerHTML = lockCard('Food Cost', 'See the cost per plate, menu margins and food cost % for every outlet, so you know which menu really makes money.'); return; }
    view.innerHTML = `
      <section class="card stack">
        <div class="seg" role="group" aria-label="Period">
          ${Object.entries(PERIODS).map(([k, v]) => `<button type="button" class="seg-opt ${state.period === k ? 'on' : ''}" data-period="${k}" aria-pressed="${state.period === k}">${v}</button>`).join('')}
        </div>
        <div id="fcPeriod"><div class="skel"></div></div>
      </section>
      <div class="section-row"><h2 class="section-title">Cost per plate</h2><button class="btn white" id="fcAdd" type="button">+ Add menu</button></div>
      <p class="note-line small" id="fcPriceNote" hidden></p>
      <div class="list" id="fcMenus"><div class="skel"></div></div>
      ${dialogHTML()}`;

    const showPeriod = async () => {
      const v = ++version;
      const [from, to] = periodRange(state.period);
      try {
        const d = await loadPeriod(from, to);
        if (v === version) $('fcPeriod').innerHTML = periodHTML(d, from, to);
      } catch { if (v === version) $('fcPeriod').innerHTML = '<p class="note">Could not load food cost. Check your internet and try again.</p>'; }
    };
    const refresh = async () => {
      try { await loadAll(); renderMenus(); }
      catch { $('fcMenus').innerHTML = '<div class="empty">Could not load menus. Check your internet and try again.</div>'; }
    };

    view.querySelectorAll('[data-period]').forEach(b => b.addEventListener('click', () => {
      state.period = b.dataset.period;
      view.querySelectorAll('[data-period]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
      showPeriod();
    }));
    $('fcAdd').onclick = () => openMenu(null);
    $('fcMenus').addEventListener('click', e => {
      const b = e.target.closest('[data-menu]');
      if (b) openMenu(menus.find(m => m.id === b.dataset.menu));
    });
    bindDialog(refresh);

    await Promise.all([showPeriod(), refresh()]);
    return () => { version++; };
  }
};
