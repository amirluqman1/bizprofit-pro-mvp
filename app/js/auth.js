// Skrin sebelum masuk app: log masuk, daftar, lupa & set semula kata laluan,
// sediakan syarikat (pengguna baru), dan jemputan staf (?invite=TOKEN).
// Keselamatan sebenar di database (Fasa 15): role & syarikat ditetapkan oleh
// setup_business() / accept_invite(), bukan oleh borang ini.
import { $, esc, toast, store } from './ui.js';
import { sb, loadAccount, NO_PROFILE } from './session.js';
import { t } from './i18n.js';

const APP_URL = location.origin + location.pathname;
const INV_KEY = 'bp.invite';
const MIN_PW = 10;
let onReady = () => {};
let invite = null;        // { token, business, outlet, role, valid }

// ---------- Token jemputan: dari URL, disimpan supaya kekal selepas sahkan e-mel ----------
function takeInviteFromUrl() {
  const p = new URLSearchParams(location.search);
  const tok = p.get('invite');
  if (tok && /^[0-9a-f]{20,100}$/.test(tok)) {
    try { sessionStorage.setItem(INV_KEY, tok); } catch { store.set(INV_KEY, tok); }
    p.delete('invite');
    const q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  }
}
const inviteToken = () => { try { return sessionStorage.getItem(INV_KEY) || store.get(INV_KEY); } catch { return store.get(INV_KEY); } };
const clearInvite = () => { try { sessionStorage.removeItem(INV_KEY); } catch { /* abaikan */ } store.set(INV_KEY, ''); invite = null; };

async function loadInvite() {
  const tok = inviteToken();
  if (!tok) { invite = null; return; }
  const { data } = await sb.rpc('invite_info', { p_token: tok });
  const row = data?.[0];
  invite = row ? { token: tok, ...row } : { token: tok, valid: false };
}

const ROLE = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };
const inviteBanner = () => (!invite ? ''
  : invite.valid
    ? `<div class="auth-invite"><b>${esc(t('You are invited'))}</b><span>${esc(t('{co} · {outlet} as {role}', { co: invite.business, outlet: invite.outlet, role: t(ROLE[invite.role] || invite.role) }))}</span></div>`
    : `<div class="auth-invite bad"><b>${esc(t('This invite link is no longer valid'))}</b><span>${esc(t('It may have been used or expired. Ask for a new link.'))}</span></div>`);

// ---------- Paparan ----------
const field = (id, label, type = 'text', extra = '') => `<label class="field">${esc(t(label))}<input id="${id}" type="${type}" ${extra}></label>`;
const link = (to, label) => `<button class="link-btn" type="button" data-to="${to}">${esc(t(label))}</button>`;

