// Halaman Pakej: pakej semasa, baki trial, banding pakej dan cara naik taraf.
// Pembayaran online belum ada: naik taraf melalui WhatsApp (UPGRADE_WHATSAPP dalam config.js).
import { esc, icon } from '../ui.js';
import { session } from '../session.js';
import { PLANS, FEATURES, planKey, trialDaysLeft } from '../plan.js';

/* global UPGRADE_WHATSAPP */
const waNumber = () => (typeof UPGRADE_WHATSAPP === 'string' ? UPGRADE_WHATSAPP.replace(/\D/g, '') : '');

function upgradeLink(plan) {
  const n = waNumber();
  if (!n) return '';
  const msg = `Hi, I want to upgrade BizProfit Pro to the ${PLANS[plan].name} plan (RM ${PLANS[plan].price}/month). Company: ${session.business?.name || '-'}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
}

const cell = v => (v === true ? `<span class="pk-yes" aria-label="Included">${icon('check')}</span>`
  : v === false ? '<span class="pk-no" aria-label="Not included">–</span>' : esc(v));

export default {
  render(view) {
    const cur = planKey();
    const trial = trialDaysLeft();
    const until = session.business?.plan_until;
    const sub = trial ? `Pro trial · ${trial} day${trial > 1 ? 's' : ''} left, then Free`
      : cur === 'free' ? 'Free forever. Upgrade any time.'
      : until ? `Active until ${new Date(until).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Active';

    const card = k => {
      const p = PLANS[k], on = k === cur, link = upgradeLink(k);
      const action = on ? '<span class="pk-cur">Current plan</span>'
        : k === 'free' ? ''
        : !session.isOwner ? '<span class="pk-note">Ask the owner to upgrade</span>'
        : link ? `<a class="btn primary block" href="${esc(link)}" target="_blank" rel="noopener">Upgrade to ${p.name}</a>`
        : '<span class="pk-note">Contact BizProfit to upgrade</span>';
      return `<article class="pk-card${on ? ' on' : ''}${k === 'pro' ? ' hl' : ''}">
        <h3>${p.name}</h3>
        <p class="pk-price"><small>RM</small>${p.price}<span>/month</span></p>
        <p class="pk-lim">${p.outlets === 1 ? '1 outlet' : `Up to ${p.outlets} outlets`} · ${p.staff === null ? 'unlimited staff' : `${p.staff} staff accounts`}</p>
        ${action}
      </article>`;
    };

    view.innerHTML = `
      <section class="card pk-now">
        <p class="h-lbl">${icon('layers')}Your plan</p>
        <p class="pk-now-name">${esc(PLANS[cur].name)}</p>
        <p class="pk-now-sub">${esc(sub)}</p>
      </section>

      <div class="pk-cards">${['free', 'pro', 'business'].map(card).join('')}</div>

      <section class="card pk-table-wrap">
        <table class="pk-table">
          <thead><tr><th scope="col">Feature</th><th scope="col">Free</th><th scope="col">Pro</th><th scope="col">Business</th></tr></thead>
          <tbody>${FEATURES.map(([f, a, b, c]) => `<tr><th scope="row">${esc(f)}</th><td>${cell(a)}</td><td>${cell(b)}</td><td>${cell(c)}</td></tr>`).join('')}</tbody>
        </table>
      </section>

      <p class="note pk-foot">When a plan ends, nothing is deleted. Pro data (payslips, menus, food cost) is kept safely and comes back as soon as you upgrade.</p>`;
  }
};
