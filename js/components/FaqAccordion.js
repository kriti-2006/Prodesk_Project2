/**
 * FaqAccordion component handling accordion panel expansion, keyboard navigation, and persisted open state.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren } from '../core/dom.js';
import { TOPICS } from '../services/EventBus.js';

export class FaqAccordion extends Component {
  constructor(deps) {
    super(deps);
    this.list = null;
    /** id -> { button, panel } — cached once, never re-queried on click. */
    this.panels = new Map();
  }

  mount() {
    if (!this.root || !this.content) return this;

    this.render();
    this.bindEvents();
    this.sync(this.state.get('ui.openFaqId'));
    return this;
  }

  render() {
    const c = this.content;
    this.panels.clear();

    const header = el('header', { className: 'section__header section__header--center' }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title })
    ]);

    this.list = el('div', { className: 'faq__list', attrs: { role: 'list' } });

    const items = c.items.map((item) => {
      const questionId = `${item.id}-question`;
      const answerId = `${item.id}-answer`;

      const button = el('button', {
        className: 'faq__button',
        type: 'button',
        attrs: { 'aria-expanded': 'false', 'aria-controls': answerId },
        dataset: { faqId: item.id },
        text: item.question
      });

      const panel = el('div', {
        className: 'faq__panel',
        id: answerId,
        attrs: { role: 'region', 'aria-labelledby': questionId }
      }, [el('p', { className: 'faq__answer', text: item.answer })]);

      // Cache both references now. Click handling becomes a Map lookup.
      this.panels.set(item.id, { button, panel });

      return el('article', {
        className: 'faq__item',
        attrs: { role: 'listitem' },
        dataset: { faqId: item.id }
      }, [
        el('h3', { className: 'faq__question', id: questionId }, [button]),
        panel
      ]);
    });

    this.list.appendChild(frag(items));
    replaceChildren(this.root, frag([header, this.list]));
    this.root.dataset.hydrated = 'true';
  }

  bindEvents() {
    // ONE listener for all questions. Adding a 20th FAQ adds zero listeners.
    this.listen(this.list, 'click', (event) => {
      const button = event.target.closest('.faq__button');
      if (!button) return;

      const id = button.dataset.faqId;
      const currentlyOpen = this.state.get('ui.openFaqId');
      this.state.set('ui.openFaqId', currentlyOpen === id ? null : id);
    });

    this.observeState('ui.openFaqId', ({ value }) => this.sync(value));
  }

  sync(openId) {
    this.panels.forEach(({ button, panel }, id) => {
      const isOpen = id === openId;
      button.setAttribute('aria-expanded', String(isOpen));
      panel.classList.toggle('faq__panel--open', isOpen);
    });
    this.bus.publish(TOPICS.FAQ_TOGGLED, { openId });
  }

  onDestroy() {
    this.panels.clear();
    this.list = null;
  }
}