const VIEWS = {
  login: () => `
    <form id="authForm" class="card stack" novalidate data-act="login">
      ${inviteBanner()}
      <h1>${esc(t('Log in'))}</h1>
      ${field('aEmail', 'Email', 'email', 'autocomplete="username" required')}
      ${field('aPw', 'Password', 'password', 'autocomplete="current-password" required')}
      <button class="btn primary block" id="aBtn">${esc(t('Log in'))}</button>
      <div class="auth-links">${link('forgot', 'Forgot password?')}${link('signup', invite?.valid ? 'New here? Create an account' : 'New business? Sign up free')}</div>
    </form>`,
  signup: () => `
    <form id="authForm" class="card stack" novalidate data-act="signup">
      ${inviteBanner()}
      <h1>${esc(t(invite?.valid ? 'Create your account' : 'Sign up free'))}</h1>
      ${invite?.valid ? '' : `<p class="hint left">${esc(t('30-day Pro trial. No card needed. Free plan after that, forever.'))}</p>
        ${field('aBiz', 'Business name', 'text', `maxlength="120" placeholder="${esc(t('e.g. Warung Selera Kampung'))}"`)}
        ${field('aOutlet', 'First outlet name', 'text', `maxlength="80" placeholder="${esc(t('e.g. Outlet Bangi'))}"`)}`}
      ${field('aEmail', 'Email', 'email', 'autocomplete="email" required')}
      ${field('aPw', 'Password', 'password', `autocomplete="new-password" placeholder="${esc(t('At least 10 characters'))}"`)}
      ${field('aPw2', 'Confirm password', 'password', 'autocomplete="new-password"')}
      <button class="btn primary block" id="aBtn">${esc(t(invite?.valid ? 'Create account & join' : 'Create account'))}</button>
      <div class="auth-links">${link('login', 'Already have an account? Log in')}</div>
    </form>`,
  forgot: () => `
    <form id="authForm" class="card stack" novalidate data-act="forgot">
      <h1>${esc(t('Reset password'))}</h1>
      <p class="hint left">${esc(t('Enter your email. We will send a link to set a new password.'))}</p>
      ${field('aEmail', 'Email', 'email', 'autocomplete="email" required')}
      <button class="btn primary block" id="aBtn">${esc(t('Send link'))}</button>
      <div class="auth-links">${link('login', 'Back to log in')}</div>
    </form>`,
  reset: () => `
    <form id="authForm" class="card stack" novalidate data-act="reset">
      <h1>${esc(t('Set a new password'))}</h1>
      ${field('aPw', 'New password', 'password', `autocomplete="new-password" placeholder="${esc(t('At least 10 characters'))}"`)}
      ${field('aPw2', 'Confirm password', 'password', 'autocomplete="new-password"')}
      <button class="btn primary block" id="aBtn">${esc(t('Save password'))}</button>
    </form>`,
  setup: (pre = {}) => `
    <form id="authForm" class="card stack" novalidate data-act="setup">
      <h1>${esc(t('Set up your business'))}</h1>
      <p class="hint left">${esc(t('One last step. You will be the owner, with a 30-day Pro trial.'))}</p>
      ${field('aBiz', 'Business name', 'text', `maxlength="120" value="${esc(pre.business || '')}"`)}
      ${field('aOutlet', 'First outlet name', 'text', `maxlength="80" value="${esc(pre.outlet || '')}"`)}
      <button class="btn primary block" id="aBtn">${esc(t('Start using BizProfit'))}</button>
      <div class="auth-links">${link('logout', 'Use a different account')}</div>
    </form>`,
  sent: (msg) => `
    <div class="card stack">
      <h1>${esc(t('Check your email'))}</h1>
      <p class="hint left">${esc(msg)}</p>
      <div class="auth-links">${link('login', 'Back to log in')}</div>
    </div>`
};

let current = 'login';
export function showAuth(view = 'login', arg, message) {
  current = view;
  $('boot').hidden = true;
  $('app').hidden = true;
  $('login').hidden = false;
  $('authBox').innerHTML = VIEWS[view](arg);
  if (message) toast(message, 'error');
  const first = $('authBox').querySelector('input');
  if (first && view !== 'login') first.focus();
}

// ---------- Selepas ada sesi: jemputan / sediakan syarikat / masuk app ----------
export async function afterAuth(user) {
  let r = await loadAccount(user);
  if (r === NO_PROFILE) {
    const tok = inviteToken();
    if (tok) {
      const { data: co, error } = await sb.rpc('accept_invite', { p_token: tok });
      clearInvite();
      if (error) {
        const meta = user.user_metadata || {};
        showAuth('setup', { business: meta.business_name, outlet: meta.outlet_name }, error.message);
        return;
      }
      toast(t('Welcome to {co}!', { co }));
      r = await loadAccount(user);
    } else {
      const meta = user.user_metadata || {};
      showAuth('setup', { business: meta.business_name, outlet: meta.outlet_name });
      return;
    }
  }
  if (r) { await sb.auth.signOut({ scope: 'local' }); showAuth('login', undefined, r); return; }
  await onReady();
}

const pwProblem = (pw, pw2) => (pw.length < MIN_PW ? t('New password must be at least 10 characters.')
  : pw !== pw2 ? t('The two passwords do not match.') : '');

