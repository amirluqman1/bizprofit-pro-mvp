// BizProfit POS: ambil order, bil terbuka, bayar, resit.
// Semua harga, jumlah dan baki muktamad dikira oleh DATABASE (pos_pay_order, Fasa 19).
// App ini hanya papar anggaran dan menghantar menu + kuantiti.
import { $, esc, toast, store } from '../../app/js/ui.js';
import { sb, session, loadAccount, NO_PROFILE } from '../../app/js/session.js';
import { rm } from '../../app/js/format.js';
import { t, getLang, setLang, applyStatic, locale } from '../../app/js/i18n.js';
import * as printer from './printer.js';

const OUTLET_KEY = 'bp.pos.outlet';
const isCash = name => /tunai|cash/i.test(name || '');
const sen = n => Math.round(Number(n || 0) * 100);
const uuid = () => crypto.randomUUID();
const errText = e => e?.message || t('Unknown error.');

const st = {
  outletId: null, settings: {}, menus: [], cat: null, methods: [],
  view: 'order', openCount: 0,
  cart: null,          // lihat newCart()
  lastReceipt: null    // { order, items } untuk cetak semula
};

const newCart = () => ({ id: uuid(), existing: false, orderNo: null, type: 'makan_sini', table: '', label: '', lines: [] });
// Baris troli: { key, id, menuId, name, price, qty, origQty, note, origNote, saved, removed }

// ================= Mula =================
applyStatic();
boot();

async function boot() {
  if (!sb) { $('boot').textContent = t('App configuration is missing.'); return; }
  const { data } = await sb.auth.getSession();
  if (data.session?.user) await afterLogin(data.session.user);
  else showLogin();
}

function showLogin(msg) {
  $('boot').hidden = true; $('app').hidden = true; $('pickOutlet').hidden = true;
  $('login').hidden = false;
  $('loginMsg').hidden = !msg; $('loginMsg').textContent = msg || '';
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  $('loginBtn').disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPw').value });
  $('loginBtn').disabled = false;
  if (error) { showLogin(t('Wrong email or password.')); return; }
  await afterLogin(data.user);
});

async function afterLogin(user) {
  const err = await loadAccount(user);
  if (err === NO_PROFILE) { showLogin(t('This account has no business yet. Open BizProfit to set it up first.')); return; }
  if (err) { showLogin(err); return; }
  const saved = store.get(OUTLET_KEY);
  if (session.outlets.length === 1) st.outletId = session.outlets[0].id;
  else if (session.outlets.some(o => o.id === saved)) st.outletId = saved;
  else { pickOutlet(); return; }
  await enter();
}

function pickOutlet() {
  $('boot').hidden = true; $('login').hidden = true; $('app').hidden = true;
  $('pickOutlet').hidden = false;
  $('outletList').innerHTML = session.outlets.map(o => `<button type="button" class="btn ghost big outlet-btn" data-outlet="${esc(o.id)}">${esc(o.name)}</button>`).join('');
}
$('outletList').addEventListener('click', async e => {
  const b = e.target.closest('[data-outlet]');
  if (!b) return;
  st.outletId = b.dataset.outlet;
  store.set(OUTLET_KEY, st.outletId);
  await enter();
});

async function enter() {
  $('boot').hidden = true; $('login').hidden = true; $('pickOutlet').hidden = true;
  $('app').hidden = false;
  $('topOutlet').textContent = session.outlets.find(o => o.id === st.outletId)?.name || '';
  $('whoami').textContent = `${session.user.email} · ${session.outlets.find(o => o.id === st.outletId)?.name || ''}`;
  st.cart = newCart();
  await Promise.all([loadSettings(), loadMenus(), loadMethods()]);
  renderOrder();
  refreshOpenCount();
  printer.reconnect().then(paintPrinter);
}

async function loadSettings() {
  const { data, error } = await sb.from('pos_settings').select('*').eq('outlet_id', st.outletId).maybeSingle();
  if (error) toast(t('Could not load POS settings. Has the POS database update (Fasa 19) been applied?'), 'error');
  st.settings = data || {};
}
async function loadMenus() {
  const { data, error } = await sb.from('menu_items').select('id,name,selling_price,category,available,sort_order')
    .eq('outlet_id', st.outletId).gt('selling_price', 0).order('sort_order').order('name');
  if (error) { toast(t('Could not load the menu.'), 'error'); st.menus = []; return; }
  st.menus = data || [];
}
async function loadMethods() {
  const { data } = await sb.from('payment_methods').select('name').order('name');
  st.methods = (data || []).map(p => p.name);
  st.methods.sort((a, b) => Number(isCash(b)) - Number(isCash(a)));   // tunai dahulu
}

