// Pakej langganan (freemium). Sumber sebenar ialah database (fungsi current_plan()
// dan policy RLS, Fasa 12); fail ini hanya untuk paparan: kunci 🔒 dan butang naik taraf.
import { icon, esc } from './ui.js';
import { session } from './session.js';

export const PLANS = {
  free:     { name: 'Free',     price: 0,  outlets: 1,  staff: 2 },
  pro:      { name: 'Pro',      price: 15, outlets: 1,  staff: 10 },
  business: { name: 'Business', price: 80, outlets: 10, staff: null }   // null = tanpa had
};

// Senarai untuk jadual banding (true = ada, false = tiada, teks = had).
export const FEATURES = [
  ['Outlets', '1', '1', 'Up to 10'],
  ['Staff accounts (besides owner)', '2', '10', 'Unlimited'],
  ['Key In, Home, Stock & WhatsApp shopping list', true, true, true],
  ['Daily report', true, true, true],
  ['Weekly report', 'This week', true, true],
  ['Monthly & yearly report', false, true, true],
  ['Report & transaction history', '1 month', 'Unlimited', 'Unlimited'],
  ['Staff attendance', true, true, true],
  ['Audit log (owner & admin)', true, true, true],
  ['Food Cost & menu recipes', false, true, true],
  ['Profit & Loss (Form B) + PDF', false, true, true],
  ['Payroll, OT, advances & payslip PDF', false, true, true],
  ['Compare outlets', false, false, true]
];

export const HISTORY_DAYS_FREE = 30;

export const planKey = () => session.plan || 'business';
export const isPro = () => planKey() !== 'free';
export const planName = () => PLANS[planKey()]?.name || 'Free';

// Hari trial yang tinggal (null jika tiada trial aktif atau sudah berbayar).
export function trialDaysLeft() {
  const b = session.business;
  if (!b?.trial_ends_at) return null;
  const paid = b.plan && b.plan !== 'free' && (!b.plan_until || new Date(b.plan_until) > new Date());
  if (paid) return null;
  const ms = new Date(b.trial_ends_at) - new Date();
  return ms > 0 ? Math.ceil(ms / 864e5) : null;
}

// Kad "ciri Pro" untuk ganti kandungan halaman yang berkunci.
export function lockCard(title, text) {
  return `<section class="card placeholder lock-card">
    <span class="lock-ic" aria-hidden="true">${icon('lock')}</span>
    <h2>${esc(title)} is a Pro feature</h2>
    <p>${esc(text)} Nothing is deleted: your existing records are kept and come back when you upgrade.</p>
    <a class="btn primary" href="#/pakej">See Pro plan · RM ${PLANS.pro.price}/month</a>
  </section>`;
}

// Lencana kecil 🔒 PRO di sebelah label.
export const proTag = () => `<span class="pro-tag" aria-label="Pro feature">${icon('lock')}PRO</span>`;
