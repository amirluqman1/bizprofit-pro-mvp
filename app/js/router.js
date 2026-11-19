// Navigasi ikut hash (#/utama) supaya butang Back phone berfungsi.
import { $, icon, animateIn } from './ui.js';
import { session } from './session.js';
import utama from './pages/utama.js';
import rekod from './pages/rekod.js';
import stok from './pages/stok.js';
import pekerja from './pages/pekerja.js';
import menu from './pages/menu.js';
import laporan from './pages/laporan.js';

// roles: siapa boleh buka halaman. Staff tidak boleh nampak Utama (ada profit) atau Pekerja.
const PAGES = [
  { path: 'utama',   label: 'Home',   icon: 'home',    page: utama,   roles: ['owner', 'admin', 'manager'] },
  { path: 'rekod',   label: 'Records',   icon: 'receipt', page: rekod,   roles: ['owner', 'admin', 'manager', 'staff'] },
  { path: 'stok',    label: 'Stock',    icon: 'box',     page: stok,    roles: ['owner', 'admin', 'manager', 'staff'] },
  { path: 'pekerja', label: 'Staff', icon: 'users',   page: pekerja, roles: ['owner', 'admin', 'manager'] },
  { path: 'menu',    label: 'Menu',    icon: 'menu',    page: menu,    roles: ['owner', 'admin', 'manager', 'staff'] },
  // Tiada tab: dibuka dari butang pintas di Utama.
  { path: 'laporan', label: 'Report', icon: 'chart',   page: laporan, roles: ['owner', 'admin', 'manager'], tab: false }
];

const allowed = () => PAGES.filter(p => p.roles.includes(session.role));
const homePath = () => (session.isManagerUp ? 'utama' : 'rekod');
let current = null;   // { path, cleanup }

export function buildTabbar() {
  $('tabbar').innerHTML = allowed().filter(p => p.tab !== false).map(p =>
    `<a class="tab" href="#/${p.path}" data-path="${p.path}">${icon(p.icon)}<span>${p.label}</span></a>`
  ).join('');
}

export async function render() {
  const wanted = location.hash.replace(/^#\/?/, '').split('?')[0];
  const entry = allowed().find(p => p.path === wanted);
  if (!entry) { location.replace('#/' + homePath()); return; }

  if (current?.cleanup) { try { current.cleanup(); } catch { /* abaikan */ } }
  document.querySelectorAll('.tab').forEach(t => {
    if (t.dataset.path === entry.path) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  });
  const view = $('view');
  view.innerHTML = '';
  const cleanup = await entry.page.render(view);
  current = { path: entry.path, cleanup };
  animateIn(view);
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.removeEventListener('hashchange', render);
  window.addEventListener('hashchange', render);
  buildTabbar();
  return render();
}

export function stopRouter() {
  window.removeEventListener('hashchange', render);
  if (current?.cleanup) { try { current.cleanup(); } catch { /* abaikan */ } }
  current = null;
  $('view').innerHTML = '';
}

export function rerender() { return render(); }
