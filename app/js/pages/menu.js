// Akaun: maklumat, tukar kata laluan, pautan sementara, log keluar.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ROLE_NAME } from '../session.js';
import { isInstalled, canPromptInstall, promptInstall, isIOS } from '../pwa.js';

export default {
  subtitle: 'Akaun dan tetapan.',
  render(view) {
    const ownOutlet = session.outlets.find(o => o.id === session.profile.outlet_id)?.name || '-';
    view.innerHTML = `
      <section class="card">
        <dl class="info-grid">
          <dt>Emel</dt><dd>${esc(session.user.email)}</dd>
          <dt>Peranan</dt><dd>${esc(ROLE_NAME[session.role] || session.role)}</dd>
          <dt>Outlet</dt><dd>${esc(session.isOwner ? 'Semua outlet' : ownOutlet)}</dd>
          <dt>Syarikat</dt><dd>${esc(session.business?.name || '-')}</dd>
        </dl>
      </section>

      ${session.isOwner ? `
      <h2 class="section-title">Syarikat ikut outlet</h2>
      <p class="note">Nama ini keluar di kepala slip gaji pekerja outlet tersebut. Kosong = guna "${esc(session.business?.name || '-')}".</p>
      <div class="list" id="coList">
        ${session.outlets.map(o => `<button class="row-btn" type="button" data-outlet="${esc(o.id)}">${icon('store')}<span>${esc(o.name)}<small>${esc(o.company_name ? o.company_name + (o.company_reg_no ? ' · ' + o.company_reg_no : '') : 'Belum diisi')}</small></span>${icon('chev-right')}</button>`).join('')}
      </div>` : ''}

      <div class="list">
        ${isInstalled() ? '' : `<button class="row-btn" type="button" id="installBtn">${icon('download')}<span>Pasang app<small>Letak BizProfit Pro di skrin utama phone</small></span></button>`}
        <button class="row-btn" type="button" id="pwBtn">${icon('lock')}<span>Tukar kata laluan</span></button>
      </div>

      <div class="list">
        <button class="row-btn danger" type="button" id="logoutBtn">${icon('logout')}<span>Log keluar</span></button>
      </div>

      <dialog id="installDialog">
        <div class="stack">
          <h2>Pasang app</h2>
          <p class="note" id="installSteps"></p>
          <div class="dialog-actions"><button class="btn primary" type="button" id="installClose">Faham</button></div>
        </div>
      </dialog>

      <dialog id="coDialog">
        <form id="coForm" class="stack" novalidate>
          <h2>Syarikat outlet</h2>
          <p class="note" id="coOutlet"></p>
          <label class="field">Nama syarikat<input id="coName" maxlength="120" placeholder="cth: Lubok Sarapan Enterprise"></label>
          <label class="field">No. pendaftaran (SSM) <small>pilihan</small><input id="coReg" maxlength="60" placeholder="cth: 202301012345 (1234567-X)"></label>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="coCancel">Batal</button>
            <button class="btn primary" id="coSave">Simpan</button>
          </div>
        </form>
      </dialog>

      <dialog id="pwDialog">
        <form id="pwForm" class="stack" novalidate>
          <h2>Tukar kata laluan</h2>
          <label class="field">Kata laluan baru<input id="pwNew" type="password" autocomplete="new-password" placeholder="Minimum 10 aksara"></label>
          <label class="field">Sahkan kata laluan<input id="pwConfirm" type="password" autocomplete="new-password"></label>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="pwCancel">Batal</button>
            <button class="btn primary" id="pwSave">Simpan</button>
          </div>
        </form>
      </dialog>`;

    if ($('installBtn')) $('installBtn').onclick = async () => {
      if (canPromptInstall()) {
        const r = await promptInstall();
        if (r === 'accepted') toast('BizProfit Pro sedang dipasang di skrin utama.');
        return;
      }
      $('installSteps').innerHTML = isIOS()
        ? 'Di iPhone (Safari): tekan butang <b>Kongsi</b> (petak dengan anak panah ke atas), kemudian <b>Tambah ke Skrin Utama</b>.'
        : 'Di Chrome: tekan <b>⋮</b> di atas kanan, kemudian <b>Pasang app</b> atau <b>Tambah ke skrin utama</b>.';
      $('installDialog').showModal();
    };
    $('installClose').onclick = () => $('installDialog').close();
    $('pwBtn').onclick = () => { $('pwForm').reset(); $('pwDialog').showModal(); };
    $('pwCancel').onclick = () => $('pwDialog').close();
    $('pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('pwNew').value;
      if (pw.length < 10) { toast('Kata laluan baru mesti 10 aksara atau lebih.', 'error'); return; }
      if (pw !== $('pwConfirm').value) { toast('Dua kata laluan tak sama.', 'error'); return; }
      $('pwSave').disabled = true;
      const { error } = await sb.auth.updateUser({ password: pw });
      $('pwSave').disabled = false;
      if (error) {
        toast(error.code === 'same_password' ? 'Kata laluan baru mesti lain daripada yang lama.'
          : error.code === 'weak_password' ? 'Kata laluan terlalu lemah. Campur huruf besar, kecil dan nombor.'
          : 'Kata laluan tak ditukar: ' + error.message, 'error');
        return;
      }
      $('pwDialog').close();
      toast('Kata laluan ditukar.');
    });

    if ($('coList')) {
      let editing = null;
      $('coList').onclick = e => {
        const b = e.target.closest('[data-outlet]');
        if (!b) return;
        editing = session.outlets.find(o => o.id === b.dataset.outlet);
        $('coOutlet').textContent = 'Outlet: ' + editing.name;
        $('coName').value = editing.company_name || '';
        $('coReg').value = editing.company_reg_no || '';
        $('coDialog').showModal();
      };
      $('coCancel').onclick = () => $('coDialog').close();
      $('coForm').addEventListener('submit', async e => {
        e.preventDefault();
        const payload = { company_name: $('coName').value.trim() || null, company_reg_no: $('coReg').value.trim() || null };
        $('coSave').disabled = true;
        const { data, error } = await sb.from('outlets').update(payload).eq('id', editing.id).select('id');
        $('coSave').disabled = false;
        if (error || !data?.length) { toast('Gagal simpan: ' + (error?.message || 'tiada akses.'), 'error'); return; }
        Object.assign(editing, payload);
        $('coDialog').close();
        toast('Syarikat outlet dikemas kini.');
        this.render(view);
      });
    }

    $('logoutBtn').onclick = () => window.dispatchEvent(new Event('bp:logout'));
  }
};
