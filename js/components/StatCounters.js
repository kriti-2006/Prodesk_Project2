/**
 * StatCounters component animating numerical metric statistics when scrolled into view.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren } from '../core/dom.js';
import { TOPICS } from '../services/EventBus.js';

const DURATION_MS = 1400;

export class StatCounters extends Component {
  constructor(deps) {
    super(deps);
    this.observer = null;
    this.valueNodes = new Map();
    this.rafHandle = null;
    this.hasRun = false;
  }

  mount() {
    if (!this.root || !this.content) return this;

    this.render();
    this.setupObserver();

    this.observeState('preferences.reducedMotion', () => this.paintFinal());
    return this;
  }

  render() {
    const c = this.content;
    this.valueNodes.clear();

    const header = el('header', { className: 'section__header section__header--center' }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title })
    ]);

    const grid = el('div', { className: 'stats__grid' });

    const cards = c.items.map((item) => {
      const valueNode = el('p', {
        className: 'stat__value',
        text: this.format(0, item),
        dataset: { statId: item.id }
      });
      this.valueNodes.set(item.id, { node: valueNode, item });

      return el('article', {
        className: 'stat',
        dataset: { statId: item.id },
        attrs: { 'aria-label': `${this.format(item.value, item)} ${item.label}` }
      }, [valueNode, el('p', { className: 'stat__label', text: item.label })]);
    });

    grid.appendChild(frag(cards));
    replaceChildren(this.root, frag([header, grid]));
    this.root.dataset.hydrated = 'true';
  }

  format(value, item) {
    const decimals = Number(item.decimals ?? 0);
    return `${item.prefix ?? ''}${Number(value).toFixed(decimals)}${item.suffix ?? ''}`;
  }

  prefersReducedMotion() {
    return (
      this.state.get('preferences.reducedMotion') === true ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    );
  }

  setupObserver() {
    // Already animated this session, or no observer support: paint finals.
    if (this.state.get('session.statsRevealed') || typeof IntersectionObserver !== 'function') {
      this.paintFinal();
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.start();
        // One-shot: disconnect immediately so the observer stops holding the
        // section. Not deferring this to destroy() is the cheaper fix.
        this.observer?.disconnect();
        this.observer = null;
      },
      { threshold: 0.35 }
    );

    // track() guarantees disconnect() runs on destroy even if the section never
    // scrolled into view.
    this.track(this.observer);
    this.observer.observe(this.root);
  }

  start() {
    if (this.hasRun) return;
    this.hasRun = true;

    this.state.set('session.statsRevealed', true);
    this.bus.publish(TOPICS.STATS_REVEALED, { count: this.valueNodes.size });

    if (this.prefersReducedMotion()) {
      this.paintFinal();
      return;
    }

    const startedAt = performance.now();

    const step = (now) => {
      // Without this guard the loop would keep writing to detached nodes after
      // the component is gone, pinning them in memory.
      if (this.destroyed) return;

      const progress = Math.min((now - startedAt) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic

      this.valueNodes.forEach(({ node, item }) => {
        node.textContent = this.format(item.value * eased, item);
      });

      if (progress < 1) {
        this.rafHandle = window.requestAnimationFrame(step);
      } else {
        this.rafHandle = null;
        this.paintFinal();
      }
    };

    this.rafHandle = window.requestAnimationFrame(step);
  }

  paintFinal() {
    this.valueNodes.forEach(({ node, item }) => {
      node.textContent = this.format(item.value, item);
    });
  }

  onDestroy() {
    if (this.rafHandle !== null) {
      window.cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.observer?.disconnect();
    this.observer = null;
    this.valueNodes.clear();
  }
}