async function submit(form) {
  const act = form.dataset.act;
  const btn = $('aBtn');
  const v = id => ($(id)?.value || '').trim();
  btn.disabled = true;
  try {
    if (act === 'login') {
      if (!v('aEmail') || !$('aPw').value) { toast(t('Enter your email and password.'), 'error'); return; }
      const { data, error } = await sb.auth.signInWithPassword({ email: v('aEmail'), password: $('aPw').value });
      if (error) {
        toast(/confirm/i.test(error.message) ? t('Please confirm your email first. Check your inbox.') : t('Wrong email or password.'), 'error');
        return;
      }
      await afterAuth(data.user);
    } else if (act === 'signup') {
      const joining = invite?.valid;
      if (!joining && (!v('aBiz') || !v('aOutlet'))) { toast(t('Enter the business and outlet name.'), 'error'); return; }
      if (!v('aEmail')) { toast(t('Enter your email and password.'), 'error'); return; }
      const bad = pwProblem($('aPw').value, $('aPw2').value);
      if (bad) { toast(bad, 'error'); return; }
      const redirect = APP_URL + (joining ? '?invite=' + invite.token : '');
      const { data, error } = await sb.auth.signUp({
        email: v('aEmail'), password: $('aPw').value,
        options: { emailRedirectTo: redirect, data: joining ? {} : { business_name: v('aBiz'), outlet_name: v('aOutlet') } }
      });
      if (error) {
        toast(/registered|exists/i.test(error.message) ? t('This email already has an account. Log in instead.') : t('Sign up failed: ') + error.message, 'error');
        return;
      }
      // E-mel pengesahan diwajibkan: tiada sesi sehingga pautan ditekan.
      if (!data.session) { showAuth('sent', t('We sent a confirmation link to {email}. Open it on this phone to continue.', { email: v('aEmail') })); return; }
      await afterAuth(data.user);
    } else if (act === 'forgot') {
      if (!v('aEmail')) { toast(t('Enter your email.'), 'error'); return; }
      const { error } = await sb.auth.resetPasswordForEmail(v('aEmail'), { redirectTo: APP_URL });
      if (error) { toast(t('Could not send the link: ') + error.message, 'error'); return; }
      showAuth('sent', t('If {email} has an account, a link to set a new password is on its way. Open it on this phone.', { email: v('aEmail') }));
    } else if (act === 'reset') {
      const bad = pwProblem($('aPw').value, $('aPw2').value);
      if (bad) { toast(bad, 'error'); return; }
      const { data, error } = await sb.auth.updateUser({ password: $('aPw').value });
      if (error) { toast(t('Password not changed: ') + error.message, 'error'); return; }
      toast(t('Password changed.'));
      await afterAuth(data.user);
    } else if (act === 'setup') {
      if (!v('aBiz') || !v('aOutlet')) { toast(t('Enter the business and outlet name.'), 'error'); return; }
      const { error } = await sb.rpc('setup_business', { p_business: v('aBiz'), p_outlet: v('aOutlet') });
      if (error) { toast(t('Could not set up the business: ') + error.message, 'error'); return; }
      const { data: { user } } = await sb.auth.getUser();
      toast(t('Your business is ready. Enjoy the 30-day Pro trial!'));
      await afterAuth(user);
    }
  } finally {
    if (btn.isConnected) btn.disabled = false;
  }
}

export async function initAuth({ ready }) {
  onReady = ready;
  takeInviteFromUrl();
  $('authBox').addEventListener('submit', e => { e.preventDefault(); submit(e.target); });
  $('authBox').addEventListener('click', async e => {
    const b = e.target.closest('[data-to]');
    if (!b) return;
    if (b.dataset.to === 'logout') { await sb.auth.signOut({ scope: 'local' }); showAuth('login'); return; }
    showAuth(b.dataset.to);
  });
  window.addEventListener('bp:lang', () => { if (!$('login').hidden && current !== 'sent') showAuth(current); });
  await loadInvite();
  return invite;
}
