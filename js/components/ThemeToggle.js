/**
 * ThemeToggle component cycling theme preference between light, dark, and system modes.
 */

import { Component } from '../core/Component.js';
import { THEME } from '../state/schema.js';
import { TOPICS } from '../services/EventBus.js';

const ORDER = [THEME.LIGHT, THEME.DARK, THEME.SYSTEM];

const LABELS = {
  [THEME.LIGHT]: 'Theme: light. Switch to dark.',
  [THEME.DARK]: 'Theme: dark. Switch to system.',
  [THEME.SYSTEM]: 'Theme: system. Switch to light.'
};

export class ThemeToggle extends Component {
  constructor(deps) {
    super(deps);
    this.mediaQuery = null;
  }

  mount() {
    if (!this.root) return this;

    this.apply(this.state.get('preferences.theme'));

    this.listen(this.root, 'click', () => {
      const current = this.state.get('preferences.theme');
      const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
      // The component's entire job: write state. Nothing else.
      this.state.set('preferences.theme', next);
    });

    // React to state rather than to our own click, so a theme change from any
    // source (another component, DevTools, a future settings panel) is honoured.
    this.observeState('preferences.theme', ({ value }) => this.apply(value));

    this.watchSystemPreference();
    return this;
  }

  /**
   * The OS-preference listener is a textbook leak: window.matchMedia() returns a
   * long-lived object owned by the browser, and Sprint 1 attached a handler to
   * it with no removal path. Passing the AbortController signal means destroy()
   * detaches it.
   */
  watchSystemPreference() {
    if (typeof window.matchMedia !== 'function') return;
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    this.listen(this.mediaQuery, 'change', () => {
      if (this.state.get('preferences.theme') === THEME.SYSTEM) {
        this.apply(THEME.SYSTEM);
      }
    });
  }

  resolve(preference) {
    if (preference === THEME.LIGHT || preference === THEME.DARK) return preference;
    return this.mediaQuery?.matches ||
      window.matchMedia?.('(prefers-color-scheme: dark)').matches
      ? THEME.DARK
      : THEME.LIGHT;
  }

  apply(preference) {
    const effective = this.resolve(preference);
    const root = document.documentElement;

    // Explicit classes for BOTH themes. Sprint 1 only had .theme--dark, so on a
    // dark-OS machine choosing "light" removed the class and left the dark
    // :root defaults in place — the light theme silently did nothing.
    root.classList.toggle('theme--dark', effective === THEME.DARK);
    root.classList.toggle('theme--light', effective === THEME.LIGHT);
    root.dataset.themePreference = preference;

    // Keeps native scrollbars, form controls, and autofill in step with the theme.
    root.style.colorScheme = effective;

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', effective === THEME.DARK ? '#020617' : '#f9fafb');

    if (this.root) {
      this.root.setAttribute('aria-pressed', String(effective === THEME.DARK));
      this.root.setAttribute('aria-label', LABELS[preference] ?? LABELS[THEME.SYSTEM]);
      this.root.dataset.theme = preference;
    }

    this.bus.publish(TOPICS.THEME_CHANGED, { preference, effective });
  }

  onDestroy() {
    this.mediaQuery = null;
  }
}
