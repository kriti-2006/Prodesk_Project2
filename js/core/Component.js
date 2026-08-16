/**
 * Base Component class managing lifecycle, event listeners, and automatic resource cleanup.
 */

export class Component {
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
export class ComponentRegistry {
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
