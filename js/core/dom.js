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
export function el(tag, props = {}, children = []) {
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
export function appendAll(parent, children) {
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
export function frag(children = []) {
  const fragment = document.createDocumentFragment();
  appendAll(fragment, children);
  return fragment;
}

/** Safe text node. */
export function text(value) {
  return document.createTextNode(String(value ?? ''));
}

/**
 * Empty a container.
 * removeChild in a loop rather than innerHTML = '': it is safe, and it lets the
 * caller run teardown per node if needed before detaching.
 */
export function clear(node) {
  if (!node) return node;
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a container's children in a single mutation. */
export function replaceChildren(node, children) {
  clear(node);
  appendAll(node, frag(children));
  return node;
}

/** Query helpers that never throw on a missing node. */
export const qs = (selector, scope = document) => scope.querySelector(selector);
export const qsa = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/** Map a card variant name to its button class. */
export function buttonClass(variant = 'primary') {
  return `button button--${variant === 'primary' ? 'primary' : 'ghost'}`;
}
