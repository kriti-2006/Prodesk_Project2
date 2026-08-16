(function() {
"use strict";

// ===== js/services/EventBus.js =====
/**
 * Lightweight, dependency-free event bus for decoupled component messaging.
 */
class EventBus {
  constructor({ debug = false } = {}) {
    /** @type {Map<string, Set<Function>>} */
    this._topics = new Map();
    this._debug = debug;
  }

  /**
   * Register a listener for a topic.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe handle — call it to detach.
   */
  subscribe(event, callback) {
    if (typeof event !== 'string' || !event) {
      throw new TypeError('EventBus.subscribe: event must be a non-empty string');
    }
    if (typeof callback !== 'function') {
      throw new TypeError('EventBus.subscribe: callback must be a function');
    }

    if (!this._topics.has(event)) {
      this._topics.set(event, new Set());
    }
    this._topics.get(event).add(callback);

    if (this._debug) {
      console.debug(`[EventBus] + ${event} (${this._topics.get(event).size} listeners)`);
    }

    // Returning the handle is the point: cleanup never depends on the caller
    // still holding the original function reference.
    return () => this.unsubscribe(event, callback);
  }

  /**
   * Detach a listener. Safe to call twice.
   * @param {string} event
   * @param {Function} callback
   * @returns {boolean} true when a listener was actually removed.
   */
  unsubscribe(event, callback) {
    const listeners = this._topics.get(event);
    if (!listeners) return false;

    const removed = listeners.delete(callback);

    // Drop the empty Set so the Map does not grow unbounded across a long
    // session — an empty bucket is still a retained object.
    if (listeners.size === 0) this._topics.delete(event);

    if (this._debug && removed) {
      console.debug(`[EventBus] - ${event} (${listeners.size} remaining)`);
    }
    return removed;
  }

  /**
   * Subscribe for exactly one delivery, then auto-detach.
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} unsubscribe handle.
   */
  once(event, callback) {
    const off = this.subscribe(event, (payload) => {
      off();
      callback(payload);
    });
    return off;
  }

  /**
   * Broadcast to every listener on a topic.
   *
   * Iterating over a copy is deliberate: a listener is allowed to unsubscribe
   * itself (or another listener) during dispatch without corrupting iteration.
   * Each callback is isolated in try/catch so one throwing subscriber cannot
   * abort delivery to the rest.
   *
   * @param {string} event
   * @param {*} [data]
   */
  publish(event, data) {
    const listeners = this._topics.get(event);
    if (!listeners || listeners.size === 0) {
      if (this._debug) console.debug(`[EventBus] ! ${event} (no listeners)`);
      return;
    }

    if (this._debug) console.debug(`[EventBus] > ${event}`, data);

    for (const callback of Array.from(listeners)) {
      try {
        callback(data);
      } catch (error) {
        console.error(`[EventBus] listener for "${event}" threw:`, error);
      }
    }
  }

  /** Listener count — used by the DevTools verification steps in the README. */
  listenerCount(event) {
    return event ? (this._topics.get(event)?.size ?? 0) : this._topics.size;
  }

  /** Snapshot of live topics. Diagnostics only. */
  topics() {
    return Array.from(this._topics.keys());
  }

  /** Remove one topic, or every topic. Used on full teardown. */
  clear(event) {
    if (event) this._topics.delete(event);
    else this._topics.clear();
  }
}

/** Canonical topic names. Strings are typo-prone; constants are not. */
const TOPICS = Object.freeze({
  STATE_CHANGED: 'state:changed',
  THEME_CHANGED: 'theme:changed',
  NAV_TOGGLED: 'nav:toggled',
  FAQ_TOGGLED: 'faq:toggled',
  BILLING_CHANGED: 'billing:changed',
  STATS_REVEALED: 'stats:revealed',
  SUBSCRIBE_STATUS: 'subscribe:status',
  CONTACT_STATUS: 'contact:status',
  CONTENT_LOADED: 'content:loaded',
  CONTENT_FAILED: 'content:failed',
  APP_READY: 'app:ready',
  APP_DESTROY: 'app:destroy'
});

/** Application-wide singleton. Import this, not a fresh instance. */
const bus = new EventBus({
  debug: new URLSearchParams(location.search).has('debug')
});

// ===== js/core/dom.js =====
/**
 * dom.js — createElement / appendChild / textContent helpers.
 *
 * WHY THIS EXISTS
 * Once content moves to content.json, that file becomes untrusted input. A
 * single innerHTML assignment during hydration turns the content file into a
 * stored-XSS vector. These helpers make the safe path the shortest path: there
 * is no way to pass raw markup through el(), so nobody reaches for innerHTML
 * under deadline pressure.
 *
 * Every text write here goes through textContent, which escapes by construction.
 */

/**
 * Create an element.
 * @param {string} tag
 * @param {Object} [props]
 *   className  {string}
 *   text       {string}  -> textContent (safe)
 *   attrs      {Object}  -> setAttribute pairs
 *   dataset    {Object}  -> data-* pairs
 *   aria       {Object}  -> aria-* pairs
 * @param {(Node|string|null|undefined|false)[]} [children]
 * @returns {HTMLElement}
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const { className, text, attrs, dataset, aria, ...rest } = props;

  if (className) node.className = className;

  // textContent, never innerHTML. Markup in the JSON renders as literal text.
  if (text !== undefined && text !== null) node.textContent = String(text);

  if (attrs) {
    Object.entries(attrs).forEach(([key, value]) => {
      if (value === null || value === undefined || value === false) return;
      node.setAttribute(key, String(value));
    });
  }

  if (aria) {
    Object.entries(aria).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      node.setAttribute(`aria-${key}`, String(value));
    });
  }

  if (dataset) {
    Object.entries(dataset).forEach(([key, value]) => {
      if (value === null || value === undefined) return;
      node.dataset[key] = String(value);
    });
  }

  // Direct properties (id, type, href, src, disabled, value…).
  Object.entries(rest).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    node[key] = value;
  });

  appendAll(node, children);
  return node;
}

/** Append children, skipping falsy entries so callers can use `cond && node`. */
function appendAll(parent, children) {
  const list = Array.isArray(children) ? children : [children];
  list.forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return parent;
}

/**
 * Build a DocumentFragment.
 * Batching appends into a fragment means one reflow per list instead of one per
 * card — the fix for the DOM performance issue flagged in the audit.
 */
function frag(children = []) {
  const fragment = document.createDocumentFragment();
  appendAll(fragment, children);
  return fragment;
}

/** Safe text node. */
function text(value) {
  return document.createTextNode(String(value ?? ''));
}

/**
 * Empty a container.
 * removeChild in a loop rather than innerHTML = '': it is safe, and it lets the
 * caller run teardown per node if needed before detaching.
 */
function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a container's children in a single mutation. */
function replaceChildren(node, children) {
  clear(node);
  appendAll(node, frag(children));
  return node;
}

/** Query helpers that never throw on a missing node. */
const qs = (selector, scope = document) => scope.querySelector(selector);
const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** Map a card variant name to its button class. */
function buttonClass(variant = 'primary') {
  return `button button--${variant === 'primary' ? 'primary' : 'ghost'}`;
}

// ===== js/core/Component.js =====
/**
 * Base Component class managing lifecycle, event listeners, and automatic resource cleanup.
 */

class Component {
  /**
   * @param {Object} deps
   * @param {Element|null} deps.root  the element this component owns
   * @param {import('../services/EventBus.js').EventBus} deps.bus
   * @param {import('../state/StateManager.js').StateManager} deps.state
   * @param {Object} [deps.content]  slice of content.json
   */
  constructor({ root, bus, state, content = null } = {}) {
    this.root = root ?? null;
    this.bus = bus;
    this.state = state;
    this.content = content;

    /** One controller per component instance. */
    const AC = (typeof window !== 'undefined' && window.AbortController) || AbortController;
    this.controller = new AC();
    /** Unsubscribe handles returned by bus.subscribe. */
    this._subscriptions = [];
    /** Observers (IntersectionObserver, MutationObserver, matchMedia…). */
    this._disposables = [];
    /** Timers — an outstanding timeout keeps its closure alive. */
    this._timers = new Set();

    this.destroyed = false;
    this.name = this.constructor.name;
  }

  /** Pass this to every addEventListener call. */
  get signal() {
    return this.controller.signal;
  }

  /**
   * Register a DOM listener bound to this component's lifetime.
   * There is no matching `off()` and that is intentional: individual removal is
   * what people forget. destroy() is the only teardown path.
   */
  listen(target, type, handler, options = {}) {
    if (!target) return this;
    target.addEventListener(type, handler, { ...options, signal: this.signal });
    return this;
  }

  /** Subscribe to a bus topic; the handle is stored for destroy(). */
  subscribe(topic, handler) {
    if (!this.bus) return () => {};
    const off = this.bus.subscribe(topic, handler);
    this._subscriptions.push(off);
    return off;
  }

  /** Subscribe to a state path. */
  observeState(path, handler) {
    return this.subscribe(`state:${path}`, handler);
  }

  /** Track anything with a disconnect()/close()/dispose() method. */
  track(disposable) {
    if (disposable) this._disposables.push(disposable);
    return disposable;
  }

  /** setTimeout that cannot outlive the component. */
  setTimeout(fn, delay) {
    const id = window.setTimeout(() => {
      this._timers.delete(id);
      if (!this.destroyed) fn();
    }, delay);
    this._timers.add(id);
    return id;
  }

  /** requestAnimationFrame loop guard — checks destroyed before each frame. */
  raf(callback) {
    const id = window.requestAnimationFrame((timestamp) => {
      if (!this.destroyed) callback(timestamp);
    });
    this.track({ disconnect: () => window.cancelAnimationFrame(id) });
    return id;
  }

  /** Subclasses override. Render + wire listeners here. */
  mount() {
    return this;
  }

  /** Subclasses override for extra teardown. Always call super.onDestroy(). */
  onDestroy() {}

  /**
   * Full teardown. Idempotent.
   * Order matters: run subclass teardown while the DOM is still intact, then
   * detach listeners, then drop references so the GC can reclaim the subtree.
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    try {
      this.onDestroy();
    } catch (error) {
      console.error(`[${this.name}] onDestroy threw:`, error);
    }

    // 1. Every DOM listener registered with this.listen(), in one call.
    this.controller.abort();

    // 2. Bus subscriptions — the bus holds strong references to these closures,
    //    so skipping this step leaks the entire component graph.
    this._subscriptions.forEach((off) => {
      try {
        off();
      } catch (error) {
        console.error(`[${this.name}] unsubscribe threw:`, error);
      }
    });
    this._subscriptions.length = 0;

    // 3. Observers. An IntersectionObserver holds its targets strongly; without
    //    disconnect() the observed nodes are never collected.
    this._disposables.forEach((item) => {
      try {
        if (typeof item.disconnect === 'function') item.disconnect();
        else if (typeof item.close === 'function') item.close();
        else if (typeof item.dispose === 'function') item.dispose();
        else if (typeof item === 'function') item();
      } catch (error) {
        console.error(`[${this.name}] disposable threw:`, error);
      }
    });
    this._disposables.length = 0;

    // 4. Pending timers keep their callback closures — and everything those
    //    closures capture — reachable until they fire.
    this._timers.forEach((id) => window.clearTimeout(id));
    this._timers.clear();

    // 5. Drop hard references so the detached subtree becomes collectable.
    this.root = null;
    this.content = null;
  }
}

/**
 * ComponentRegistry — owns every mounted component so app.js can tear the whole
 * page down with one call. Used by the heap-snapshot verification in the README.
 */
class ComponentRegistry {
  constructor() {
    this.components = new Map();
  }

  register(key, component) {
    if (this.components.has(key)) this.destroy(key);
    this.components.set(key, component);
    return component;
  }

  get(key) {
    return this.components.get(key) ?? null;
  }

  destroy(key) {
    const component = this.components.get(key);
    if (!component) return false;
    component.destroy();
    this.components.delete(key);
    return true;
  }

  destroyAll() {
    this.components.forEach((component) => component.destroy());
    this.components.clear();
  }

  get size() {
    return this.components.size;
  }
}

// ===== js/services/StorageService.js =====
/**
 * StorageService provides namespaced, safe localStorage access with fallback.
 */

const NAMESPACE = 'prodesk';
const SEPARATOR = ':';

/** Probe once at module load — feature-detect rather than user-agent sniff. */
function detectLocalStorage() {
  try {
    const probe = `${NAMESPACE}${SEPARATOR}__probe__`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

class StorageService {
  constructor({ namespace = NAMESPACE } = {}) {
    this.namespace = namespace;
    this.available = detectLocalStorage();
    /** Fallback store — keeps the app functional without persistence. */
    this._memory = new Map();

    if (!this.available) {
      console.warn(
        '[StorageService] localStorage unavailable (private mode or blocked cookies). ' +
          'Falling back to in-memory storage for this session.'
      );
    }
  }

  _key(key) {
    return `${this.namespace}${SEPARATOR}${key}`;
  }

  /**
   * Read and JSON-parse a namespaced key.
   * @param {string} key
   * @param {*} [fallback=null]
   */
  read(key, fallback = null) {
    const namespaced = this._key(key);
    try {
      const raw = this.available
        ? window.localStorage.getItem(namespaced)
        : this._memory.get(namespaced) ?? null;

      if (raw === null || raw === undefined) return fallback;
      return JSON.parse(raw);
    } catch (error) {
      // Corrupt payload — most likely a hand-edited value or a schema change
      // that shipped without a migration. Drop it rather than crash the boot.
      console.warn(`[StorageService] unreadable value at "${namespaced}", using fallback.`, error);
      this.remove(key);
      return fallback;
    }
  }

  /**
   * Serialise and persist a namespaced key.
   * @returns {boolean} true when the value actually reached localStorage.
   */
  write(key, value) {
    const namespaced = this._key(key);
    let serialised;

    try {
      serialised = JSON.stringify(value);
    } catch (error) {
      console.error(`[StorageService] value at "${namespaced}" is not serialisable.`, error);
      return false;
    }

    if (!this.available) {
      this._memory.set(namespaced, serialised);
      return false;
    }

    try {
      window.localStorage.setItem(namespaced, serialised);
      return true;
    } catch (error) {
      // QuotaExceededError (or NS_ERROR_DOM_QUOTA_REACHED on Firefox).
      // Degrade to memory instead of breaking the interaction that triggered it.
      console.warn(`[StorageService] write to "${namespaced}" failed; using memory.`, error);
      this.available = false;
      this._memory.set(namespaced, serialised);
      return false;
    }
  }

  remove(key) {
    const namespaced = this._key(key);
    try {
      if (this.available) window.localStorage.removeItem(namespaced);
    } catch {
      /* nothing meaningful to do */
    }
    this._memory.delete(namespaced);
  }

  /** Wipe only this app's keys. Never calls localStorage.clear(). */
  clearNamespace() {
    const prefix = `${this.namespace}${SEPARATOR}`;
    try {
      if (this.available) {
        const doomed = [];
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith(prefix)) doomed.push(key);
        }
        doomed.forEach((key) => window.localStorage.removeItem(key));
      }
    } catch (error) {
      console.warn('[StorageService] namespace clear failed.', error);
    }
    this._memory.clear();
  }

  /** Keys owned by this app, namespace stripped. Diagnostics only. */
  keys() {
    const prefix = `${this.namespace}${SEPARATOR}`;
    const found = [];
    try {
      if (this.available) {
        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith(prefix)) found.push(key.slice(prefix.length));
        }
      } else {
        this._memory.forEach((_, key) => found.push(key.slice(prefix.length)));
      }
    } catch {
      /* ignore */
    }
    return found;
  }
}

const storage = new StorageService();

// ===== js/services/ContentService.js =====
/**
 * ContentService fetches and validates content payload structure.
 */

const DEFAULT_URL = 'data/content.json';
const SUPPORTED_SCHEMA = 1;
const TIMEOUT_MS = 8000;

/** Every top-level key a render pass depends on. */
const REQUIRED_SECTIONS = [
  'meta',
  'nav',
  'hero',
  'features',
  'services',
  'why',
  'stats',
  'testimonials',
  'pricing',
  'faq',
  'contact',
  'footer'
];

class ContentError extends Error {
  constructor(message, { cause = null, kind = 'unknown' } = {}) {
    super(message);
    this.name = 'ContentError';
    this.cause = cause;
    this.kind = kind;
  }
}

class ContentService {
  constructor({ url = DEFAULT_URL, eventBus = bus } = {}) {
    this.url = url;
    this.bus = eventBus;
    this.content = null;
    /** In-flight promise, so two callers never trigger two network requests. */
    this._inflight = null;
  }

  /**
   * Fetch, parse, and validate. Resolves with the content object.
   * @param {{signal?: AbortSignal}} [options]
   */
  async load({ signal } = {}) {
    if (this.content) return this.content;
    if (this._inflight) return this._inflight;

    this._inflight = this._fetch({ signal })
      .then((content) => {
        this.content = content;
        this.bus.publish(TOPICS.CONTENT_LOADED, content);
        return content;
      })
      .catch((error) => {
        this.bus.publish(TOPICS.CONTENT_FAILED, error);
        throw error;
      })
      .finally(() => {
        this._inflight = null;
      });

    return this._inflight;
  }

  async _fetch({ signal }) {
    // Own timeout controller, chained to any caller-supplied signal, so a slow
    // network cannot hang the bootstrap indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    let response;
    try {
      response = await fetch(this.url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-cache'
      });
    } catch (error) {
      clearTimeout(timer);
      if (error.name === 'AbortError') {
        throw new ContentError(`Content request timed out after ${TIMEOUT_MS}ms.`, {
          cause: error,
          kind: 'timeout'
        });
      }
      // The overwhelmingly common cause is opening the page over file://.
      throw new ContentError(
        'Could not reach data/content.json. If you opened index.html directly from disk, ' +
          'serve the folder over HTTP instead (npx serve .).',
        { cause: error, kind: 'network' }
      );
    }
    clearTimeout(timer);

    if (!response.ok) {
      throw new ContentError(`content.json responded ${response.status} ${response.statusText}.`, {
        kind: 'http'
      });
    }

    let parsed;
    try {
      parsed = await response.json();
    } catch (error) {
      throw new ContentError('content.json is not valid JSON.', { cause: error, kind: 'parse' });
    }

    return this._validate(parsed);
  }

  /** Structural validation. Throws on anything a renderer would choke on. */
  _validate(content) {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      throw new ContentError('content.json must be a JSON object.', { kind: 'schema' });
    }

    if (Number(content.schemaVersion) !== SUPPORTED_SCHEMA) {
      throw new ContentError(
        `content.json schemaVersion ${content.schemaVersion} is unsupported (expected ${SUPPORTED_SCHEMA}).`,
        { kind: 'schema' }
      );
    }

    const missing = REQUIRED_SECTIONS.filter((key) => !content[key]);
    if (missing.length) {
      throw new ContentError(`content.json is missing: ${missing.join(', ')}.`, { kind: 'schema' });
    }

    const arrayChecks = [
      ['nav.links', content.nav.links],
      ['features.items', content.features.items],
      ['services.items', content.services.items],
      ['why.items', content.why.items],
      ['stats.items', content.stats.items],
      ['testimonials.items', content.testimonials.items],
      ['pricing.plans', content.pricing.plans],
      ['faq.items', content.faq.items],
      ['contact.fields', content.contact.fields],
      ['footer.groups', content.footer.groups]
    ];

    for (const [label, value] of arrayChecks) {
      if (!Array.isArray(value)) {
        throw new ContentError(`content.json: ${label} must be an array.`, { kind: 'schema' });
      }
    }

    // Ids are used as DOM ids and as state keys — duplicates would collide.
    const ids = [
      ...content.features.items,
      ...content.services.items,
      ...content.stats.items,
      ...content.pricing.plans,
      ...content.faq.items
    ].map((item) => item.id);

    const duplicates = ids.filter((id, index) => id && ids.indexOf(id) !== index);
    if (duplicates.length) {
      throw new ContentError(`content.json has duplicate ids: ${[...new Set(duplicates)].join(', ')}.`, {
        kind: 'schema'
      });
    }

    return content;
  }
}

