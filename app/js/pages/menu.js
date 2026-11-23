// Akaun: maklumat, tukar kata laluan, pautan sementara, log keluar.
import { $, esc, icon, toast } from '../ui.js';
import { sb, session, ROLE_NAME } from '../session.js';
import { isInstalled, canPromptInstall, promptInstall, isIOS } from '../pwa.js';
import { planName, trialDaysLeft, isPro, proTag, PLANS, planKey } from '../plan.js';
import { t, getLang, setLang } from '../i18n.js';
import { membersHTML, bindMembers } from '../members.js';

export default {
  render(view) {
    const ownOutlet = session.outlets.find(o => o.id === session.profile.outlet_id)?.name || '-';
    view.innerHTML = `
      <section class="card">
        <dl class="info-grid">
          <dt>${t('Email')}</dt><dd>${esc(session.user.email)}</dd>
          <dt>${t('Role')}</dt><dd>${esc(t(ROLE_NAME[session.role] || session.role))}</dd>
          <dt>${t('Outlet')}</dt><dd>${esc(session.isOwner ? t('All outlets') : ownOutlet)}</dd>
          <dt>${t('Company')}</dt><dd>${esc(session.business?.name || '-')}</dd>
        </dl>
      </section>

      ${session.isAdminUp ? `
      <div class="list" id="coList">
        ${session.outlets.map(o => `<button class="row-btn" type="button" data-outlet="${esc(o.id)}">${icon('store')}<span>${esc(o.name)}<small>${esc(o.company_name ? o.company_name + (o.company_reg_no ? ' · ' + o.company_reg_no : '') : t('Not set'))}</small></span>${icon('chev-right')}</button>`).join('')}
        ${session.isOwner ? `<button class="row-btn add-outlet" type="button" id="olAdd">${icon('plus-box')}<span>${t('+ Add outlet')}<small>${t('{n} of {max} outlets on the {plan} plan', { n: session.outlets.length, max: PLANS[planKey()].outlets, plan: planName() })}</small></span></button>` : ''}
      </div>` : ''}

      ${membersHTML()}

      <div class="list"><a class="row-btn" href="#/pakej">${icon('layers')}<span>${t('Plan')}: ${esc(planName())}<small>${trialDaysLeft() ? t('Pro trial · {n} days left', { n: trialDaysLeft() }) : t('Compare plans and upgrade')}</small></span>${icon('chev-right')}</a></div>

      ${session.isAdminUp ? `<div class="list"><a class="row-btn" href="#/pnl">${icon('receipt')}<span>${t('Profit &amp; Loss statement')} ${isPro() ? '' : proTag()}<small>${t('Yearly statement per business, laid out like LHDN Form B')}</small></span>${icon('chev-right')}</a><a class="row-btn" href="#/foodcost">${icon('cart')}<span>${t('Food Cost')} ${isPro() ? '' : proTag()}<small>${t('Cost per plate, menu margins and food cost %')}</small></span>${icon('chev-right')}</a></div>` : ''}

      <div class="list">
        ${isInstalled() ? '' : `<button class="row-btn" type="button" id="installBtn">${icon('download')}<span>${t('Install app')}<small>${t('Add BizProfit Pro to your phone home screen')}</small></span></button>`}
        <div class="row-btn lang-row">${icon('link')}<span>${t('Language')}<small>${t('Bahasa Melayu or English')}</small></span>
          <div class="seg lang-seg" role="group" aria-label="${t('Language')}"><button type="button" class="seg-opt ${getLang() === 'ms' ? 'on' : ''}" data-lang="ms" aria-pressed="${getLang() === 'ms'}">BM</button><button type="button" class="seg-opt ${getLang() === 'en' ? 'on' : ''}" data-lang="en" aria-pressed="${getLang() === 'en'}">EN</button></div></div>
        <button class="row-btn" type="button" id="pwBtn">${icon('lock')}<span>${t('Change password')}</span></button>
      </div>

      <div class="list">
        <button class="row-btn danger" type="button" id="logoutBtn">${icon('logout')}<span>${t('Log out')}</span></button>
      </div>

      <dialog id="installDialog">
        <div class="stack">
          <h2>${t('Install app')}</h2>
          <p class="note" id="installSteps"></p>
          <div class="dialog-actions"><button class="btn primary" type="button" id="installClose">${t('Got it')}</button></div>
        </div>
      </dialog>

      <dialog id="olDialog">
        <form id="olForm" class="stack" novalidate>
          <h2>${t('Add outlet')}</h2>
          <label class="field">${t('Outlet name')}<input id="olName" maxlength="80" autocomplete="off" placeholder="${t('e.g. Outlet Bangi')}"></label>
          <label class="field">${t('Company name')} <small>${t('optional')}</small><input id="olCo" maxlength="120"></label>
          <label class="field">${t('Registration no. (SSM)')} <small>${t('optional')}</small><input id="olReg" maxlength="60"></label>
          <p class="note">${t('Staff accounts for this outlet are still added by BizProfit for now.')}</p>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="olCancel">${t('Cancel')}</button>
            <button class="btn primary" id="olSave">${t('Save')}</button>
          </div>
        </form>
      </dialog>

      <dialog id="coDialog">
        <form id="coForm" class="stack" novalidate>
          <h2>${t('Outlet company')}</h2>
          <p class="note" id="coOutlet"></p>
          <label class="field">${t('Company name')}<input id="coName" maxlength="120" placeholder="${t('e.g. Lubok Sarapan Enterprise')}"></label>
          <label class="field">${t('Registration no. (SSM)')} <small>${t('optional')}</small><input id="coReg" maxlength="60" placeholder="${t('e.g. 202301012345 (1234567-X)')}"></label>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="coCancel">${t('Cancel')}</button>
            <button class="btn primary" id="coSave">${t('Save')}</button>
          </div>
        </form>
      </dialog>

      <dialog id="pwDialog">
        <form id="pwForm" class="stack" novalidate>
          <h2>${t('Change password')}</h2>
          <label class="field">${t('New password')}<input id="pwNew" type="password" autocomplete="new-password" placeholder="${t('At least 10 characters')}"></label>
          <label class="field">${t('Confirm password')}<input id="pwConfirm" type="password" autocomplete="new-password"></label>
          <div class="dialog-actions">
            <button class="btn ghost" type="button" id="pwCancel">${t('Cancel')}</button>
            <button class="btn primary" id="pwSave">${t('Save')}</button>
          </div>
        </form>
      </dialog>`;

    if ($('installBtn')) $('installBtn').onclick = async () => {
      if (canPromptInstall()) {
        const r = await promptInstall();
        if (r === 'accepted') toast(t('BizProfit Pro is being installed on your home screen.'));
        return;
      }
      $('installSteps').innerHTML = isIOS()
        ? t('On iPhone (Safari): tap the <b>Share</b> button (square with an up arrow), then <b>Add to Home Screen</b>.')
        : t('In Chrome: tap <b>⋮</b> at the top right, then <b>Install app</b> or <b>Add to Home screen</b>.');
      $('installDialog').showModal();
    };
    $('installClose').onclick = () => $('installDialog').close();
    $('pwBtn').onclick = () => { $('pwForm').reset(); $('pwDialog').showModal(); };
    $('pwCancel').onclick = () => $('pwDialog').close();
    $('pwForm').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = $('pwNew').value;
      if (pw.length < 10) { toast(t('New password must be at least 10 characters.'), 'error'); return; }
      if (pw !== $('pwConfirm').value) { toast(t('The two passwords do not match.'), 'error'); return; }
      $('pwSave').disabled = true;
      const { error } = await sb.auth.updateUser({ password: pw });
      $('pwSave').disabled = false;
      if (error) {
        toast(error.code === 'same_password' ? t('New password must be different from the old one.')
          : error.code === 'weak_password' ? t('Password too weak. Mix uppercase, lowercase and numbers.')
          : t('Password not changed: ') + error.message, 'error');
        return;
      }
      $('pwDialog').close();
      toast(t('Password changed.'));
    });

    if ($('olAdd')) {
      $('olAdd').onclick = () => {
        if (session.outlets.length >= PLANS[planKey()].outlets) {
          toast(t('Your {plan} plan allows {max} outlet(s). Upgrade to add more.', { plan: planName(), max: PLANS[planKey()].outlets }), 'error');
          location.hash = '#/pakej';
          return;
        }
        $('olForm').reset(); $('olDialog').showModal(); $('olName').focus();
      };
      $('olCancel').onclick = () => $('olDialog').close();
      $('olForm').addEventListener('submit', async e => {
        e.preventDefault();
        const name = $('olName').value.trim();
        if (!name) { toast(t('Enter the outlet name.'), 'error'); return; }
        $('olSave').disabled = true;
        const { data, error } = await sb.from('outlets')
          .insert({ name, company_name: $('olCo').value.trim() || null, company_reg_no: $('olReg').value.trim() || null })
          .select('id,name,company_name,company_reg_no').single();
        $('olSave').disabled = false;
        if (error) {
          toast(error.code === '23505' ? t('An outlet with this name already exists.')
            : /Had outlet/.test(error.message) ? t('Your {plan} plan allows {max} outlet(s). Upgrade to add more.', { plan: planName(), max: PLANS[planKey()].outlets })
            : t('Outlet not added: ') + error.message, 'error');
          return;
        }
        session.outlets.push(data);
        session.outlets.sort((a, b) => a.name.localeCompare(b.name, 'ms-MY'));
        $('olDialog').close();
        window.dispatchEvent(new Event('bp:outlets-changed'));
        toast(t('Outlet "{x}" added.', { x: data.name }));
        this.render(view);
      });
    }

    if ($('coList')) {
      let editing = null;
      $('coList').onclick = e => {
        const b = e.target.closest('[data-outlet]');
        if (!b) return;
        editing = session.outlets.find(o => o.id === b.dataset.outlet);
        $('coOutlet').textContent = t('Outlet') + ': ' + editing.name;
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
        if (error || !data?.length) { toast(t('Save failed: ') + (error?.message || t('no access.')), 'error'); return; }
        Object.assign(editing, payload);
        $('coDialog').close();
        toast(t('Outlet company updated.'));
        this.render(view);
      });
    }

    view.querySelectorAll('[data-lang]').forEach(b => { b.onclick = () => { if (b.dataset.lang !== getLang()) setLang(b.dataset.lang); }; });
    bindMembers(view);
    $('logoutBtn').onclick = () => window.dispatchEvent(new Event('bp:logout'));
  }
};
