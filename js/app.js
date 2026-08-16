/**
 * Main application entrypoint and lifecycle coordinator.
 * Manages state initialization, content loading, component mounting, and global events.
 */

import { bus, TOPICS } from './services/EventBus.js';
import { storage } from './services/StorageService.js';
import { contentService, ContentError } from './services/ContentService.js';
import { state } from './state/StateManager.js';
import { ComponentRegistry } from './core/Component.js';
import { el, qs, clear } from './core/dom.js';

import { Navigation } from './components/Navigation.js';
import { ThemeToggle } from './components/ThemeToggle.js';
import { HeroSection } from './components/HeroSection.js';
import { FeatureCards } from './components/FeatureCards.js';
import { StatCounters } from './components/StatCounters.js';
import { TestimonialCards } from './components/TestimonialCards.js';
import { PricingCards } from './components/PricingCards.js';
import { FaqAccordion } from './components/FaqAccordion.js';
import { ContactForm } from './components/ContactForm.js';
import { FooterSection } from './components/FooterSection.js';

class App {
  constructor() {
    this.registry = new ComponentRegistry();
    this.bus = bus;
    this.state = state;
    this.storage = storage;
    this.content = null;
    /** Aborts the content fetch if the page is torn down mid-flight. */
    const AC = (typeof window !== 'undefined' && window.AbortController) || AbortController;
    this.controller = new AC();
    this.started = false;
  }

  async start() {
    if (this.started) return this;
    this.started = true;

    // PHASE 2 — state before render, without exception.
    this.state.hydrate();

    // PHASE 3 — content.
    try {
      this.content = await contentService.load({ signal: this.controller.signal });
    } catch (error) {
      this.renderContentError(error);
      return this;
    }

    // PHASE 4 — mount.
    this.mountComponents();

    // PHASE 5 — ready.
    this.releaseTransitionGuard();
    this.bindGlobalLifecycle();
    this.bus.publish(TOPICS.APP_READY, {
      components: this.registry.size,
      visits: this.state.get('session.visits')
    });

    document.documentElement.dataset.appReady = 'true';
    return this;
  }

  mountComponents() {
    const c = this.content;
    const deps = { bus: this.bus, state: this.state };

    const navigation = new Navigation({
      ...deps,
      root: qs('[data-component="navigation"]'),
      content: c.nav
    }).mount();
    this.registry.register('navigation', navigation);

    // Navigation renders the theme button, so ThemeToggle mounts after it and
    // receives the node Navigation created. Explicit dependency, not a global query.
    this.registry.register('themeToggle', new ThemeToggle({
      ...deps,
      root: navigation.themeSlot ?? qs('.theme-toggle')
    }).mount());

    this.registry.register('hero', new HeroSection({
      ...deps,
      root: qs('[data-component="hero"]'),
      content: c.hero
    }).mount());

    this.registry.register('features', new FeatureCards({
      ...deps,
      root: qs('[data-component="features"]'),
      content: c.features,
      variant: 'feature',
      gridClass: 'features__grid'
    }).mount());

    this.registry.register('services', new FeatureCards({
      ...deps,
      root: qs('[data-component="services"]'),
      content: c.services,
      variant: 'service',
      gridClass: 'services__grid'
    }).mount());

    this.registry.register('why', new FeatureCards({
      ...deps,
      root: qs('[data-component="why"]'),
      content: c.why,
      centerHeader: false,
      asideBlock: true
    }).mount());

    this.registry.register('stats', new StatCounters({
      ...deps,
      root: qs('[data-component="stats"]'),
      content: c.stats
    }).mount());

    this.registry.register('testimonials', new TestimonialCards({
      ...deps,
      root: qs('[data-component="testimonials"]'),
      content: c.testimonials
    }).mount());

    this.registry.register('pricing', new PricingCards({
      ...deps,
      root: qs('[data-component="pricing"]'),
      content: c.pricing
    }).mount());

    this.registry.register('faq', new FaqAccordion({
      ...deps,
      root: qs('[data-component="faq"]'),
      content: c.faq
    }).mount());

    this.registry.register('contact', new ContactForm({
      ...deps,
      root: qs('[data-component="contact"]'),
      content: c.contact
    }).mount());

    this.registry.register('footer', new FooterSection({
      ...deps,
      root: qs('[data-component="footer"]'),
      content: c.footer,
      meta: c.meta
    }).mount());
  }

  /**
   * The transition guard is the second half of the anti-flicker fix.
   * style.css applies `transition: background-color 220ms` to body and a dozen
   * other selectors. Without .no-transitions during boot, the theme class
   * applied in <head> animates as a visible fade on every load.
   */
  releaseTransitionGuard() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove('no-transitions');
      });
    });
  }

  bindGlobalLifecycle() {
    // pagehide fires reliably on mobile Safari where unload does not.
    window.addEventListener('pagehide', () => this.destroy(), {
      once: true,
      signal: this.controller.signal
    });

    this.guardBrowserAutofocus();
  }

  /**
   * Chrome autofills saved emails into name="email" fields after load, focuses
   * the filled input, and scrolls it into view. On this page that yanked
   * every refresh down to the footer's subscribe field with the cursor
   * blinking. The guard undoes only browser-initiated focus+scroll jumps:
   * any user interaction before the check backs it off, so legit use of the
   * autofill suggestion popover and keyboard focus are untouched.
   */
  guardBrowserAutofocus() {
    const signal = this.controller.signal;
    let interacted = false;

    window.addEventListener('pointerdown', () => (interacted = true), { signal });
    window.addEventListener('keydown', () => (interacted = true), { signal });

    // Catch any browser-initiated focus/autofill focus events before user interaction.
    document.addEventListener(
      'focus',
      (event) => {
        if (interacted) return;
        const target = event.target;
        if (
          target &&
          (target instanceof window.HTMLInputElement ||
            target instanceof window.HTMLTextAreaElement)
        ) {
          const type = (target.getAttribute('type') || 'text').toLowerCase();
          if (type === 'email' || type === 'text') {
            target.blur();
          }
        }
      },
      { capture: true, signal },
    );
  }

  /** Renders a real error state rather than an empty page. */
  renderContentError(error) {
    const isContentError = error instanceof ContentError;
    console.error('[App] content load failed:', error);

    const main = qs('#main-content');
    if (!main) return;

    clear(main);
    main.appendChild(
      el('div', { className: 'container app-error', attrs: { role: 'alert' } }, [
        el('h1', { className: 'section__title', text: 'This page could not load its content' }),
        el('p', {
          className: 'section__subtitle',
          text: isContentError
            ? error.message
            : 'An unexpected error occurred while loading data/content.json.'
        }),
        el('p', {
          className: 'section__subtitle',
          text: 'Serve the project over HTTP — for example: npx serve . — then reload.'
        })
      ])
    );

    document.documentElement.classList.remove('no-transitions');
  }

  /** Full teardown. Every component, every listener, every subscription. */
  destroy() {
    this.registry.destroyAll();
    this.controller.abort();
    this.bus.publish(TOPICS.APP_DESTROY, {});
    this.bus.clear();
    this.started = false;
  }
}

const app = new App();

// The document is already parsed when a module script runs, but this guard keeps
// the module safe to import from a non-deferred context.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => app.start(), { once: true });
} else {
  app.start();
}

// Exposed for the DevTools verification steps in section 6 of the README:
//   __PRODESK__.destroy()  -> tear everything down before the second snapshot
//   __PRODESK__.bus.listenerCount()
//   __PRODESK__.state.get('preferences')
window.__PRODESK__ = { app, bus, state, storage, contentService };

export default app;
