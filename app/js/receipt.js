// Gambar resit pada transaksi (ciri Pro).
// Gambar dikecilkan dalam phone dahulu (sasaran ~60–80KB, maks 100KB) supaya cepat
// dimuat naik dan kos storage rendah. Tulisan resit masih jelas pada 1200px. Disimpan dalam bucket peribadi "receipts":
// <business_id>/<outlet_id>/<uuid>.jpg. Akses dikawal oleh database (Fasa 13).
import { esc, icon, toast } from './ui.js';
import { sb, session } from './session.js';

const BUCKET = 'receipts';
// Cuba dari kualiti terbaik; berhenti bila saiz ≤ TARGET. Langkah terakhir diguna walau apa pun.
const STEPS = [[1200, 0.6], [1200, 0.5], [1000, 0.5], [1000, 0.42], [850, 0.42]];
const TARGET = 100 * 1024;

// Kecilkan gambar → Blob JPEG.
export async function compressImage(file) {
  if (!file || !file.type.startsWith('image/')) throw new Error('Choose a photo (JPG or PNG).');
  let src, w, h;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = src.width; h = src.height;
  } catch {
    src = await new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error('This photo could not be opened. Try another one.'));
      img.src = URL.createObjectURL(file);
    });
    w = src.naturalWidth; h = src.naturalHeight;
  }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let blob = null, side = 0;
  try {
    for (const [maxSide, q] of STEPS) {
      if (maxSide !== side) {
        side = maxSide;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // PNG lutsinar → latar putih
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      }
      blob = await new Promise(ok => canvas.toBlob(ok, 'image/jpeg', q));
      if (!blob || blob.size <= TARGET) break;
    }
  } finally { if (src.close) src.close(); }
  if (!blob) throw new Error('This photo could not be processed. Try another one.');
  return blob;
}

// Muat naik, pulangkan laluan fail.
export async function uploadReceipt(blob, outletId) {
  const id = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  const path = `${session.business.id}/${outletId}/${id}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error('Receipt photo not uploaded: ' + error.message);
  return path;
}

// Buang fail yang tak jadi dipautkan (contoh simpan transaksi gagal). Senyap jika gagal.
export async function discardReceipt(path) {
  if (path) await sb.storage.from(BUCKET).remove([path]).catch(() => {});
}

// Pemilih gambar dengan pratonton. Pulangkan { get(): Blob|null, reset() }.
export function bindPicker(input, preview, img, removeBtn, label) {
  let blob = null, url = null;
  const show = () => {
    if (url) URL.revokeObjectURL(url);
    url = blob ? URL.createObjectURL(blob) : null;
    preview.hidden = !blob;
    if (label) label.hidden = !!blob;
    if (url) img.src = url; else img.removeAttribute('src');
  };
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    try { blob = await compressImage(file); show(); }
    catch (e) { toast(e.message, 'error'); }
  });
  removeBtn.addEventListener('click', () => { blob = null; show(); });
  return { get: () => blob, reset: () => { blob = null; show(); } };
}

// Lihat resit dalam dialog (pautan sementara 10 minit).
export async function viewReceipt(path) {
  let dlg = document.getElementById('rcDialog');
  if (!dlg) {
    document.body.insertAdjacentHTML('beforeend', `<dialog id="rcDialog" class="rc-dialog">
      <div class="rc-body"><p class="greet-sub" id="rcStatus">Loading…</p><img id="rcImg" alt="Receipt photo" hidden></div>
      <div class="dialog-actions">
        <a class="btn ghost" id="rcOpen" target="_blank" rel="noopener" hidden>Open full size</a>
        <button class="btn primary" type="button" id="rcClose">Close</button>
      </div></dialog>`);
    dlg = document.getElementById('rcDialog');
    document.getElementById('rcClose').onclick = () => dlg.close();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }
  const img = document.getElementById('rcImg'), st = document.getElementById('rcStatus'), open = document.getElementById('rcOpen');
  img.hidden = true; open.hidden = true; st.hidden = false; st.textContent = 'Loading…';
  dlg.showModal();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !data?.signedUrl) { st.textContent = 'Could not load the receipt photo. You may not have access to it.'; return; }
  img.onload = () => { st.hidden = true; img.hidden = false; };
  img.onerror = () => { st.textContent = 'Could not load the receipt photo.'; };
  img.src = data.signedUrl;
  open.href = data.signedUrl; open.hidden = false;
}

// Butang kecil 📷 pada baris transaksi.
export const receiptBtn = path => path
  ? `<button type="button" class="tx-receipt" data-receipt="${esc(path)}" aria-label="View receipt photo" title="View receipt photo">${icon('camera')}</button>`
  : '';
