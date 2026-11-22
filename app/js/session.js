// Sambungan Supabase, akaun yang login, syarikat dan outlet.
import { store } from './ui.js';

export const ROLE_NAME = { owner: 'Owner', admin: 'Admin', manager: 'Manager', staff: 'Staff' };
export const ALL_OUTLETS = 'all';

/* global SUPABASE_URL, SUPABASE_KEY, supabase */
export const sb = (typeof SUPABASE_URL === 'string' && typeof SUPABASE_KEY === 'string')
  ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      // Kunci pelayar (navigator.locks) boleh tersekat selepas log keluar/muat semula
      // pada sesetengah Chrome Android. App ini satu tab, jadi jalankan terus.
      auth: { lock: (_name, _timeout, fn) => fn() }
    })
  : null;

export const session = {
  user: null,       // { id, email }
  profile: null,    // { role, outlet_id }
  business: null,   // { id, name }
  outlets: [],      // [{ id, name, company_name, company_reg_no }] yang boleh diakses
  outletId: null,   // outlet dipilih, atau ALL_OUTLETS (owner sahaja)
  plan: null,       // pakej berkuat kuasa: 'free' | 'pro' | 'business' (dari current_plan())
  get role() { return this.profile?.role; },
  get isOwner() { return this.role === 'owner'; },
  // Admin = kuasa owner, tetapi untuk outlet sendiri sahaja (dikunci di database).
  get isAdminUp() { return this.role === 'owner' || this.role === 'admin'; },
  get isManagerUp() { return this.isAdminUp || this.role === 'manager'; }
};

const listeners = new Set();
export function onOutletChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setOutlet(id) {
  session.outletId = id;
  store.set('bp.outlet', id);
  listeners.forEach(fn => fn(id));
}

export function outletName(id = session.outletId) {
  if (id === ALL_OUTLETS) return 'All outlets';
  return session.outlets.find(o => o.id === id)?.name || '';
}

// Syarikat berdaftar bagi outlet (setiap outlet boleh ada syarikat sendiri).
export function outletCompany(id) {
  const o = session.outlets.find(x => x.id === id);
  return { name: o?.company_name?.trim() || session.business?.name || 'BizProfit Pro', regNo: o?.company_reg_no?.trim() || '' };
}

// Muat profil, syarikat dan outlet. Pulangkan mesej ralat, atau null jika berjaya.
export async function loadAccount(user) {
  session.user = user;
  const { data: p, error: pe } = await sb.from('staff_profiles')
    .select('role,outlet_id').eq('user_id', user.id).maybeSingle();
  if (pe) return 'Could not load profile. Check your internet and try again.';
  if (!p) return 'This account is not assigned to any outlet. Contact the owner.';
  session.profile = p;

  const [{ data: biz }, { data: outlets, error: oe }] = await Promise.all([
    sb.from('businesses').select('*').maybeSingle(),   // '*' supaya tak gagal sebelum kolum pakej wujud
    sb.from('outlets').select('id,name,company_name,company_reg_no').order('name')
  ]);
  if (oe) return 'Could not load the outlet list.';
  session.business = biz || null;
  // Pakej berkuat kuasa. Jika fungsi belum wujud (migration Fasa 12 belum dijalankan), jangan kunci apa-apa.
  const { data: plan, error: planErr } = await sb.rpc('current_plan');
  session.plan = !planErr && ['free', 'pro', 'business'].includes(plan) ? plan : 'business';
  session.outlets = session.isOwner ? (outlets || []) : (outlets || []).filter(o => o.id === p.outlet_id);
  if (!session.outlets.length) return 'No outlets available for this account.';

  const saved = store.get('bp.outlet');
  const valid = id => id && (session.outlets.some(o => o.id === id) || (session.isOwner && id === ALL_OUTLETS));
  session.outletId = valid(saved) ? saved
    : session.isOwner && session.outlets.length > 1 ? ALL_OUTLETS
    : (session.outlets.find(o => o.id === p.outlet_id) || session.outlets[0]).id;
  return null;
}

export function clearSession() {
  Object.assign(session, { user: null, profile: null, business: null, outlets: [], outletId: null, plan: null });
}
