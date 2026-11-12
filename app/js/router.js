// Navigasi ikut hash (#/utama) supaya butang Back phone berfungsi.
import { $, icon } from './ui.js';
import { session } from './session.js';
import utama from './pages/utama.js';
import rekod from './pages/rekod.js';
import stok from './pages/stok.js';
import pekerja from './pages/pekerja.js';
import menu from './pages/menu.js';

// roles: siapa boleh buka halaman. Staff tidak boleh nampak Utama (ada profit) atau Pekerja.
const PAGES = [
  { path: 'utama',   label: 'Utama',   icon: 'home',    page: utama,   roles: ['owner', 'manager'] },
  { path: 'rekod',   label: 'Rekod',   icon: 'receipt', page: rekod,   roles: ['owner', 'manager', 'staff'] },
  { path: 'stok',    label: 'Stok',    icon: 'box',     page: stok,    roles: ['owner', 'manager', 'staff'] },
  { path: 'pekerja', label: 'Pekerja', icon: 'users',   page: pekerja, roles: ['owner', 'manager'] },
  { path: 'menu',    label: 'Menu',    icon: 'menu',    page: menu,    roles: ['owner', 'manager', 'staff'] }
];

const allowed = () => PAGES.filter(p => p.roles.includes(session.role));
const homePath = () => (session.isManagerUp ? 'utama' : 'rekod');
let current = null;   // { path, cleanup }

export function buildTabbar() {
  $('tabbar').innerHTML = allowed().map(p =>
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
  $('pageTitle').textContent = entry.page.subtitle || '';
  const view = $('view');
  view.innerHTML = '';
  const cleanup = await entry.page.render(view);
  current = { path: entry.path, cleanup };
  window.scrollTo(0, 0);
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  buildTabbar();
  return render();
}

export function rerender() { return render(); }
