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

export class StorageService {
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

export const storage = new StorageService();
