/**
 * Lightweight, dependency-free event bus for decoupled component messaging.
 */
export class EventBus {
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
export const TOPICS = Object.freeze({
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
export const bus = new EventBus({
  debug: new URLSearchParams(location.search).has('debug')
});