// ================= Navigasi =================
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
function showView(v) {
  st.view = v;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('viewOrder').hidden = v !== 'order';
  $('viewBills').hidden = v !== 'bills';
  $('viewToday').hidden = v !== 'today';
  if (v === 'bills') renderBills();
  if (v === 'today') renderToday();
}

// ================= Menu & troli =================
function renderOrder() {
  const cats = [...new Set(st.menus.map(m => m.category || t('Other')))];
  if (st.cat && !cats.includes(st.cat)) st.cat = null;
  $('cats').innerHTML = cats.length > 1
    ? [`<button type="button" class="cat ${st.cat ? '' : 'on'}" data-cat="">${t('All')}</button>`,
       ...cats.map(c => `<button type="button" class="cat ${st.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)].join('')
    : '';
  renderMenuGrid();
  renderCart();
}

function renderMenuGrid() {
  const list = st.menus.filter(m => !st.cat || (m.category || t('Other')) === st.cat);
  const inCart = id => st.cart.lines.filter(l => l.menuId === id && !l.removed).reduce((a, l) => a + l.qty, 0);
  $('menuGrid').innerHTML = list.length
    ? list.map(m => {
        const q = inCart(m.id);
        return `<button type="button" class="mi" data-menu="${esc(m.id)}" ${m.available ? '' : 'disabled'}>${q ? `<i class="q">${q}</i>` : ''}<b>${esc(m.name)}</b><span>${m.available ? rm(m.selling_price) : t('Sold out')}</span></button>`;
      }).join('')
    : `<div class="empty">${st.menus.length ? t('No menu in this category.') : t('No menu yet. The owner or admin adds menu items in BizProfit → Menu → POS (counter).')}</div>`;
}

$('cats').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  st.cat = b.dataset.cat || null;
  renderOrder();
});

$('menuGrid').addEventListener('click', e => {
  const b = e.target.closest('[data-menu]');
  if (!b || b.disabled) return;
  const m = st.menus.find(x => x.id === b.dataset.menu);
  const line = st.cart.lines.find(l => l.menuId === m.id && !l.saved && !l.note && !l.removed);
  if (line) line.qty++;
  else st.cart.lines.push({ key: uuid(), id: uuid(), menuId: m.id, name: m.name, price: Number(m.selling_price), qty: 1, origQty: 0, note: '', origNote: '', saved: false, removed: false });
  renderMenuGrid(); renderCart();
});

const activeLines = () => st.cart.lines.filter(l => !l.removed);
const cartTotalSen = () => activeLines().reduce((a, l) => a + sen(l.price) * l.qty, 0);

function renderCart() {
  const c = st.cart, s = st.settings;
  document.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('on', b.dataset.type === c.type));
  $('tableNo').hidden = !(s.table_numbers && c.type === 'makan_sini');
  $('tableNo').placeholder = t('Table no.');
  $('tableNo').value = c.table;
  $('billLabel').placeholder = t('Bill name (optional)');
  $('billLabel').value = c.label;
  $('cartInfo').textContent = c.existing
    ? `${t('Open bill')}${c.orderNo ? ' #' + c.orderNo : ''} · ${t('items with ✓ are saved')}`
    : '';
  const lines = activeLines();
  $('cartLines').innerHTML = lines.length
    ? lines.map(l => `<div class="ln ${l.saved && l.qty === l.origQty && l.note === l.origNote ? 'saved' : ''}" data-key="${l.key}">
        <div class="ln-name">${esc(l.name)}<small>${rm(l.price)}</small>${l.note ? `<div class="ln-note">${esc(l.note)}</div>` : ''}</div>
        <div class="ln-amt">${rm((sen(l.price) * l.qty) / 100)}</div>
        <div class="ln-ctl"><button type="button" data-act="minus" aria-label="${t('Less')}">−</button><span class="qty">${l.qty}</span><button type="button" data-act="plus" aria-label="${t('More')}">+</button>
          <button type="button" class="note-btn" data-act="note">${l.note ? t('Edit note') : t('+ Note')}</button></div>
      </div>`).join('')
    : `<div class="empty">${t('Tap a menu item to add it.')}</div>`;
  const total = cartTotalSen() / 100;
  $('cartTotal').textContent = rm(total);
  $('payBtn').textContent = `${t('Pay')} ${rm(total)}`;
  $('payBtn').disabled = !lines.length;
  $('saveBill').disabled = !lines.length;
  $('saveBill').textContent = c.existing ? t('Update bill') : t('Save bill');
  $('voidBill').hidden = !c.existing;
  const n = lines.reduce((a, l) => a + l.qty, 0);
  $('cartBarText').textContent = n ? t(n === 1 ? '{n} item' : '{n} items', { n }) : t('Cart is empty');
  $('cartBarTotal').textContent = rm(total);
}

document.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => { st.cart.type = b.dataset.type; renderCart(); }));
$('tableNo').addEventListener('input', e => { st.cart.table = e.target.value; });
$('billLabel').addEventListener('input', e => { st.cart.label = e.target.value; });

let noteLine = null;
$('cartLines').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const l = st.cart.lines.find(x => x.key === b.closest('[data-key]').dataset.key);
  if (b.dataset.act === 'plus') l.qty++;
  if (b.dataset.act === 'minus') {
    if (l.qty > 1) l.qty--;
    else if (!l.saved) st.cart.lines = st.cart.lines.filter(x => x !== l);
    else if (confirm(t('Remove "{x}" from this bill? This is recorded.', { x: l.name }))) l.removed = true;
  }
  if (b.dataset.act === 'note') {
    noteLine = l;
    $('noteTitle').textContent = t('Note for {x}', { x: l.name });
    $('noteIn').value = l.note;
    $('noteQuick').innerHTML = [t('Less spicy'), t('No ice'), t('Less sugar'), t('Extra')].map(q => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('');
    $('noteDialog').showModal();
    return;
  }
  renderMenuGrid(); renderCart();
});
$('noteQuick').addEventListener('click', e => {
  const b = e.target.closest('[data-q]');
  if (b) $('noteIn').value = [$('noteIn').value.trim(), b.dataset.q].filter(Boolean).join(', ').slice(0, 100);
});
$('noteForm').addEventListener('submit', () => {
  if (!noteLine) return;
  noteLine.note = $('noteIn').value.trim().slice(0, 100);
  renderCart();
});

$('newOrder').onclick = () => {
  const dirty = st.cart.lines.some(l => !l.saved || l.removed || l.qty !== l.origQty || l.note !== l.origNote);
  if (dirty && !confirm(t('Clear this order? Unsaved items will be lost.'))) return;
  st.cart = newCart(); renderOrder(); closeCart();
};
$('cartBar').onclick = () => $('viewOrder').classList.add('cart-open');
const closeCart = () => $('viewOrder').classList.remove('cart-open');
$('cartClose').onclick = closeCart;

// ================= Simpan ke database (selamat diulang) =================
// Order & item guna ID yang dijana di tablet: hantar semula tidak mencipta salinan.
async function syncCart() {
  const c = st.cart;
  const meta = { order_type: c.type, table_no: (st.settings.table_numbers && c.type === 'makan_sini' && c.table.trim()) || null, label: c.label.trim() || null };
  if (!c.existing) {
    const { error } = await sb.from('pos_orders').upsert({ id: c.id, outlet_id: st.outletId, ...meta }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  } else {
    const { error } = await sb.from('pos_orders').update(meta).eq('id', c.id);
    if (error) throw error;
  }
  const fresh = c.lines.filter(l => !l.saved && !l.removed);
  if (fresh.length) {
    const { error } = await sb.from('pos_order_items').upsert(
      fresh.map(l => ({ id: l.id, order_id: c.id, menu_item_id: l.menuId, qty: l.qty, note: l.note || null })),
      { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
  }
  for (const l of c.lines.filter(x => x.saved && !x.removed && (x.qty !== x.origQty || x.note !== x.origNote))) {
    const { error } = await sb.from('pos_order_items').update({ qty: l.qty, note: l.note || null }).eq('id', l.id);
    if (error) throw error;
  }
  for (const l of c.lines.filter(x => x.saved && x.removed)) {
    const { error } = await sb.from('pos_order_items').update({ removed_at: new Date().toISOString() }).eq('id', l.id);
    if (error) throw error;
  }
  // Untuk slip dapur: item baru + tambahan kuantiti.
  const kitchen = c.lines.filter(l => !l.removed && (l.qty > l.origQty || (!l.saved))).map(l => ({ name: l.name, qty: l.saved ? l.qty - l.origQty : l.qty, note: l.note }));
  c.lines = c.lines.filter(l => !l.removed).map(l => ({ ...l, saved: true, origQty: l.qty, origNote: l.note }));
  c.existing = true;
  return kitchen.filter(k => k.qty > 0);
}

$('saveBill').onclick = async () => {
  $('saveBill').disabled = true;
  try {
    const kitchen = await syncCart();
    const { data } = await sb.from('pos_orders').select('order_no').eq('id', st.cart.id).maybeSingle();
    st.cart.orderNo = data?.order_no || null;
    toast(t('Bill saved.') + (st.cart.orderNo ? ` #${st.cart.orderNo}` : ''));
    if (st.settings.kitchen_slip && kitchen.length) await tryPrint(kitchenSlip(st.cart, kitchen));
    st.cart = newCart(); renderOrder(); closeCart(); refreshOpenCount();
  } catch (e) { toast(t('Could not save: ') + errText(e), 'error'); renderCart(); }
};

$('voidBill').onclick = async () => {
  const hasItems = st.cart.lines.some(l => l.saved);
  const reason = hasItems ? prompt(t('Reason for cancelling this bill (owner/admin only):')) : '';
  if (hasItems && reason === null) return;
  if (!hasItems && !confirm(t('Cancel this empty bill?'))) return;
  const { error } = await sb.rpc('pos_void_order', { p_order: st.cart.id, p_reason: reason || null });
  if (error) { toast(errText(error), 'error'); return; }
  toast(t('Bill cancelled.'));
  st.cart = newCart(); renderOrder(); closeCart(); refreshOpenCount();
};

// ================= Bayar =================
let payMethod = null;
$('payBtn').onclick = () => {
  if (!activeLines().length) return;
  payMethod = st.methods[0] || null;
  $('payTotal').textContent = rm(cartTotalSen() / 100);
  $('payMethods').innerHTML = st.methods.map(m => `<button type="button" data-method="${esc(m)}">${esc(m)}</button>`).join('');
  $('cashIn').value = '';
  paintPay();
  $('payDialog').showModal();
};
function paintPay() {
  const total = cartTotalSen();
  document.querySelectorAll('[data-method]').forEach(b => b.classList.toggle('on', b.dataset.method === payMethod));
  const cash = isCash(payMethod);
  $('cashBox').hidden = !cash;
  if (cash) {
    const notes = [500, 1000, 2000, 5000, 10000].map(n => Math.ceil(total / n) * n).filter((v, i, a) => v > total && a.indexOf(v) === i).slice(0, 4);
    $('quickCash').innerHTML = [`<button type="button" data-cash="${total}">${t('Exact')}</button>`, ...notes.map(v => `<button type="button" data-cash="${v}">${rm(v / 100)}</button>`)].join('');
    const got = sen($('cashIn').value);
    $('changeOut').textContent = $('cashIn').value === '' ? '—' : got >= total ? rm((got - total) / 100) : t('Not enough');
    $('payConfirm').disabled = !($('cashIn').value !== '' && got >= total);
  } else $('payConfirm').disabled = !payMethod;
}
$('payMethods').addEventListener('click', e => { const b = e.target.closest('[data-method]'); if (b) { payMethod = b.dataset.method; paintPay(); } });
$('quickCash').addEventListener('click', e => { const b = e.target.closest('[data-cash]'); if (b) { $('cashIn').value = (Number(b.dataset.cash) / 100).toFixed(2); paintPay(); } });
$('cashIn').addEventListener('input', paintPay);

$('payConfirm').onclick = async () => {
  $('payConfirm').disabled = true;
  const label = $('payConfirm').textContent;
  $('payConfirm').textContent = t('Saving…');
  const cash = isCash(payMethod) ? Math.round(Number($('cashIn').value) * 100) / 100 : null;
  try {
    const kitchen = await syncCart();
    const { data, error } = await sb.rpc('pos_pay_order', { p_order: st.cart.id, p_payment_method: payMethod, p_cash_received: cash });
    if (error) throw error;
    $('payDialog').close();
    const receipt = await fetchReceipt(st.cart.id);
    st.lastReceipt = receipt;
    showDone(data, receipt);
    let bytes = receiptBytes(receipt);
    if (st.settings.kitchen_slip && kitchen.length) bytes = concat(bytes, kitchenSlip({ ...st.cart, orderNo: data.order_no }, kitchen));
    await tryPrint(bytes, true);
    st.cart = newCart(); renderOrder(); closeCart(); refreshOpenCount();
  } catch (e) {
    toast(t('Payment not completed: ') + errText(e), 'error');
    renderCart();
  } finally {
    $('payConfirm').textContent = label;
    paintPay();
  }
};

function showDone(res, receipt) {
  $('doneTotal').textContent = rm(res.total);
  $('doneChange').textContent = res.change != null ? `${t('Change')}: ${rm(res.change)}` : receipt.order.payment_method;
  $('donePrint').textContent = '';
  $('doneDialog').showModal();
}
$('doneNext').onclick = () => $('doneDialog').close();
$('reprint').onclick = () => st.lastReceipt && tryPrint(receiptBytes(st.lastReceipt), true);

async function fetchReceipt(orderId) {
  const [{ data: order }, { data: items }] = await Promise.all([
    sb.from('pos_orders').select('*').eq('id', orderId).single(),
    sb.from('pos_order_items').select('name,unit_price,qty,line_total,note,removed_at').eq('order_id', orderId).is('removed_at', null).order('created_at')
  ]);
  return { order, items: items || [] };
}

// ================= Resit (ESC/POS) =================
const W = printer.WIDTH;
function itemLines(p, left, right) {
  const room = W - right.length - 1;
  const parts = printer.wrap(left, room);
  parts.forEach((s, i) => p.text(i === parts.length - 1 ? printer.lr(s, right) : s));
}
function receiptBytes({ order, items }) {
  const outlet = session.outlets.find(o => o.id === order.outlet_id) || {};
  const company = outlet.company_name?.trim() || session.business?.name || 'BizProfit';
  const p = printer.escpos().init().align('center');
  p.bold(true).size(1, 2); printer.wrap(company).forEach(l => p.text(l)); p.size(1, 1).bold(false);
  if (outlet.name && outlet.name !== company) p.text(outlet.name);
  if (outlet.company_reg_no) p.text(outlet.company_reg_no);
  if (st.settings.receipt_header) st.settings.receipt_header.split('\n').forEach(r => printer.wrap(r).forEach(l => p.text(l)));
  if (order.order_no) { p.feed(1).bold(true).size(2, 2).text('#' + order.order_no).size(1, 1).bold(false); }
  const tags = [order.order_type === 'bungkus' ? t('Takeaway') : t('Dine in'), order.table_no ? `${t('Table')} ${order.table_no}` : '', order.label || ''].filter(Boolean).join(' / ');
  p.text(tags);
  p.text(new Date(order.paid_at || order.created_at).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }));
  p.align('left').line();
  items.forEach(it => {
    itemLines(p, `${it.qty} x ${it.name}`, rm(it.line_total).replace('RM ', ''));
    if (it.note) printer.wrap('  * ' + it.note).forEach(l => p.text(l));
  });
  p.line().bold(true).text(printer.lr(t('TOTAL'), rm(order.total))).bold(false);
  p.text(printer.lr(order.payment_method || '', rm(order.cash_received ?? order.total)));
  if (order.change_amount != null) p.text(printer.lr(t('Change'), rm(order.change_amount)));
  p.line().align('center');
  if (st.settings.receipt_footer) st.settings.receipt_footer.split('\n').forEach(r => printer.wrap(r).forEach(l => p.text(l)));
  p.text(`Ref ${order.id.slice(0, 8).toUpperCase()}`);
  return p.feed(4).cut().bytes();
}
function kitchenSlip(cart, lines) {
  const p = printer.escpos().init().align('center').bold(true).size(2, 2);
  p.text(cart.orderNo ? '#' + cart.orderNo : (cart.type === 'bungkus' ? t('TAKEAWAY') : t('KITCHEN')));
  p.size(1, 1);
  p.text([cart.type === 'bungkus' ? t('Takeaway') : t('Dine in'), cart.table ? `${t('Table')} ${cart.table}` : '', cart.label || ''].filter(Boolean).join(' / '));
  p.bold(false).text(new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false, hour: '2-digit', minute: '2-digit' }));
  p.align('left').line();
  lines.forEach(l => {
    p.bold(true).size(1, 2); printer.wrap(`${l.qty} x ${l.name}`).forEach(s => p.text(s)); p.size(1, 1).bold(false);
    if (l.note) printer.wrap('  * ' + l.note).forEach(s => p.text(s));
  });
  return p.line().feed(4).cut().bytes();
}
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out; };

