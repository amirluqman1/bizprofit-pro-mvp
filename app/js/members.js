// Akaun pengguna (Menu): senarai ahli, jemput staf melalui pautan, batal jemputan, buang akses.
// Owner: semua outlet, boleh jemput admin/manager/staff. Admin: outlet sendiri, manager/staff.
// Semua sekatan dikuatkuasa di database (Fasa 17); UI hanya menyusun pilihan.
import { $, esc, icon, toast } from './ui.js';
import { sb, session, outletName } from './session.js';
import { t, locale } from './i18n.js';

const ROLE = { owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' };
const inviteUrl = tok => location.origin + location.pathname + '?invite=' + tok;
const roleOptions = () => (session.isOwner ? ['staff', 'manager', 'admin'] : ['staff', 'manager']);
const myOutlets = () => (session.isOwner ? session.outlets : session.outlets.filter(o => o.id === session.profile.outlet_id));
const shortDate = iso => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

export function membersHTML() {
  if (!session.isAdminUp) return '';
  return `
    <details class="card fold members" id="mbFold">
      <summary><span id="mbTitle">${t('User accounts')}</span><em class="fold-n" id="mbCount"></em></summary>
      <p class="note small">${t('Each person gets their own login. Share the invite link by WhatsApp; it works once and expires in 7 days.')}</p>
      <button class="btn ghost sm" id="mbInvite" type="button">${t('+ Invite staff')}</button>
      <div id="mbList" class="mb-list"><div class="skel"></div></div>
    </details>

    <dialog id="mbDialog">
      <form id="mbForm" class="stack" novalidate>
        <h2>${t('Invite staff')}</h2>
        <label class="field">${t('Name (for your reference)')}<input id="mbLabel" maxlength="80" placeholder="${t('e.g. Ali (cashier)')}"></label>
        <div class="two">
          <label class="field">${t('Role')}<select id="mbRole">${roleOptions().map(r => `<option value="${r}">${t(ROLE[r])}</option>`).join('')}</select></label>
          <label class="field">${t('Outlet')}<select id="mbOutlet">${myOutlets().map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select></label>
        </div>
        <p class="note small" id="mbRoleNote"></p>
        <div class="dialog-actions">
          <button class="btn ghost" type="button" data-close="mbDialog">${t('Cancel')}</button>
          <button class="btn primary" id="mbCreate">${t('Create invite link')}</button>
        </div>
      </form>
    </dialog>

    <dialog id="mbShare">
      <div class="stack">
        <h2>${t('Invite link ready')}</h2>
        <p class="note" id="mbShareInfo"></p>
        <input id="mbLink" readonly aria-label="${t('Invite link')}">
        <a class="btn primary block" id="mbWa" target="_blank" rel="noopener">${icon('link')}${t('Send by WhatsApp')}</a>
        <button class="btn ghost block" type="button" id="mbCopy">${t('Copy link')}</button>
        <div class="dialog-actions"><button class="btn ghost" type="button" data-close="mbShare">${t('Close')}</button></div>
      </div>
    </dialog>`;
}

const ROLE_NOTE = {
  staff: 'Staff: key in transactions (sees only their own today) and update stock.',
  manager: 'Manager: staff access plus Home, reports and staff attendance for the outlet.',
  admin: 'Admin: full control of one outlet, including payroll, food cost and editing records.'
};

async function load() {
  const [m, inv] = await Promise.all([
    sb.rpc('list_members'),
    sb.from('staff_invites').select('id,token,role,outlet_id,label,created_at,expires_at')
      .is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false })
  ]);
  if (m.error) { $('mbList').innerHTML = `<p class="note">${t('Could not load user accounts.')}</p>`; return; }
  const me = session.user.id;
  const canRemove = x => x.user_id !== me && x.role !== 'owner' && (session.isOwner || x.role !== 'admin');
  const members = (m.data || []).map(x => `<div class="mb-row">
      <span class="mb-ic">${icon('user')}</span>
      <div class="mb-main"><b>${esc(x.email)}${x.user_id === me ? ` <i class="tag">${t('You')}</i>` : ''}</b>
        <small>${esc(t(ROLE[x.role] || x.role))} · ${esc(outletName(x.outlet_id))}${x.last_sign_in_at ? ' · ' + esc(t('last login {d}', { d: shortDate(x.last_sign_in_at) })) : ''}</small></div>
      ${canRemove(x) ? `<button class="btn ghost sm" type="button" data-remove="${esc(x.user_id)}" data-email="${esc(x.email)}">${t('Remove')}</button>` : ''}
    </div>`).join('');
  const pending = (inv.data || []).map(x => `<div class="mb-row pending">
      <span class="mb-ic">${icon('link')}</span>
      <div class="mb-main"><b>${esc(x.label || t('Invite'))} <i class="tag">${t('Pending')}</i></b>
        <small>${esc(t(ROLE[x.role]))} · ${esc(outletName(x.outlet_id))} · ${esc(t('expires {d}', { d: shortDate(x.expires_at) }))}</small></div>
      <div class="mb-acts"><button class="btn ghost sm" type="button" data-share="${esc(x.token)}" data-role="${esc(x.role)}" data-outlet="${esc(x.outlet_id)}" data-label="${esc(x.label || '')}">${t('Share')}</button>
        <button class="btn ghost sm danger" type="button" data-cancel="${esc(x.id)}">${t('Cancel')}</button></div>
    </div>`).join('');
  $('mbList').innerHTML = members + pending;
  $('mbCount').textContent = (m.data || []).length;
}

