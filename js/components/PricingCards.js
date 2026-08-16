/**
 * PricingCards component managing plan card renders, billing cycle toggles (monthly/annual), and price calculations.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren, buttonClass } from '../core/dom.js';
import { TOPICS } from '../services/EventBus.js';

export class PricingCards extends Component {
  constructor(deps) {
    super(deps);
    this.priceNodes = new Map();
    this.switchButton = null;
    this.noteNode = null;
  }

  mount() {
    if (!this.root || !this.content) return this;

    this.render();
    this.bindEvents();
    this.syncPrices(this.state.get('preferences.billingCycle'));
    return this;
  }

  render() {
    const c = this.content;
    this.priceNodes.clear();

    const header = el('header', { className: 'section__header section__header--center' }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title }),
      c.subtitle && el('p', { className: 'section__subtitle', text: c.subtitle })
    ]);

    this.switchButton = el('button', {
      className: 'button button--ghost pricing__switch',
      type: 'button',
      attrs: { 'aria-pressed': 'false' },
      text: c.billing?.annualLabel ?? 'Annual'
    });

    this.noteNode = el('p', { className: 'pricing__note', text: '' });

    const controls = el('div', { className: 'pricing__controls' }, [
      this.switchButton,
      this.noteNode
    ]);

    const grid = el('div', { className: 'pricing__grid' });

    const cards = c.plans.map((plan) => {
      const priceValue = el('p', { className: 'card__price-value', text: '' });
      const pricePeriod = el('p', { className: 'card__price-period', text: plan.period ?? '' });
      this.priceNodes.set(plan.id, { valueNode: priceValue, periodNode: pricePeriod, plan });

      return el('article', {
        className: `card card--pricing${plan.featured ? ' card--pricing-featured' : ''}`,
        dataset: { planId: plan.id }
      }, [
        el('h3', { className: 'card__title', text: plan.title }),
        el('div', { className: 'card__price' }, [priceValue, pricePeriod]),
        el('ul', { className: 'card__list' },
          (plan.features ?? []).map((feature) =>
            el('li', { className: 'card__list-item', text: feature })
          )
        ),
        el('a', {
          className: `${buttonClass(plan.cta.variant)} card__cta`,
          href: plan.cta.href,
          text: plan.cta.label,
          dataset: { planCta: plan.id }
        })
      ]);
    });

    grid.appendChild(frag(cards));
    replaceChildren(this.root, frag([header, controls, grid]));
    this.root.dataset.hydrated = 'true';
  }

  bindEvents() {
    this.listen(this.switchButton, 'click', () => {
      const current = this.state.get('preferences.billingCycle');
      this.state.set('preferences.billingCycle', current === 'annual' ? 'monthly' : 'annual');
    });

    this.observeState('preferences.billingCycle', ({ value }) => this.syncPrices(value));
  }

  syncPrices(cycle) {
    const annual = cycle === 'annual';
    const billing = this.content.billing ?? {};

    this.priceNodes.forEach(({ valueNode, periodNode, plan }) => {
      if (plan.customPrice) {
        valueNode.textContent = plan.customPrice;
        periodNode.textContent = '';
        return;
      }
      const amount = annual ? plan.priceAnnual : plan.priceMonthly;
      valueNode.textContent = `${plan.currency ?? '$'}${amount}`;
      periodNode.textContent = plan.period ?? '';
    });

    if (this.switchButton) {
      this.switchButton.textContent = annual
        ? billing.monthlyLabel ?? 'Monthly'
        : billing.annualLabel ?? 'Annual';
      this.switchButton.setAttribute('aria-pressed', String(annual));
    }

    if (this.noteNode) {
      this.noteNode.textContent = annual ? billing.annualNote ?? '' : '';
    }

    this.bus.publish(TOPICS.BILLING_CHANGED, { cycle });
  }

  onDestroy() {
    this.priceNodes.clear();
    this.switchButton = null;
    this.noteNode = null;
  }
}
