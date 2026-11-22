// Halaman Pakej: pakej semasa, baki trial, banding pakej dan cara naik taraf.
// Pembayaran online belum ada: naik taraf melalui WhatsApp (UPGRADE_WHATSAPP dalam config.js).
import { esc, icon } from '../ui.js';
import { session } from '../session.js';
import { PLANS, FEATURES, planKey, trialDaysLeft } from '../plan.js';
import { t, locale } from '../i18n.js';

/* global UPGRADE_WHATSAPP */
const waNumber = () => (typeof UPGRADE_WHATSAPP === 'string' ? UPGRADE_WHATSAPP.replace(/\D/g, '') : '');

function upgradeLink(plan) {
  const n = waNumber();
  if (!n) return '';
  const msg = t('Hi, I want to upgrade BizProfit Pro to the {plan} plan (RM {price}/month). Company: {co}', { plan: t(PLANS[plan].name), price: PLANS[plan].price, co: session.business?.name || '-' });
  return `https://wa.me/${n}?text=${encodeURIComponent(msg)}`;
}

const cell = v => (v === true ? `<span class="pk-yes" aria-label="${t('Included')}">${icon('check')}</span>`
  : v === false ? `<span class="pk-no" aria-label="${t('Not included')}">–</span>` : esc(t(v)));

export default {
  render(view) {
    const cur = planKey();
    const trial = trialDaysLeft();
    const until = session.business?.plan_until;
    const sub = trial ? t('Pro trial · {n} days left, then Free', { n: trial })
      : cur === 'free' ? t('Free forever. Upgrade any time.')
      : until ? t('Active until {d}', { d: new Date(until).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' }) })
      : t('Active');

    const card = k => {
      const p = PLANS[k], on = k === cur, link = upgradeLink(k);
      const action = on ? `<span class="pk-cur">${t('Current plan')}</span>`
        : k === 'free' ? ''
        : !session.isOwner ? `<span class="pk-note">${t('Ask the owner to upgrade')}</span>`
        : link ? `<a class="btn primary block" href="${esc(link)}" target="_blank" rel="noopener">${t('Upgrade to {plan}', { plan: t(p.name) })}</a>`
        : `<span class="pk-note">${t('Contact BizProfit to upgrade')}</span>`;
      return `<article class="pk-card${on ? ' on' : ''}${k === 'pro' ? ' hl' : ''}">
        <h3>${t(p.name)}</h3>
        <p class="pk-price"><small>RM</small>${p.price}<span>${t('/month')}</span></p>
        <p class="pk-lim">${p.outlets === 1 ? t('1 outlet') : t('Up to {n} outlets', { n: p.outlets })} · ${p.staff === null ? t('unlimited staff') : t('{n} staff accounts', { n: p.staff })}</p>
        ${action}
      </article>`;
    };

    view.innerHTML = `
      <section class="card pk-now">
        <p class="h-lbl">${icon('layers')}${t('Your plan')}</p>
        <p class="pk-now-name">${esc(t(PLANS[cur].name))}</p>
        <p class="pk-now-sub">${esc(sub)}</p>
      </section>

      <div class="pk-cards">${['free', 'pro', 'business'].map(card).join('')}</div>

      <section class="card pk-table-wrap">
        <table class="pk-table">
          <thead><tr><th scope="col">${t('Feature')}</th><th scope="col">${t('Free')}</th><th scope="col">${t('Pro')}</th><th scope="col">${t('Business')}</th></tr></thead>
          <tbody>${FEATURES.map(([f, a, b, c]) => `<tr><th scope="row">${esc(t(f))}</th><td>${cell(a)}</td><td>${cell(b)}</td><td>${cell(c)}</td></tr>`).join('')}</tbody>
        </table>
      </section>

      <p class="note pk-foot">${t('When a plan ends, nothing is deleted. Pro data (payslips, menus, food cost) is kept safely and comes back as soon as you upgrade.')}</p>`;
  }
};