const contentService = new ContentService();

// ===== js/state/schema.js =====
/**
 * State schema definitions, initial state values, and migration handlers.
 */

const STATE_VERSION = 1;

/** Single localStorage key. One read, one write, one thing to reason about. */
const STATE_KEY = 'app-state';

/** Theme is tri-state: 'system' is a real user choice, not the absence of one. */
const THEME = Object.freeze({
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system'
});

const SUBSCRIBE_STATUS = Object.freeze({
  IDLE: 'idle',
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error'
});

const DEFAULT_STATE = Object.freeze({
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
const TRANSIENT_PATHS = Object.freeze(['ui.navOpen', 'contact']);

/**
 * version -> upgrade function. Applied in ascending order.
 * Example for a future v2:
 *   2: (state) => ({ ...state, preferences: { ...state.preferences, locale: 'en' } })
 */
const MIGRATIONS = Object.freeze({});

/** Deep clone that does not share references with DEFAULT_STATE. */
function cloneDefaults() {
  return structuredClone
    ? structuredClone(DEFAULT_STATE)
    : JSON.parse(JSON.stringify(DEFAULT_STATE));
}

/**
 * Merge a persisted payload onto the defaults.
 * Unknown keys are dropped and missing keys are filled, so adding a field to
 * DEFAULT_STATE never breaks an existing user's stored state.
 */
function reconcile(defaults, stored) {
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
function migrate(stored) {
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

// ===== js/state/StateManager.js =====
/**
 * StateManager provides centralized reactive application state management.
 *
 * CONTRACT
 *  - get(path) returns a frozen read-only view; mutating it does nothing.
 *  - set(path, value) is the only write path, and it persists + publishes.
 *  - Writes are batched into a microtask so a burst of set() calls produces one
 *    localStorage write and one render pass, not N of each.
 */



function getPath(object, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

/** Immutable write: returns a new object graph along the mutated path only. */
function setPath(object, path, value) {
  const keys = path.split('.');
  const root = Array.isArray(object) ? [...object] : { ...object };
  let cursor = root;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const child = cursor[key];
    cursor[key] = Array.isArray(child) ? [...child] : { ...(child ?? {}) };
    cursor = cursor[key];
  }

  cursor[keys[keys.length - 1]] = value;
  return root;
}

function stripTransient(state) {
  const copy = structuredClone ? structuredClone(state) : JSON.parse(JSON.stringify(state));
  for (const path of TRANSIENT_PATHS) {
    const keys = path.split('.');
    const parent = keys.slice(0, -1).reduce((acc, key) => acc?.[key], copy);
    if (parent) delete parent[keys[keys.length - 1]];
  }
  return copy;
}

class StateManager {
  constructor({ eventBus = bus, storageService = storage } = {}) {
    this.bus = eventBus;
    this.storage = storageService;
    this._state = cloneDefaults();
    this._flushScheduled = false;
    this._pendingChanges = [];
    this._hydrated = false;
  }

  /**
   * Load persisted state. Must run before the first render — see app.js.
   * Failure here is non-fatal: the app boots on defaults.
   */
  hydrate() {
    const stored = this.storage.read(STATE_KEY, null);

    if (stored) {
      const migrated = migrate(stored);
      this._state = reconcile(cloneDefaults(), migrated);
      this._state.version = STATE_VERSION;
    }

    // Transient slices are rebuilt from defaults every boot, never restored.
    const defaults = cloneDefaults();
    this._state.ui.navOpen = defaults.ui.navOpen;
    this._state.contact = defaults.contact;

    // Visit counter — proof that persisted state survives a reload.
    this._state.session.visits = Number(this._state.session.visits || 0) + 1;
    this._state.session.lastVisitAt = new Date().toISOString();

    this._hydrated = true;
    this._persist();
    return this._state;
  }

  get hydrated() {
    return this._hydrated;
  }

  /**
   * Read state. Omit the path for the whole tree.
   * @param {string} [path] dot notation, e.g. 'preferences.theme'
   */
  get(path) {
    const value = path ? getPath(this._state, path) : this._state;
    return typeof value === 'object' && value !== null ? Object.freeze({ ...value }) : value;
  }

  /**
   * Write state. No-op when the value is unchanged, so publishing is never
   * triggered by a redundant write.
   * @param {string} path
   * @param {*} value
   * @param {{silent?: boolean}} [options]
   */
  set(path, value, { silent = false } = {}) {
    const previous = getPath(this._state, path);
    if (Object.is(previous, value)) return this._state;

    this._state = setPath(this._state, path, value);

    if (!silent) {
      this._pendingChanges.push({ path, value, previous });
      this._scheduleFlush();
    } else {
      this._persist();
    }

    return this._state;
  }

  /**
   * Apply several writes as one transaction — one persist, one publish.
   * @param {Record<string, *>} changes path -> value
   */
  patch(changes) {
    Object.entries(changes).forEach(([path, value]) => this.set(path, value));
    return this._state;
  }

  /**
   * Coalesce a burst of set() calls into a single flush.
   * Without this, toggling billing (which touches 3 paths) would write to
   * localStorage 3 times and force 3 render passes in the same frame.
   */
  _scheduleFlush() {
    if (this._flushScheduled) return;
    this._flushScheduled = true;

    queueMicrotask(() => {
      this._flushScheduled = false;
      const changes = this._pendingChanges;
      this._pendingChanges = [];
      if (!changes.length) return;

      this._persist();

      // Broad topic: anything that needs the full picture.
      this.bus.publish(TOPICS.STATE_CHANGED, { changes, state: this.get() });

      // Scoped topics: components subscribe only to what they care about, so a
      // FAQ toggle does not wake the theme toggle.
      changes.forEach(({ path, value, previous }) => {
        this.bus.publish(`state:${path}`, { value, previous });
      });
    });
  }

  _persist() {
    this.storage.write(STATE_KEY, stripTransient(this._state));
  }

  /** Wipe persisted state and reload. Wired to the ?reset query flag. */
  reset() {
    this.storage.remove(STATE_KEY);
    this._state = cloneDefaults();
    this.bus.publish(TOPICS.STATE_CHANGED, { changes: [], state: this.get() });
    return this._state;
  }

  /** Convenience subscription for one path. Returns an unsubscribe handle. */
  onChange(path, callback) {
    return this.bus.subscribe(`state:${path}`, callback);
  }
}

const state = new StateManager();

// ===== js/components/Navigation.js =====
/**
 * Navigation component managing responsive menu toggle, brand logo, and primary navigation links.
 */



const DESKTOP_QUERY = '(min-width: 48rem)'; /* 768px — matches style.css */

class Navigation extends Component {
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

// ===== js/components/ThemeToggle.js =====
/**
 * ThemeToggle component cycling theme preference between light, dark, and system modes.
 */



const ORDER = [THEME.LIGHT, THEME.DARK, THEME.SYSTEM];

const LABELS = {
  [THEME.LIGHT]: 'Theme: light. Switch to dark.',
  [THEME.DARK]: 'Theme: dark. Switch to system.',
  [THEME.SYSTEM]: 'Theme: system. Switch to light.'
};

class ThemeToggle extends Component {
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

// ===== js/components/HeroSection.js =====
/**
 * HeroSection component rendering the primary landing hero banner and key visual metrics.
 */


class HeroSection extends Component {
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

// ===== js/components/FeatureCards.js =====
/**
 * FeatureCards component rendering feature, service, and value-prop card grids.
 */


class FeatureCards extends Component {
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

// ===== js/components/StatCounters.js =====
/**
 * StatCounters component animating numerical metric statistics when scrolled into view.
 */



const DURATION_MS = 1400;

class StatCounters extends Component {
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

// ===== js/components/TestimonialCards.js =====
/**
 * TestimonialCards component rendering customer quotes and author metadata.
 */


class TestimonialCards extends Component {
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

// ===== js/components/PricingCards.js =====
/**
 * PricingCards component managing plan card renders, billing cycle toggles (monthly/annual), and price calculations.
 */



class PricingCards extends Component {
  constructor(deps) {
    super(deps);
    this.priceNodes = new Map();
    this.switchButton = null;
    this.noteNode = null;
  }

  mount() {
    if (!this.root || !this.content) return this;

    this.render();
    this.bindEvents();
    this.syncPrices(this.state.get('preferences.billingCycle'));
    return this;
  }

  render() {
    const c = this.content;
    this.priceNodes.clear();

    const header = el('header', { className: 'section__header section__header--center' }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title }),
      c.subtitle && el('p', { className: 'section__subtitle', text: c.subtitle })
    ]);

    this.switchButton = el('button', {
      className: 'button button--ghost pricing__switch',
      type: 'button',
      attrs: { 'aria-pressed': 'false' },
      text: c.billing?.annualLabel ?? 'Annual'
    });

    this.noteNode = el('p', { className: 'pricing__note', text: '' });

    const controls = el('div', { className: 'pricing__controls' }, [
      this.switchButton,
      this.noteNode
    ]);

    const grid = el('div', { className: 'pricing__grid' });

    const cards = c.plans.map((plan) => {
      const priceValue = el('p', { className: 'card__price-value', text: '' });
      const pricePeriod = el('p', { className: 'card__price-period', text: plan.period ?? '' });
      this.priceNodes.set(plan.id, { valueNode: priceValue, periodNode: pricePeriod, plan });

      return el('article', {
        className: `card card--pricing${plan.featured ? ' card--pricing-featured' : ''}`,
        dataset: { planId: plan.id }
      }, [
        el('h3', { className: 'card__title', text: plan.title }),
        el('div', { className: 'card__price' }, [priceValue, pricePeriod]),
        el('ul', { className: 'card__list' },
          (plan.features ?? []).map((feature) =>
            el('li', { className: 'card__list-item', text: feature })
          )
        ),
        el('a', {
          className: `${buttonClass(plan.cta.variant)} card__cta`,
          href: plan.cta.href,
          text: plan.cta.label,
          dataset: { planCta: plan.id }
        })
      ]);
    });

    grid.appendChild(frag(cards));
    replaceChildren(this.root, frag([header, controls, grid]));
    this.root.dataset.hydrated = 'true';
  }

  bindEvents() {
    this.listen(this.switchButton, 'click', () => {
      const current = this.state.get('preferences.billingCycle');
      this.state.set('preferences.billingCycle', current === 'annual' ? 'monthly' : 'annual');
    });

    this.observeState('preferences.billingCycle', ({ value }) => this.syncPrices(value));
  }

  syncPrices(cycle) {
    const annual = cycle === 'annual';
    const billing = this.content.billing ?? {};

    this.priceNodes.forEach(({ valueNode, periodNode, plan }) => {
      if (plan.customPrice) {
        valueNode.textContent = plan.customPrice;
        periodNode.textContent = '';
        return;
      }
      const amount = annual ? plan.priceAnnual : plan.priceMonthly;
      valueNode.textContent = `${plan.currency ?? '$'}${amount}`;
      periodNode.textContent = plan.period ?? '';
    });

    if (this.switchButton) {
      this.switchButton.textContent = annual
        ? billing.monthlyLabel ?? 'Monthly'
        : billing.annualLabel ?? 'Annual';
      this.switchButton.setAttribute('aria-pressed', String(annual));
    }

    if (this.noteNode) {
      this.noteNode.textContent = annual ? billing.annualNote ?? '' : '';
    }

    this.bus.publish(TOPICS.BILLING_CHANGED, { cycle });
  }

  onDestroy() {
    this.priceNodes.clear();
    this.switchButton = null;
    this.noteNode = null;
  }
}

// ===== js/components/FaqAccordion.js =====
/**
 * FaqAccordion component handling accordion panel expansion, keyboard navigation, and persisted open state.
 */



class FaqAccordion extends Component {
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

// ===== js/components/ContactForm.js =====
/**
 * ContactForm component handling validation and asynchronous form submission.
 */




const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class ContactForm extends Component {
  constructor(deps) {
    super(deps);
    this.form = null;
    this.submitButton = null;
    this.statusNode = null;
    this.fieldNodes = new Map();
  }

  mount() {
    if (!this.root || !this.content) return this;
    this.render();
    this.bindEvents();
    return this;
  }

  render() {
    const c = this.content;
    this.fieldNodes.clear();

    const header = el('header', { className: 'section__header' }, [
      c.eyebrow && el('p', { className: 'section__eyebrow', text: c.eyebrow }),
      el('h2', { className: 'section__title', text: c.title }),
      c.subtitle && el('p', { className: 'section__subtitle', text: c.subtitle })
    ]);

    const contentColumn = el('div', { className: 'contact-cta__content' }, [header]);

    this.form = el('form', {
      className: 'contact-cta__form',
      action: c.endpoint,
      method: 'POST',
      attrs: { novalidate: 'novalidate' }
    });

    const fields = c.fields.map((field) => this.renderField(field));

    this.submitButton = el('button', {
      className: 'button button--primary contact-cta__submit',
      type: 'submit',
      text: c.submitLabel
    });

    // aria-live so screen readers announce success and failure without focus moves.
    this.statusNode = el('p', {
      className: 'contact-cta__status',
      attrs: { role: 'status', 'aria-live': 'polite' },
      text: ''
    });

    this.form.appendChild(frag([...fields, this.submitButton, this.statusNode]));
    replaceChildren(this.root, frag([contentColumn, this.form]));
    this.root.dataset.hydrated = 'true';
  }

  renderField(field) {
    const errorId = `${field.id}-error`;

    const control =
      field.type === 'textarea'
        ? el('textarea', {
            className: 'contact-cta__input contact-cta__input--textarea',
            id: field.id,
            name: field.name,
            rows: field.rows ?? 4,
            placeholder: field.placeholder ?? '',
            attrs: { 'aria-describedby': errorId }
          })
        : el('input', {
            className: 'contact-cta__input',
            id: field.id,
            name: field.name,
            type: field.type,
            placeholder: field.placeholder ?? '',
            attrs: {
              autocomplete: field.autocomplete,
              'aria-describedby': errorId,
              'aria-required': field.required ? 'true' : null
            }
          });

    const errorNode = el('p', {
      className: 'contact-cta__error',
      id: errorId,
      attrs: { 'aria-live': 'polite' },
      text: ''
    });

    this.fieldNodes.set(field.name, { control, errorNode, field });

    return el('div', { className: 'contact-cta__field' }, [
      el('label', { className: 'contact-cta__label', htmlFor: field.id, text: field.label }),
      control,
      errorNode
    ]);
  }

  bindEvents() {
    this.listen(this.form, 'submit', (event) => {
      event.preventDefault();
      this.submit();
    });

    // Clear a field's error as soon as the user starts correcting it — one
    // delegated listener on the form, not one per input.
    this.listen(this.form, 'input', (event) => {
      const name = event.target?.name;
      const entry = this.fieldNodes.get(name);
      if (entry && entry.errorNode.textContent) {
        entry.errorNode.textContent = '';
        entry.control.removeAttribute('aria-invalid');
      }
    });
  }

  validate() {
    const errors = {};

    this.fieldNodes.forEach(({ control, errorNode, field }, name) => {
      const value = String(control.value ?? '').trim();
      let message = '';

      if (field.required && !value) {
        message = `${field.label} is required.`;
      } else if (field.type === 'email' && value && !CONTACT_EMAIL_PATTERN.test(value)) {
        message = 'Enter a valid email address, for example alex@company.com.';
      }

      errorNode.textContent = message;
      if (message) {
        control.setAttribute('aria-invalid', 'true');
        errors[name] = message;
      } else {
        control.removeAttribute('aria-invalid');
      }
    });

    return errors;
  }

  async submit() {
    const errors = this.validate();
    this.state.set('contact.errors', errors);

    if (Object.keys(errors).length) {
      this.state.set('contact.status', SUBSCRIBE_STATUS.ERROR);
      this.statusNode.textContent = 'Check the highlighted fields and try again.';
      // Move focus to the first invalid control so keyboard users are not lost.
      this.form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    this.setPending(true);
    this.state.set('contact.status', SUBSCRIBE_STATUS.PENDING);
    this.statusNode.textContent = '';

    try {
      const response = await fetch(this.content.endpoint, {
        method: 'POST',
        body: new FormData(this.form),
        headers: { Accept: 'application/json' },
        signal: this.signal // aborted by destroy() — no callback on a dead component
      });

      if (!response.ok) throw new Error(`Request failed with ${response.status}`);

      this.state.set('contact.status', SUBSCRIBE_STATUS.SUCCESS);
      this.submitButton.textContent = this.content.successLabel;
      this.statusNode.textContent = "Thanks — we'll be in touch within one business day.";
      this.form.reset();
      this.bus.publish(TOPICS.CONTACT_STATUS, { status: SUBSCRIBE_STATUS.SUCCESS });
    } catch (error) {
      // AbortError means the component was destroyed mid-flight. Not a failure.
      if (error.name === 'AbortError') return;

      console.error('[ContactForm] submission failed:', error);
      this.state.set('contact.status', SUBSCRIBE_STATUS.ERROR);
      // Says what went wrong and what to do — no alert(), no vague apology.
      this.statusNode.textContent =
        'We could not send your request. Check your connection and try again, or email hello@prodesk.cloud.';
      this.bus.publish(TOPICS.CONTACT_STATUS, { status: SUBSCRIBE_STATUS.ERROR, error });
    } finally {
      this.setPending(false);
    }
  }

  setPending(isPending) {
    if (!this.submitButton) return;
    this.submitButton.disabled = isPending;
    this.submitButton.setAttribute('aria-busy', String(isPending));
    if (isPending) this.submitButton.textContent = this.content.submittingLabel;
    else if (this.state.get('contact.status') !== SUBSCRIBE_STATUS.SUCCESS) {
      this.submitButton.textContent = this.content.submitLabel;
    }
  }

  onDestroy() {
    this.fieldNodes.clear();
    this.form = null;
    this.submitButton = null;
    this.statusNode = null;
  }
}

// ===== js/components/FooterSection.js =====
/**
 * FooterSection component managing footer navigation links, newsletter subscription, and dynamic copyright year.
 */




const SUBSCRIBE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class FooterSection extends Component {
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

// ===== js/app.js =====
/**
 * Main application entrypoint and lifecycle coordinator.
 * Manages state initialization, content loading, component mounting, and global events.
 */















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

app;

})();
