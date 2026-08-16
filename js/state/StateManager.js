/**
 * StateManager provides centralized reactive application state management.
 *
 * CONTRACT
 *  - get(path) returns a frozen read-only view; mutating it does nothing.
 *  - set(path, value) is the only write path, and it persists + publishes.
 *  - Writes are batched into a microtask so a burst of set() calls produces one
 *    localStorage write and one render pass, not N of each.
 */

import { bus, TOPICS } from '../services/EventBus.js';
import { storage } from '../services/StorageService.js';
import {
  STATE_KEY,
  STATE_VERSION,
  TRANSIENT_PATHS,
  cloneDefaults,
  reconcile,
  migrate
} from './schema.js';

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

export class StateManager {
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

export const state = new StateManager();