async function tryPrint(bytes, fromDone) {
  try {
    await printer.print(bytes);
    if (fromDone) $('donePrint').textContent = t('Receipt printed.');
  } catch (e) {
    const msg = e.message === 'NOT_CONNECTED' ? t('Printer not connected. Tap "Printer" at the top, then "Print again".') : t('Print failed: ') + e.message;
    if (fromDone) $('donePrint').textContent = msg; else toast(msg, 'error');
  }
  paintPrinter();
}

// ================= Printer =================
function paintPrinter() {
  const s = printer.status();
  $('printerBtn').classList.toggle('ok', s.connected);
  $('printerLabel').textContent = s.connected ? (s.name || t('Printer')) : t('Connect printer');
}
printer.onStatus(paintPrinter);
$('printerBtn').onclick = async () => {
  if (!printer.supported()) { toast(t('This browser cannot use Bluetooth. Use Chrome on Android.'), 'error'); return; }
  if (printer.status().connected) {
    if (confirm(t('Print a test receipt?'))) tryPrint(printer.escpos().init().align('center').text('BizProfit POS').text(t('Printer OK')).feed(4).cut().bytes());
    return;
  }
  try { await printer.choose(); toast(t('Printer connected.')); }
  catch (e) { if (e.name !== 'NotFoundError') toast(t('Could not connect printer: ') + e.message, 'error'); }
  paintPrinter();
};

