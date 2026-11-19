// Titik mula app: login, rangka, outlet, navigasi.
import { $, toast } from './ui.js';
import { sb, session, loadAccount, setOutlet, onOutletChange, clearSession, ALL_OUTLETS, ROLE_NAME } from './session.js';
import { startRouter, stopRouter, rerender } from './router.js';
import { initPWA } from './pwa.js';

initPWA();

let lowStock = 0;

// Loceng: titik kuning jika ada barang habis atau kurang dari "patut ada".
async function refreshBell() {
  let q = sb.from('inventory_items').select('current_qty,target_qty');
  if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
  const { data, error } = await q;
  lowStock = error ? 0 : (data || []).filter(x => Number(x.current_qty) < Number(x.target_qty) || Number(x.current_qty) <= 0).length;
  $('bellDot').hidden = lowStock === 0;
  $('bellBtn').setAttribute('aria-label', lowStock ? `Notifications: ${lowStock} items need restocking` : 'Notifications');
}

function showLogin(message) {
  $('boot').hidden = true;
  $('app').hidden = true;
  $('login').hidden = false;
  if (message) toast(message, 'error');
}

function fillOutletPicker() {
  const sel = $('outletSelect');
  const opts = [];
  if (session.isOwner && session.outlets.length > 1) opts.push(new Option('All outlets', ALL_OUTLETS));
  session.outlets.forEach(o => opts.push(new Option(o.name, o.id)));
  sel.replaceChildren(...opts);
  sel.value = session.outletId;
  const locked = opts.length < 2;
  sel.disabled = locked;
  $('outletWrap').classList.toggle('locked', locked);
}

async function enterApp() {
  $('greet').textContent = session.isOwner ? 'Welcome, Boss 👋' : `Welcome, ${ROLE_NAME[session.role]} 👋`;
  $('businessName').textContent = session.business?.name || 'F&B Management System';
  fillOutletPicker();
  $('boot').hidden = true;
  $('login').hidden = true;
  $('app').hidden = false;
  await startRouter();
  refreshBell();
}

async function boot() {
  if (!sb) { showLogin('config.js not found.'); return; }
  // Jangan tunggu selamanya jika sambungan/sesi tersekat.
  const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
  const res = await Promise.race([sb.auth.getSession(), timeout]);
  if (res === 'timeout') { showLogin('Slow connection. Please log in again.'); return; }
  const s = res.data?.session;
  if (!s) { showLogin(); return; }
  const err = await loadAccount(s.user);
  if (err) { showLogin(err); return; }
  await enterApp();
}

$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) { toast('Enter your email and password.', 'error'); return; }
  const btn = $('loginBtn');
  btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { btn.disabled = false; toast('Wrong email or password.', 'error'); return; }
  const err = await loadAccount(data.user);
  btn.disabled = false;
  if (err) { await sb.auth.signOut(); toast(err, 'error'); return; }
  $('loginPassword').value = '';
  await enterApp();
});

window.addEventListener('bp:logout', async () => {
  stopRouter();
  clearSession();
  history.replaceState(null, '', location.pathname);   // buang #/menu
  showLogin();
  $('loginForm').reset();
  try { await sb.auth.signOut(); } catch { /* sesi tempatan tetap dibuang */ }
});

$('outletSelect').addEventListener('change', e => setOutlet(e.target.value));
onOutletChange(() => { rerender(); refreshBell(); });
window.addEventListener('bp:stock-changed', refreshBell);

$('bellBtn').addEventListener('click', () => {
  if (!lowStock) { toast('No notifications. All stock is sufficient.'); return; }
  toast(`${lowStock} items are out of stock or need restocking.`);
  location.hash = '#/stok';
});

boot().catch(e => showLogin('App error: ' + e.message));
