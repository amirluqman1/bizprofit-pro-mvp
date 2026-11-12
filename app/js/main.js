// Titik mula app: login, rangka, outlet, navigasi.
import { $, toast } from './ui.js';
import { sb, session, loadAccount, setOutlet, onOutletChange, clearSession, ALL_OUTLETS, ROLE_NAME } from './session.js';
import { startRouter, stopRouter, rerender } from './router.js';

let lowStock = 0;

// Loceng: titik kuning jika ada barang habis atau kurang dari "patut ada".
async function refreshBell() {
  let q = sb.from('inventory_items').select('current_qty,target_qty');
  if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
  const { data, error } = await q;
  lowStock = error ? 0 : (data || []).filter(x => Number(x.current_qty) < Number(x.target_qty) || Number(x.current_qty) <= 0).length;
  $('bellDot').hidden = lowStock === 0;
  $('bellBtn').setAttribute('aria-label', lowStock ? `Notifikasi: ${lowStock} barang perlu tambah` : 'Notifikasi');
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
  if (session.isOwner && session.outlets.length > 1) opts.push(new Option('Semua outlet', ALL_OUTLETS));
  session.outlets.forEach(o => opts.push(new Option(o.name, o.id)));
  sel.replaceChildren(...opts);
  sel.value = session.outletId;
  const locked = opts.length < 2;
  sel.disabled = locked;
  $('outletWrap').classList.toggle('locked', locked);
}

async function enterApp() {
  $('greet').textContent = session.isOwner ? 'Selamat datang, Boss 👋' : `Selamat datang, ${ROLE_NAME[session.role]} 👋`;
  $('businessName').textContent = session.business?.name || 'Sistem Pengurusan F&B';
  fillOutletPicker();
  $('boot').hidden = true;
  $('login').hidden = true;
  $('app').hidden = false;
  await startRouter();
  refreshBell();
}

async function boot() {
  if (!sb) { showLogin('config.js tidak dijumpai.'); return; }
  // Jangan tunggu selamanya jika sambungan/sesi tersekat.
  const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
  const res = await Promise.race([sb.auth.getSession(), timeout]);
  if (res === 'timeout') { showLogin('Sambungan lambat. Sila log masuk semula.'); return; }
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
  if (!email || !password) { toast('Isi emel dan kata laluan.', 'error'); return; }
  const btn = $('loginBtn');
  btn.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { btn.disabled = false; toast('Emel atau kata laluan salah.', 'error'); return; }
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
  if (!lowStock) { toast('Tiada notifikasi. Semua stok mencukupi.'); return; }
  toast(`${lowStock} barang habis atau perlu tambah stok.`);
  location.hash = '#/stok';
});

boot().catch(e => showLogin('Ralat aplikasi: ' + e.message));
