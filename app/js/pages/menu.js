// Akaun: maklumat, tukar kata laluan, pautan sementara, log keluar.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ROLE_NAME } from '../session.js';
import { isInstalled, canPromptInstall, promptInstall, isIOS } from '../pwa.js';
import { planName, trialDaysLeft, isPro, proTag } from '../plan.js';

export default {
  render(view) {
    const ownOutlet = session.outlets.find(o => o.id === session.profile.outlet_id)?.name || '-';
    view.innerHTML = `
      <section class="card">
        <dl class="info-grid">
          <dt>Email</dt><dd>${esc(session.user.email)}</dd>
          <dt>Role</dt><dd>${esc(ROLE_NAME[session.role] || session.role)}</dd>
          <dt>Outlet</dt><dd>${esc(session.isOwner ? 'All outlets' : ownOutlet)}</dd>
          <dt>Company</dt><dd>${esc(session.business?.name || '-')}</dd>
        </dl>
      </section>

      ${session.isAdminUp ? `
      <div class="list" id="coList">
        ${session.outlets.map(o => `<button class="row-btn" type="button" data-outlet="${esc(o.id)}">${icon('store')}<span>${esc(o.name)}<small>${esc(o.company_name ? o.company_name + (o.company_reg_no ? ' · ' + o.company_reg_no : '') : 'Not set')}</small></span>${icon('chev-right')}</button>`).join('')}
      </div>` : ''}

      <div class="list"><a class="row-btn" href="#/pakej">${icon('layers')}<span>Plan: ${esc(planName())}<small>${trialDaysLeft() ? `Pro trial · ${trialDaysLeft()} days left` : 'Compare plans and upgrade'}</small></span>${icon('chev-right')}</a></div>

      ${session.isAdminUp ? `<div class="list"><a class="row-btn" href="#/pnl">${icon('receipt')}<span>Profit &amp; Loss statement ${isPro() ? '' : proTag()}<small>Yearly statement per business, laid out like LHDN Form B</small></span>${icon('chev-right')}</a><a class="row-btn" href="#/foodcost">${icon('cart')}<span>Food Cost ${isPro() ? '' : proTag()}<small>Cost per plate, menu margins and food cost %</small></span>${icon('chev-right')}</a></div>` : ''}

      <div class="list">
        ${isInstalled() ? '' : `<button class="row-btn" type="button" id="installBtn">${icon('download')}<span>Install app<small>Add BizProfit Pro to your phone home screen</small></span></button>`}
        <button class="row-btn" type="button" id="pwBtn">${icon('lock')}<span>Change password</span></button>
      </div>

      <div class="list">
        <button class="row-btn danger" type="button" id="logoutBtn">${icon('logout')}<span>Log out</span></button>
      </div>

      <dialog id="installDialog">
        <div class="stack">
          <h2>Install app</h2>
          <p class="note" id="installSteps"></p>
          <div class="dialog-actions"><button class="btn primary" type="button" id="installClose">Got it</button></div>
        </div>
      </dialog>

      <dialog id="coDialog">
        <form id="coForm" class="stack" novalidate>
          <h2>Outlet company</h2>
          <p class="note" id="coOutlet"></p>
          <label class="field">Company name<input id="coName" maxlength="120" placeholder="e.g. Lubok Sarapan Enterprise"></label>
          <label class="field">Registration no. (SSM) <small>optional</small><input id="coReg" maxlength="60" placeholder="e.g. 202301012345 (1234567-X)"></label>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="coCancel">Cancel</button>
            <button class="btn primary" id="coSave">Save</button>
          </div>
        </form>
      </dialog>

      <dialog id="pwDialog">
        <form id="pwForm" class="stack" novalidate>
          <h2>Change password</h2>
          <label class="field">New password<input id="pwNew" type="password" autocomplete="new-password" placeholder="At least 10 characters"></label>
          <label class="field">Confirm password<input id="pwConfirm" type="password" autocomplete="new-password"></label>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="pwCancel">Cancel</button>
            <button class="btn primary" id="pwSave">Save</button>
          </div>
        </form>
      </dialog>`;

    if ($('installBtn')) $('installBtn').onclick = async () => {
      if (canPromptInstall()) {
        const r = await promptInstall();
        if (r === 'accepted') toast('BizProfit Pro is being installed on your home screen.');
        return;
      }
      $('installSteps').innerHTML = isIOS()
        ? 'On iPhone (Safari): tap the <b>Share</b> button (square with an up arrow), then <b>Add to Home Screen</b>.'
        : 'In Chrome: tap <b>⋮</b> at the top right, then <b>Install app</b> or <b>Add to Home screen</b>.';
      $('installDialog').showModal();
    };
    $('installClose').onclick = () => $('installDialog').close();
    $('pwBtn').onclick = () => { $('pwForm').reset(); $('pwDialog').showModal(); };
    $('pwCancel').onclick = () => $('pwDialog').close();
    $('pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('pwNew').value;
      if (pw.length < 10) { toast('New password must be at least 10 characters.', 'error'); return; }
      if (pw !== $('pwConfirm').value) { toast('The two passwords do not match.', 'error'); return; }
      $('pwSave').disabled = true;
      const { error } = await sb.auth.updateUser({ password: pw });
      $('pwSave').disabled = false;
      if (error) {
        toast(error.code === 'same_password' ? 'New password must be different from the old one.'
          : error.code === 'weak_password' ? 'Password too weak. Mix uppercase, lowercase and numbers.'
          : 'Password not changed: ' + error.message, 'error');
        return;
      }
      $('pwDialog').close();
      toast('Password changed.');
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
        if (error || !data?.length) { toast('Save failed: ' + (error?.message || 'no access.'), 'error'); return; }
        Object.assign(editing, payload);
        $('coDialog').close();
        toast('Outlet company updated.');
        this.render(view);
      });
    }

    $('logoutBtn').onclick = () => window.dispatchEvent(new Event('bp:logout'));
  }
};
