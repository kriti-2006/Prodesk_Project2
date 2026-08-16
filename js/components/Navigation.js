/**
 * Navigation component managing responsive menu toggle, brand logo, and primary navigation links.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren, buttonClass } from '../core/dom.js';
import { TOPICS } from '../services/EventBus.js';

const DESKTOP_QUERY = '(min-width: 48rem)'; /* 768px — matches style.css */

export class Navigation extends Component {
  constructor(deps) {
    super(deps);
    this.toggleButton = null;
    this.menu = null;
    this.desktopQuery = null;
    this.themeSlot = null;
  }

  mount() {
    if (!this.root || !this.content) return this;

    this.toggleButton = this.root.querySelector('.nav__toggle');
    this.menu = this.root.querySelector('.nav__menu');
    if (!this.toggleButton || !this.menu) return this;

    this.render();
    this.bindEvents();
    this.sync(this.state.get('ui.navOpen'));
    return this;
  }

  render() {
    const { links, actions } = this.content;

    const list = el('ul', { className: 'nav__list' },
      links.map((link) =>
        el('li', { className: 'nav__item', dataset: { navId: link.id } }, [
          el('a', { className: 'nav__link', href: link.href, text: link.label })
        ])
      )
    );

    // The theme toggle button is a stable shell — it is not re-rendered, so its
    // listener is never orphaned by a content refresh.
    this.themeSlot = el('button', {
      className: 'theme-toggle',
      type: 'button',
      attrs: { 'aria-pressed': 'false' },
      aria: { label: 'Toggle colour theme' }
    }, [
      el('span', { className: 'theme-toggle__icon theme-toggle__icon--light', text: '☀', aria: { hidden: 'true' } }),
      el('span', { className: 'theme-toggle__icon theme-toggle__icon--dark', text: '🌙', aria: { hidden: 'true' } })
    ]);

    const actionBar = el('div', { className: 'nav__actions' }, [
      this.themeSlot,
      ...actions.map((action) =>
        el('a', {
          className: `${buttonClass(action.variant)}`,
          href: action.href,
          text: action.label,
          dataset: { navId: action.id }
        })
      )
    ]);

    replaceChildren(this.menu, frag([list, actionBar]));
  }

  bindEvents() {
    this.listen(this.toggleButton, 'click', () => {
      this.state.set('ui.navOpen', !this.state.get('ui.navOpen'));
    });

    // One delegated listener for N links, instead of N listeners on N nodes.
    // Delegation also survives a re-render — the handler lives on the container,
    // which is never replaced.
    this.listen(this.menu, 'click', (event) => {
      const link = event.target.closest('a.nav__link');
      if (link && !this.isDesktop()) this.state.set('ui.navOpen', false);
    });

    this.listen(document, 'keydown', (event) => {
      if (event.key === 'Escape' && this.state.get('ui.navOpen')) {
        this.state.set('ui.navOpen', false);
        this.toggleButton?.focus();
      }
    });

    if (typeof window.matchMedia === 'function') {
      this.desktopQuery = window.matchMedia(DESKTOP_QUERY);
      this.listen(this.desktopQuery, 'change', (event) => {
        if (event.matches) this.state.set('ui.navOpen', false);
      });
    }

    this.observeState('ui.navOpen', ({ value }) => this.sync(value));
  }

  isDesktop() {
    return this.desktopQuery ? this.desktopQuery.matches : window.innerWidth >= 768;
  }

  sync(isOpen) {
    if (!this.menu || !this.toggleButton) return;
    this.menu.classList.toggle('nav__menu--open', Boolean(isOpen));
    this.toggleButton.classList.toggle('nav__toggle--open', Boolean(isOpen));
    this.toggleButton.setAttribute('aria-expanded', String(Boolean(isOpen)));
    this.bus.publish(TOPICS.NAV_TOGGLED, { open: Boolean(isOpen) });
  }

  onDestroy() {
    this.toggleButton = null;
    this.menu = null;
    this.desktopQuery = null;
    this.themeSlot = null;
  }
}
