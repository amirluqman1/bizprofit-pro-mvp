// Pembantu kecil untuk paparan.
export const $ = id => document.getElementById(id);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

export const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

let toastTimer;
export function toast(text, kind = 'ok') {
  const t = $('toast');
  t.textContent = text;
  t.classList.toggle('error', kind === 'error');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// localStorage boleh gagal (mod peribadi, storan disekat) — jangan biar app rosak.
export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* abaikan */ } }
};

// ---------- Animasi masuk (sekali bila halaman dibuka) ----------
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Bekas ini tak dianimasikan sendiri; anak-anaknya yang muncul satu-satu.
const WRAPPERS = '.stats3, .shortcuts, .list, #stokItems, #pkBody, #rekodBody, #atList, #pyList';
let revealObs = null;

export function animateIn(root) {
  revealObs?.disconnect();
  if (calm() || !('IntersectionObserver' in window)) return;
  const targets = [];
  const walk = el => {
    for (const c of el.children) {
      if (c.hidden || c.tagName === 'DIALOG' || c.tagName === 'SCRIPT') continue;
      if (c.matches(WRAPPERS)) walk(c); else targets.push(c);
    }
  };
  walk(root);
  revealObs = new IntersectionObserver(entries => {
    const shown = entries.filter(e => e.isIntersecting).map(e => e.target);
    shown.forEach((el, i) => {
      revealObs.unobserve(el);
      el.style.setProperty('--d', Math.min(i * 60, 360) + 'ms');
      el.classList.add('in');
      el.addEventListener('animationend', () => { el.classList.remove('rv', 'in'); el.style.removeProperty('--d'); }, { once: true });
    });
  }, { rootMargin: '0px 0px -20px 0px' });
  targets.forEach(el => { el.classList.add('rv'); revealObs.observe(el); });
}

// Nombor naik dari 0 ke nilai sebenar. Elemen: data-count="1630.6" data-fmt="money|int".
const money2 = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function countUp(root, ms = 900) {
  if (calm()) return;
  root.querySelectorAll('[data-count]').forEach(el => {
    const end = Number(el.dataset.count);
    if (!Number.isFinite(end) || end === 0) return;
    const show = v => {
      if (el.dataset.fmt === 'int') { el.textContent = String(Math.round(v)); return; }
      const t = money2.format(Math.abs(v));
      el.textContent = (v < 0 ? '−' : '') + (el.dataset.fmt === 'rm' ? 'RM ' : '') + t;
    };
    const start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      show(p < 1 ? end * eased : end);
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    };
    show(0);
    requestAnimationFrame(step);
  });
}
