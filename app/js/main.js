// Titik mula app: login, rangka, outlet, navigasi.
import { $, toast } from './ui.js';
import { sb, session, setOutlet, onOutletChange, clearSession, ALL_OUTLETS } from './session.js';
import { initAuth, showAuth, afterAuth } from './auth.js';
import { startRouter, stopRouter, rerender, rebuildNav } from './router.js';
import { initPWA } from './pwa.js';
import { t, applyStatic } from './i18n.js';

initPWA();
applyStatic();

let lowStock = 0;

// Loceng: titik kuning jika ada barang habis atau kurang dari "patut ada".
async function refreshBell() {
  let q = sb.from('inventory_items').select('current_qty,target_qty');
  if (session.outletId !== ALL_OUTLETS) q = q.eq('outlet_id', session.outletId);
  const { data, error } = await q;
  lowStock = error ? 0 : (data || []).filter(x => Number(x.current_qty) < Number(x.target_qty) || Number(x.current_qty) <= 0).length;
  $('bellDot').hidden = lowStock === 0;
  $('bellBtn').setAttribute('aria-label', lowStock ? t('Notifications: {n} items need restocking', { n: lowStock }) : t('Notifications'));
}

const showLogin = message => showAuth('login', undefined, message);

// Pautan e-mel "set semula kata laluan": Supabase beri sesi khas + peristiwa PASSWORD_RECOVERY.
let recovery = !!window.BP_RECOVERY;
sb?.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') { recovery = true; showAuth('reset'); } });

function fillOutletPicker() {
  const sel = $('outletSelect');
  const opts = [];
  if (session.isOwner && session.outlets.length > 1) opts.push(new Option(t('All outlets'), ALL_OUTLETS));
  session.outlets.forEach(o => opts.push(new Option(o.name, o.id)));
  sel.replaceChildren(...opts);
  sel.value = session.outletId;
  const locked = opts.length < 2;
  sel.disabled = locked;
  $('outletWrap').classList.toggle('locked', locked);
}

async function enterApp() {
  $('businessName').textContent = session.business?.name || t('F&B Management System');
  fillOutletPicker();
  $('boot').hidden = true;
  $('login').hidden = true;
  $('app').hidden = false;
  await startRouter();
  refreshBell();
}

async function boot() {
  if (!sb) { showLogin(t('config.js not found.')); return; }
  const inv = await initAuth({ ready: enterApp });
  // Jangan tunggu selamanya jika sambungan/sesi tersekat.
  const timeout = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
  const res = await Promise.race([sb.auth.getSession(), timeout]);
  if (res === 'timeout') { showLogin(t('Slow connection. Please log in again.')); return; }
  const s = res.data?.session;
  if (s && recovery) { showAuth('reset'); return; }
  // Dibuka dari pautan jemputan: tunjuk borang daftar (atau log masuk) dengan maklumat jemputan.
  if (!s) { showAuth(inv?.valid ? 'signup' : 'login'); return; }
  await afterAuth(s.user);
}

window.addEventListener('bp:logout', async () => {
  stopRouter();
  clearSession();
  history.replaceState(null, '', location.pathname);   // buang #/menu
  showLogin();
  // scope 'local': keluar dari peranti ini sahaja. Asal Supabase ialah 'global', yang menendang keluar
  // SEMUA peranti yang guna akaun sama (masalah bila satu akaun dikongsi, contoh akaun outlet).
  try { await sb.auth.signOut({ scope: 'local' }); } catch { /* sesi tempatan tetap dibuang */ }
});

$('outletSelect').addEventListener('change', e => setOutlet(e.target.value));
onOutletChange(() => { rerender(); refreshBell(); });
window.addEventListener('bp:stock-changed', refreshBell);
// Tukar bahasa: lukis semula menu, pemilih outlet dan halaman semasa.
// Owner tambah outlet: kemas kini pemilih outlet (pilihan "Semua outlet" muncul bila lebih dari 1).
window.addEventListener('bp:outlets-changed', fillOutletPicker);
window.addEventListener('bp:lang', () => {
  if ($('app').hidden) return;
  fillOutletPicker(); refreshBell(); rebuildNav();
});

$('bellBtn').addEventListener('click', () => {
  if (!lowStock) { toast(t('No notifications. All stock is sufficient.')); return; }
  toast(t('{n} items are out of stock or need restocking.', { n: lowStock }));
  location.hash = '#/stok';
});

boot().catch(e => showLogin(t('App error: ') + e.message));
