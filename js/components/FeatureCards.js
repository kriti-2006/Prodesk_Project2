/**
 * FeatureCards component rendering feature, service, and value-prop card grids.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren, clear } from '../core/dom.js';

export class FeatureCards extends Component {
  /**
   * @param {Object} deps
   * @param {string} deps.variant   BEM modifier: 'feature' | 'service'
   * @param {string} deps.gridClass e.g. 'features__grid'
   * @param {boolean} [deps.centerHeader]
   * @param {boolean} [deps.asideBlock] render the why-section aside
   */
  constructor({ variant = 'feature', gridClass = 'features__grid', centerHeader = true, asideBlock = false, ...deps }) {
    super(deps);
    this.variant = variant;
    this.gridClass = gridClass;
    this.centerHeader = centerHeader;
    this.asideBlock = asideBlock;
  }

  mount() {
    if (!this.root || !this.content) return this;
    replaceChildren(this.root, frag([this.renderHeader(), this.renderBody()]));
    this.root.dataset.hydrated = 'true';
    return this;
  }

  renderHeader() {
    const c = this.content;
    const className = this.centerHeader
      ? 'section__header section__header--center'
      : 'section__header';

    return el('header', { className }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title }),
      c.subtitle && el('p', { className: 'section__subtitle', text: c.subtitle })
    ]);
  }

  renderBody() {
    if (!this.asideBlock) return this.renderGrid();

    // Why-section layout: list column + trust aside.
    return el('div', { className: 'why__layout' }, [
      el('div', { className: 'why__list' },
        this.content.items.map((item) =>
          el('article', { className: 'why__item', dataset: { itemId: item.id } }, [
            el('h3', { className: 'why__item-title', text: item.title }),
            el('p', { className: 'why__item-body', text: item.body })
          ])
        )
      ),
      this.renderAside()
    ]);
  }

  renderAside() {
    const aside = this.content.aside;
    if (!aside) return null;

    return el('aside', { className: 'why__aside', aria: { label: aside.ariaLabel } }, [
      el('p', { className: 'why__aside-label', text: aside.label }),
      el('div', { className: 'why__logos' },
        (aside.pills ?? []).map((pill) => el('span', { className: 'why__logo-pill', text: pill }))
      )
    ]);
  }

  renderGrid() {
    const grid = el('div', { className: this.gridClass });

    // Build into a fragment first — the grid is attached to the document only
    // once, so N cards cost one reflow rather than N.
    const cards = this.content.items.map((item) =>
      el('article', {
        className: `card card--${this.variant}`,
        dataset: { itemId: item.id }
      }, [
        el('h3', { className: 'card__title', text: item.title }),
        el('p', { className: 'card__body', text: item.body })
      ])
    );

    grid.appendChild(frag(cards));
    return grid;
  }

  onDestroy() {
    if (this.root) clear(this.root);
  }
}
