/**
 * State schema definitions, initial state values, and migration handlers.
 */

export const STATE_VERSION = 1;

/** Single localStorage key. One read, one write, one thing to reason about. */
export const STATE_KEY = 'app-state';

/** Theme is tri-state: 'system' is a real user choice, not the absence of one. */
export const THEME = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
});

export const SUBSCRIBE_STATUS = Object.freeze({
  IDLE: 'idle',
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error'
});

export const DEFAULT_STATE = Object.freeze({
  version: STATE_VERSION,

  /** Persisted. Everything the user deliberately chose. */
  preferences: {
    theme: THEME.SYSTEM,
    billingCycle: 'monthly', // 'monthly' | 'annual'
    reducedMotion: false
  },

  /** Persisted where it aids continuity; transient parts are stripped on save. */
  ui: {
    navOpen: false, // transient — never restored
    openFaqId: null // persisted — the user reads the same answer twice
  },

  /** Persisted so a returning subscriber is not asked twice. */
  subscription: {
    status: SUBSCRIBE_STATUS.IDLE,
    email: null,
    updatedAt: null
  },

  /** Transient. Contact intent is not a preference and is never persisted. */
  contact: {
    status: SUBSCRIBE_STATUS.IDLE,
    errors: {}
  },

  /** Persisted. Demonstrates counters surviving a reload. */
  session: {
    visits: 0,
    lastVisitAt: null,
    statsRevealed: false
  }
});

/**
 * Keys excluded from persistence.
 * navOpen: restoring an open hamburger on a fresh load is disorienting.
 * contact: an in-flight form status must never survive a reload.
 */
export const TRANSIENT_PATHS = Object.freeze(['ui.navOpen', 'contact']);

/**
 * version -> upgrade function. Applied in ascending order.
 * Example for a future v2:
 *   2: (state) => ({ ...state, preferences: { ...state.preferences, locale: 'en' } })
 */
export const MIGRATIONS = Object.freeze({});

/** Deep clone that does not share references with DEFAULT_STATE. */
export function cloneDefaults() {
  return structuredClone
    ? structuredClone(DEFAULT_STATE)
    : JSON.parse(JSON.stringify(DEFAULT_STATE));
}

/**
 * Merge a persisted payload onto the defaults.
 * Unknown keys are dropped and missing keys are filled, so adding a field to
 * DEFAULT_STATE never breaks an existing user's stored state.
 */
export function reconcile(defaults, stored) {
  if (!stored || typeof stored !== 'object') return defaults;

  const output = Array.isArray(defaults) ? [...defaults] : { ...defaults };

  for (const key of Object.keys(defaults)) {
    const defaultValue = defaults[key];
    const storedValue = stored[key];
    if (storedValue === undefined) continue;

    const bothPlainObjects =
      defaultValue &&
      storedValue &&
      typeof defaultValue === 'object' &&
      typeof storedValue === 'object' &&
      !Array.isArray(defaultValue) &&
      !Array.isArray(storedValue);

    output[key] = bothPlainObjects
      ? reconcile(defaultValue, storedValue)
      : storedValue;
  }

  return output;
}

/** Run every migration newer than the payload's own version. */
export function migrate(stored) {
  if (!stored || typeof stored !== 'object') return null;

  let working = stored;
  let version = Number(stored.version) || 0;

  while (version < STATE_VERSION) {
    const next = version + 1;
    const step = MIGRATIONS[next];
    if (typeof step === 'function') {
      working = step(working);
      console.info(`[state] migrated v${version} -> v${next}`);
    }
    version = next;
  }

  working.version = STATE_VERSION;
  return working;
}
