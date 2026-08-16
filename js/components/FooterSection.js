/**
 * FooterSection component managing footer navigation links, newsletter subscription, and dynamic copyright year.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren, text } from '../core/dom.js';
import { SUBSCRIBE_STATUS } from '../state/schema.js';
import { TOPICS } from '../services/EventBus.js';

const SUBSCRIBE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class FooterSection extends Component {
  constructor({ meta, ...deps }) {
    super(deps);
    this.meta = meta;
    this.form = null;
    this.input = null;
    this.submitButton = null;
    this.statusNode = null;
  }

  mount() {
    if (!this.root || !this.content) return this;
    this.render();
    this.bindEvents();
    this.syncSubscription(this.state.get('subscription.status'));
    return this;
  }

  render() {
    const c = this.content;
    const meta = this.meta ?? {};

    const brand = el('div', { className: 'footer__brand' }, [
      el('div', { className: 'footer__logo' }, [
        el('img', {
          className: 'footer__logo-img',
          src: meta.logo,
          alt: `${meta.brandName} ${meta.brandHighlight} logo`,
          width: 32,
          height: 32,
          loading: 'lazy',
          decoding: 'async'
        }),
        el('span', { className: 'footer__brand-text' }, [
          text(`${meta.brandName} `),
          el('span', { className: 'footer__brand-highlight', text: meta.brandHighlight })
        ])
      ]),
      el('p', { className: 'footer__text', text: c.tagline })
    ]);

    const nav = el('nav', { className: 'footer__nav', aria: { label: c.navAriaLabel } },
      c.groups.map((group) =>
        el('div', { className: 'footer__nav-group', dataset: { groupId: group.id } }, [
          el('p', { className: 'footer__nav-title', text: group.title }),
          el('ul', { className: 'footer__nav-list' },
            group.links.map((link) =>
              el('li', {}, [
                el('a', { className: 'footer__nav-link', href: link.href, text: link.label })
              ])
            )
          )
        ])
      )
    );

    const sub = c.subscribe;

    this.input = el('input', {
      className: 'footer__input',
      id: 'footer-email',
      name: 'email',
      type: 'email',
      placeholder: sub.placeholder,
      attrs: { autocomplete: 'email', 'aria-describedby': 'footer-subscribe-status' }
    });

    this.submitButton = el('button', {
      className: 'button button--primary footer__submit',
      id: 'subscribe-btn',
      type: 'submit',
      text: sub.submitLabel
    });

    this.statusNode = el('p', {
      className: 'footer__status',
      id: 'footer-subscribe-status',
      attrs: { role: 'status', 'aria-live': 'polite' },
      text: ''
    });

    this.form = el('form', {
      className: 'footer__form',
      id: 'subscribe-form',
      action: sub.endpoint,
      method: 'POST',
      attrs: { novalidate: 'novalidate' }
    }, [
      el('label', { className: 'footer__form-label', htmlFor: 'footer-email', text: sub.fieldLabel }),
      el('div', { className: 'footer__form-row' }, [this.input, this.submitButton]),
      this.statusNode
    ]);

    const actions = el('div', { className: 'footer__actions' }, [
      el('p', { className: 'footer__label', text: sub.label }),
      this.form,
      el('div', { className: 'footer__social', aria: { label: c.social.ariaLabel } },
        c.social.links.map((link) =>
          el('a', {
            className: 'footer__social-link',
            href: link.href,
            text: link.short,
            aria: { label: link.label },
            attrs: { rel: 'noopener noreferrer' }
          })
        )
      )
    ]);

    const bottom = el('div', { className: 'footer__bottom' }, [
      el('p', {}, [text(`© ${new Date().getFullYear()} ${meta.copyright}`)]),
      el('div', { className: 'footer__legal' },
        c.legal.map((link) =>
          el('a', { className: 'footer__legal-link', href: link.href, text: link.label })
        )
      )
    ]);

    replaceChildren(this.root, frag([
      el('div', { className: 'footer__top' }, [brand, nav, actions]),
      bottom
    ]));
    this.root.dataset.hydrated = 'true';
  }

  bindEvents() {
    this.listen(this.form, 'submit', (event) => {
      event.preventDefault();
      this.subscribe();
    });

    this.observeState('subscription.status', ({ value }) => this.syncSubscription(value));
  }

  async subscribe() {
    const email = String(this.input.value ?? '').trim();
    const sub = this.content.subscribe;

    if (!SUBSCRIBE_EMAIL_PATTERN.test(email)) {
      this.input.setAttribute('aria-invalid', 'true');
      this.statusNode.textContent = 'Enter a valid email address to subscribe.';
      this.input.focus();
      return;
    }

    this.input.removeAttribute('aria-invalid');
    this.state.set('subscription.status', SUBSCRIBE_STATUS.PENDING);

    try {
      const response = await fetch(sub.endpoint, {
        method: 'POST',
        body: new FormData(this.form),
        headers: { Accept: 'application/json' },
        signal: this.signal
      });

      if (!response.ok) throw new Error(`Request failed with ${response.status}`);

      // Batched: one microtask, one localStorage write, one publish.
      this.state.patch({
        'subscription.status': SUBSCRIBE_STATUS.SUCCESS,
        'subscription.email': email,
        'subscription.updatedAt': new Date().toISOString()
      });
      this.form.reset();
      this.bus.publish(TOPICS.SUBSCRIBE_STATUS, { status: SUBSCRIBE_STATUS.SUCCESS, email });
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error('[FooterSection] subscribe failed:', error);
      this.state.set('subscription.status', SUBSCRIBE_STATUS.ERROR);
      this.bus.publish(TOPICS.SUBSCRIBE_STATUS, { status: SUBSCRIBE_STATUS.ERROR, error });
    }
  }

  syncSubscription(status) {
    if (!this.submitButton || !this.statusNode) return;
    const sub = this.content.subscribe;

    switch (status) {
      case SUBSCRIBE_STATUS.PENDING:
        this.submitButton.disabled = true;
        this.submitButton.setAttribute('aria-busy', 'true');
        this.submitButton.textContent = sub.submittingLabel;
        this.statusNode.textContent = '';
        break;

      case SUBSCRIBE_STATUS.SUCCESS:
        this.submitButton.disabled = true;
        this.submitButton.removeAttribute('aria-busy');
        this.submitButton.textContent = sub.successLabel;
        this.input.disabled = true;
        this.statusNode.textContent = "You're on the list. Product updates land monthly.";
        break;

      case SUBSCRIBE_STATUS.ERROR:
        this.submitButton.disabled = false;
        this.submitButton.removeAttribute('aria-busy');
        this.submitButton.textContent = sub.errorLabel;
        this.statusNode.textContent =
          'We could not reach the mailing service. Check your connection and try again.';
        break;

      default:
        this.submitButton.disabled = false;
        this.submitButton.removeAttribute('aria-busy');
        this.submitButton.textContent = sub.submitLabel;
        this.statusNode.textContent = '';
    }
  }

  onDestroy() {
    this.form = null;
    this.input = null;
    this.submitButton = null;
    this.statusNode = null;
    this.meta = null;
  }
}
