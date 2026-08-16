/**
 * HeroSection component rendering the primary landing hero banner and key visual metrics.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren, buttonClass } from '../core/dom.js';

export class HeroSection extends Component {
  mount() {
    if (!this.root || !this.content) return this;
    const c = this.content;

    const contentColumn = el('div', { className: 'hero__content' }, [
      c.eyebrow && el('p', { className: 'hero__eyebrow', text: c.eyebrow }),
      el('h1', { className: 'hero__title', text: c.title }),
      c.subtitle && el('p', { className: 'hero__subtitle', text: c.subtitle }),
      el('div', { className: 'hero__actions' },
        (c.actions ?? []).map((action) =>
          el('a', {
            className: buttonClass(action.variant),
            href: action.href,
            text: action.label,
            dataset: { ctaId: action.id }
          })
        )
      ),
      el('div', { className: 'hero__meta' },
        (c.meta ?? []).map((item) =>
          el('div', { className: 'hero__meta-item', dataset: { metaId: item.id } }, [
            el('span', { className: 'hero__meta-label', text: item.label })
          ])
        )
      )
    ]);

    const media = el('div', { className: 'hero__media' }, [
      el('img', {
        className: 'hero__image',
        src: c.image.src,
        alt: c.image.alt,
        width: c.image.width,
        height: c.image.height,
        decoding: 'async',
        attrs: { fetchpriority: 'high' }
      })
    ]);

    replaceChildren(this.root, frag([contentColumn, media]));
    this.root.dataset.hydrated = 'true';
    return this;
  }
}