// ================= Bil terbuka =================
async function refreshOpenCount() {
  const { data } = await sb.from('pos_orders').select('id').eq('outlet_id', st.outletId).eq('status', 'terbuka');
  st.openCount = data?.length || 0;
  $('billCount').hidden = !st.openCount;
  $('billCount').textContent = st.openCount;
}
setInterval(() => { if (!$('app').hidden) refreshOpenCount(); }, 60000);

async function itemsOf(ids) {
  if (!ids.length) return [];
  const { data } = await sb.from('pos_order_items').select('id,order_id,menu_item_id,name,unit_price,qty,line_total,note,removed_at,created_at').in('order_id', ids).order('created_at');
  return data || [];
}
const timeOf = iso => new Date(iso).toLocaleTimeString(locale(), { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });
const orderTitle = o => [o.order_no ? '#' + o.order_no : '', o.table_no ? `${t('Table')} ${o.table_no}` : '', o.label || '', o.order_type === 'bungkus' ? t('Takeaway') : ''].filter(Boolean).join(' · ') || t('Bill {x}', { x: timeOf(o.created_at) });

async function renderBills() {
  const box = $('viewBills');
  box.innerHTML = `<div class="empty">${t('Loading…')}</div>`;
  const { data: orders, error } = await sb.from('pos_orders').select('*').eq('outlet_id', st.outletId).eq('status', 'terbuka').order('created_at');
  if (error) { box.innerHTML = `<div class="empty">${t('Could not load bills.')}</div>`; return; }
  const items = await itemsOf(orders.map(o => o.id));
  st.openCount = orders.length; $('billCount').hidden = !orders.length; $('billCount').textContent = orders.length;
  box.innerHTML = orders.length ? orders.map(o => {
    const its = items.filter(i => i.order_id === o.id && !i.removed_at);
    const total = its.reduce((a, i) => a + sen(i.line_total), 0) / 100;
    return `<div class="row"><div class="main"><b>${esc(orderTitle(o))}</b><small>${timeOf(o.created_at)} · ${t(its.length === 1 ? '{n} item' : '{n} items', { n: its.reduce((a, i) => a + i.qty, 0) })}</small></div>
      <span class="amt">${rm(total)}</span><button type="button" class="btn primary" data-open="${esc(o.id)}">${t('Open')}</button></div>`;
  }).join('') : `<div class="empty">${t('No open bills. Save a bill from the Order screen to pay later.')}</div>`;
  box.onclick = async e => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    const o = orders.find(x => x.id === b.dataset.open);
    st.cart = {
      id: o.id, existing: true, orderNo: o.order_no, type: o.order_type, table: o.table_no || '', label: o.label || '',
      lines: items.filter(i => i.order_id === o.id && !i.removed_at).map(i => ({ key: uuid(), id: i.id, menuId: i.menu_item_id, name: i.name, price: Number(i.unit_price), qty: i.qty, origQty: i.qty, note: i.note || '', origNote: i.note || '', saved: true, removed: false }))
    };
    showView('order'); renderOrder();
    $('viewOrder').classList.add('cart-open');
  };
}

