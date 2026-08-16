/**
 * TestimonialCards component rendering customer quotes and author metadata.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren, text } from '../core/dom.js';

export class TestimonialCards extends Component {
  mount() {
    if (!this.root || !this.content) return this;
    const c = this.content;

    const header = el('header', { className: 'section__header section__header--center' }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title })
    ]);

    const grid = el('div', { className: 'testimonials__grid' });

    const cards = c.items.map((item) =>
      el('article', {
        className: 'card card--testimonial',
        dataset: { itemId: item.id }
      }, [
        el('blockquote', { className: 'card__quote' }, [text(`“${item.quote}”`)]),
        el('footer', { className: 'card__footer' }, [
          el('div', { className: 'card__person' }, [
            el('img', {
              className: 'card__avatar',
              src: item.avatar,
              alt: item.avatarAlt,
              width: 64,
              height: 64,
              loading: 'lazy',
              decoding: 'async'
            }),
            el('div', {}, [
              el('p', { className: 'card__person-name', text: item.name }),
              el('p', { className: 'card__person-role', text: item.role })
            ])
          ])
        ])
      ])
    );

    grid.appendChild(frag(cards));
    replaceChildren(this.root, frag([header, grid]));
    this.root.dataset.hydrated = 'true';
    return this;
  }
}
