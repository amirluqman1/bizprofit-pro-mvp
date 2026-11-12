// Titik mula app: login, rangka, outlet, navigasi.
import { $, toast } from './ui.js';
import { sb, session, loadAccount, setOutlet, onOutletChange, ALL_OUTLETS, ROLE_NAME } from './session.js';
import { startRouter, rerender } from './router.js';

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
}

async function boot() {
  if (!sb) { showLogin('config.js tidak dijumpai.'); return; }
  const { data: { session: s } } = await sb.auth.getSession();
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

$('outletSelect').addEventListener('change', e => setOutlet(e.target.value));
onOutletChange(() => rerender());

$('bellBtn').addEventListener('click', () => toast('Notifikasi stok akan ditambah dalam fasa seterusnya.'));

boot().catch(e => showLogin('Ralat aplikasi: ' + e.message));