// ================= Hari ini =================
async function renderToday() {
  const box = $('viewToday');
  box.innerHTML = `<div class="empty">${t('Loading…')}</div>`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kuala_Lumpur' });
  const { data: orders, error } = await sb.from('pos_orders').select('*').eq('outlet_id', st.outletId).eq('order_date', today).neq('status', 'terbuka').order('created_at', { ascending: false });
  if (error) { box.innerHTML = `<div class="empty">${t('Could not load orders.')}</div>`; return; }
  const paid = orders.filter(o => o.status === 'dibayar');
  const byMethod = {};
  paid.forEach(o => { byMethod[o.payment_method] = (byMethod[o.payment_method] || 0) + sen(o.total); });
  const sum = paid.reduce((a, o) => a + sen(o.total), 0);
  box.innerHTML = `<div class="summary"><div><b>${rm(sum / 100)}</b><span>${t('{n} paid orders', { n: paid.length })}</span></div>
      ${Object.entries(byMethod).map(([m, v]) => `<div><b>${rm(v / 100)}</b><span>${esc(m)}</span></div>`).join('')}</div>
    ${orders.length ? orders.map(o => `<div class="row ${o.status === 'batal' ? 'void' : ''}"><div class="main"><b>${esc(orderTitle(o))}</b>
        <small>${timeOf(o.paid_at || o.created_at)} · ${o.status === 'batal' ? `${t('Cancelled')}${o.void_reason ? ': ' + esc(o.void_reason) : ''}` : esc(o.payment_method || '')}</small></div>
        <span class="amt">${rm(o.total)}</span>
        ${o.status === 'dibayar' ? `<button type="button" class="btn ghost" data-print="${esc(o.id)}">${t('Print')}</button>${session.isAdminUp ? `<button type="button" class="btn link danger" data-void="${esc(o.id)}">${t('Cancel')}</button>` : ''}` : ''}
      </div>`).join('') : `<div class="empty">${t('No orders yet today.')}</div>`}`;
  box.onclick = async e => {
    const pr = e.target.closest('[data-print]');
    if (pr) { const r = await fetchReceipt(pr.dataset.print); st.lastReceipt = r; tryPrint(receiptBytes(r)); return; }
    const v = e.target.closest('[data-void]');
    if (!v) return;
    const reason = prompt(t('Reason for cancelling this paid order:'));
    if (reason === null) return;
    const { error: err } = await sb.rpc('pos_void_order', { p_order: v.dataset.void, p_reason: reason });
    if (err) { toast(errText(err), 'error'); return; }
    toast(t('Order cancelled. The sale was removed from Records (kept in the Audit log).'));
    renderToday();
  };
}

// ================= Menu lain =================
$('moreBtn').onclick = () => {
  document.querySelectorAll('[data-lang]').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()));
  $('changeOutlet').hidden = session.outlets.length < 2;
  $('moreDialog').showModal();
};
document.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); $('moreDialog').close(); renderOrder(); paintPrinter(); if (st.view !== 'order') showView(st.view); });
$('changeOutlet').onclick = () => { $('moreDialog').close(); store.set(OUTLET_KEY, ''); pickOutlet(); };
$('logout').onclick = async () => {
  if (!confirm(t('Log out from this tablet?'))) return;
  await sb.auth.signOut({ scope: 'local' });
  location.reload();
};
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => $(b.dataset.close).close()));