function openShare(token, role, outletId, label) {
  const url = inviteUrl(token);
  const who = label ? label + ', ' : '';
  const msg = t('{who}you are invited to {co} on BizProfit Pro as {role} ({outlet}). Open this link to create your account: {url}',
    { who, co: session.business?.name || 'BizProfit Pro', role: t(ROLE[role]), outlet: outletName(outletId), url });
  $('mbShareInfo').textContent = t('{role} · {outlet}. The link works once and expires in 7 days.', { role: t(ROLE[role]), outlet: outletName(outletId) });
  $('mbLink').value = url;
  $('mbWa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
  $('mbCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(msg); toast(t('Invite message copied. Paste it in WhatsApp.')); }
    catch { $('mbLink').select(); toast(t('Copy failed. Try again.'), 'error'); }
  };
  $('mbShare').showModal();
}

export function bindMembers(view) {
  if (!session.isAdminUp) return;
  const syncNote = () => { $('mbRoleNote').textContent = t(ROLE_NOTE[$('mbRole').value]); };
  $('mbRole').onchange = syncNote;
  view.querySelectorAll('[data-close]').forEach(b => { if (b.closest('#mbDialog, #mbShare')) b.onclick = () => $(b.dataset.close).close(); });
  $('mbInvite').onclick = () => {
    $('mbForm').reset();
    if (session.outletId && myOutlets().some(o => o.id === session.outletId)) $('mbOutlet').value = session.outletId;
    syncNote(); $('mbDialog').showModal();
  };
  $('mbForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('mbCreate').disabled = true;
    const payload = { role: $('mbRole').value, outlet_id: $('mbOutlet').value, label: $('mbLabel').value.trim() || null };
    const { data, error } = await sb.from('staff_invites').insert(payload).select('token,role,outlet_id,label').single();
    $('mbCreate').disabled = false;
    if (error) { toast(t('Invite not created: ') + error.message, 'error'); return; }
    $('mbDialog').close();
    openShare(data.token, data.role, data.outlet_id, data.label);
    load();
  });
  $('mbList').addEventListener('click', async e => {
    const sh = e.target.closest('[data-share]');
    if (sh) { openShare(sh.dataset.share, sh.dataset.role, sh.dataset.outlet, sh.dataset.label); return; }
    const c = e.target.closest('[data-cancel]');
    if (c) {
      if (!confirm(t('Cancel this invite? The link will stop working.'))) return;
      const { error } = await sb.from('staff_invites').delete().eq('id', c.dataset.cancel);
      if (error) { toast(t('Not deleted: ') + error.message, 'error'); return; }
      toast(t('Invite cancelled.')); load(); return;
    }
    const r = e.target.closest('[data-remove]');
    if (r) {
      if (!confirm(t('Remove access for {x}? They will no longer be able to open this business. Their past records are kept.', { x: r.dataset.email }))) return;
      const { error } = await sb.rpc('remove_member', { p_user: r.dataset.remove });
      if (error) { toast(t('Could not remove: ') + error.message, 'error'); return; }
      toast(t('Access removed.')); load();
    }
  });
  load();
}
