// Kad "akan datang" untuk halaman yang belum dibina.
import { esc, icon } from '../ui.js';

export function placeholder(view, { iconName, title, text, link }) {
  view.innerHTML = `<section class="card placeholder">
    ${icon(iconName)}
    <h2>${esc(title)}</h2>
    <p>${esc(text)}</p>
    ${link ? `<a class="btn primary" href="${esc(link.href)}">${esc(link.label)}</a>` : ''}
  </section>`;
}
