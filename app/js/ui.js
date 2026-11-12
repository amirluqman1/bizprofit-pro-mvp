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
