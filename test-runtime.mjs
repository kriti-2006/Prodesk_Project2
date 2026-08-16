import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const ROOT = process.cwd();
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const consoleErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => consoleErrors.push(`jsdomError: ${e.message}`));
vc.on('error', (...a) => consoleErrors.push(`console.error: ${a.join(' ')}`));

// runScripts:'dangerously' executes the inline pre-paint theme script.
// The type="module" tag is ignored by jsdom, so we import the graph ourselves below.
const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), {
  url: `${BASE}/index.html`,
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc
});

const { window } = dom;

// --- shims for APIs jsdom lacks ---
window.matchMedia = (query) => {
  const target = new window.EventTarget();
  target.media = query;
  target.matches = false; // simulate a LIGHT-preference OS
  target.addListener = () => {};
  target.removeListener = () => {};
  return target;
};
window.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; this.disconnected = false; }
  observe() { this.cb([{ isIntersecting: true }]); }
  unobserve() {}
  disconnect() { this.disconnected = true; }
};
window.requestAnimationFrame = (fn) => Number(global.setTimeout(() => fn(performance.now()), 8));
window.cancelAnimationFrame = (id) => global.clearTimeout(id);
const nativeFetch = globalThis.fetch;
window.fetch = (input, init) => nativeFetch(new URL(String(input), `${BASE}/`).href, init);
Object.defineProperty(window, 'performance', { value: performance, configurable: true });
window.structuredClone = structuredClone;
window.queueMicrotask = queueMicrotask;
window.scrollTo = () => {};

// Promote to globals so the modules resolve `window`, `document`, `fetch`, etc.
for (const key of [
  'window', 'document', 'navigator', 'location', 'localStorage', 'fetch',
  'requestAnimationFrame', 'cancelAnimationFrame', 'IntersectionObserver',
  'AbortController', 'FormData', 'Node', 'Element', 'HTMLElement',
  'MouseEvent', 'Event', 'EventTarget', 'CustomEvent', 'DocumentFragment'
]) {
  const value = key === 'window' ? window : window[key];
  try { globalThis[key] = value; }
  catch { Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
}

// Stub the Formspree endpoint so form submits exercise the success path offline.
const localFetch = window.fetch;
const patchedFetch = (input, init) => {
  const opts = init ? { ...init } : {};
  if (opts.signal && !(opts.signal instanceof global.AbortSignal)) {
    delete opts.signal;
  }
  if (String(input).includes('formspree.io')) {
    return Promise.resolve(new Response('{}', { status: 200 }));
  }
  return localFetch(input, opts);
};
window.fetch = patchedFetch;
Object.defineProperty(globalThis, 'fetch', { value: patchedFetch, configurable: true, writable: true });

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// ---------------- BOOT ----------------
const themeClassAtParse = window.document.documentElement.className;
check('pre-paint script applied theme before modules ran',
  /theme--(light|dark)/.test(themeClassAtParse) && themeClassAtParse.includes('no-transitions'),
  themeClassAtParse);

const appModule = await import(`${ROOT}/js/app.js`);
await tick(400);

const api = window.__PRODESK__;
const doc = window.document;

check('app exposed on window', !!api);
check('appReady flag set', doc.documentElement.dataset.appReady === 'true');
check('no-transitions guard released', !doc.documentElement.classList.contains('no-transitions'));

// ---------------- PHASE 1: hydration ----------------
const counts = {
  navLinks: doc.querySelectorAll('.nav__link').length,
  featureCards: doc.querySelectorAll('.card--feature').length,
  serviceCards: doc.querySelectorAll('.card--service').length,
  whyItems: doc.querySelectorAll('.why__item').length,
  stats: doc.querySelectorAll('.stat').length,
  testimonials: doc.querySelectorAll('.card--testimonial').length,
  pricing: doc.querySelectorAll('.card--pricing').length,
  faq: doc.querySelectorAll('.faq__item').length,
  contactFields: doc.querySelectorAll('.contact-cta__field').length,
  footerGroups: doc.querySelectorAll('.footer__nav-group').length
};
const expected = { navLinks: 5, featureCards: 3, serviceCards: 3, whyItems: 3, stats: 4, testimonials: 2, pricing: 3, faq: 3, contactFields: 4, footerGroups: 3 };
check('all sections hydrated with correct counts',
  JSON.stringify(counts) === JSON.stringify(expected), JSON.stringify(counts));

check('hero title from JSON',
  doc.querySelector('.hero__title')?.textContent === 'Enterprise analytics for modern teams');
check('theme toggle rendered by Navigation', !!doc.querySelector('.theme-toggle'));

const jsFiles = [];
(function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p) : e.name.endsWith('.js') && jsFiles.push(p);
  });
})(path.join(ROOT, 'js'));
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const offenders = jsFiles.filter((f) => stripComments(fs.readFileSync(f, 'utf8')).includes('innerHTML'));
check('zero innerHTML in executable code',
  offenders.length === 0, `${jsFiles.length} files scanned, ${offenders.length} offenders`);

// XSS boundary: injected markup must render as literal text, never as a node.
const probe = doc.createElement('div');
const { el } = await import(`${ROOT}/js/core/dom.js`);
probe.appendChild(el('p', { text: '<img src=x onerror="alert(1)">' }));
check('el() escapes markup (textContent, not innerHTML)',
  probe.querySelector('img') === null && probe.textContent.includes('<img'));

// ---------------- PHASE 2: persistence ----------------
api.state.set('preferences.theme', 'dark');
await tick();
check('theme state drives DOM class', doc.documentElement.classList.contains('theme--dark'));
check('theme--light removed when dark', !doc.documentElement.classList.contains('theme--light'));

let stored = JSON.parse(window.localStorage.getItem('prodesk:app-state'));
check('single namespaced storage key', window.localStorage.getItem('prodesk:app-state') !== null);
check('theme persisted', stored.preferences.theme === 'dark');
check('schema version persisted', stored.version === 1);
check('visit counter incremented', stored.session.visits === 1, `visits=${stored.session.visits}`);
check('transient ui.navOpen stripped', stored.ui.navOpen === undefined);
check('transient contact slice stripped', stored.contact === undefined);

// LIGHT ON DARK-OS REGRESSION — the Sprint 1 bug.
api.state.set('preferences.theme', 'light');
await tick();
check('BUGFIX: explicit light applies .theme--light',
  doc.documentElement.classList.contains('theme--light') &&
  !doc.documentElement.classList.contains('theme--dark'));
check('BUGFIX: color-scheme follows theme', doc.documentElement.style.colorScheme === 'light');

// ---------------- FAQ (delegation + persistence) ----------------
const faqBtn = doc.querySelector('.faq__button');
faqBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('FAQ opens through one delegated listener', faqBtn.getAttribute('aria-expanded') === 'true');
check('FAQ open id persisted',
  JSON.parse(window.localStorage.getItem('prodesk:app-state')).ui.openFaqId === 'faq-golive');

faqBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('FAQ closes on second click', faqBtn.getAttribute('aria-expanded') === 'false');

// ---------------- Pricing state mutation ----------------
const before = doc.querySelector('[data-plan-id="plan-growth"] .card__price-value').textContent;
doc.querySelector('.pricing__switch').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
const after = doc.querySelector('[data-plan-id="plan-growth"] .card__price-value').textContent;
check('billing toggle mutates prices', before === '$49' && after === '$39', `${before} -> ${after}`);
check('billing cycle persisted',
  JSON.parse(window.localStorage.getItem('prodesk:app-state')).preferences.billingCycle === 'annual');
check('enterprise custom price preserved',
  doc.querySelector('[data-plan-id="plan-enterprise"] .card__price-value').textContent === "Let's talk");

// ---------------- Counters ----------------
await tick(1800); // count-up runs for 1400ms
const finals = ['stat-uptime', 'stat-speed', 'stat-adoption', 'stat-migrated']
  .map((id) => doc.querySelector(`p.stat__value[data-stat-id="${id}"]`).textContent);
check('stat counters animate to exact final values',
  JSON.stringify(finals) === JSON.stringify(['99.99%', '2.5x', '45%', '+120']),
  finals.join(', '));
check('statsRevealed persisted',
  JSON.parse(window.localStorage.getItem('prodesk:app-state')).session.statsRevealed === true);

// ---------------- Nav ----------------
doc.querySelector('.nav__toggle').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('nav toggle opens menu', doc.querySelector('.nav__menu').classList.contains('nav__menu--open'));
check('nav aria-expanded synced', doc.querySelector('.nav__toggle').getAttribute('aria-expanded') === 'true');

// ---------------- Validation ----------------
const contactForm = doc.querySelector('.contact-cta__form');
contactForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
check('contact form blocks empty submit with inline errors',
  doc.querySelectorAll('.contact-cta__error').length === 4 &&
  doc.querySelector('#contact-name-error').textContent.includes('required'));

doc.querySelector('#contact-name').value = 'Alex Rivera';
doc.querySelector('#contact-email').value = 'not-an-email';
doc.querySelector('#contact-company').value = 'Acme';
contactForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick();
check('email format rejected',
  doc.querySelector('#contact-email-error').textContent.includes('valid email'));

doc.querySelector('#contact-email').value = 'alex@company.com';
contactForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
await tick(200);
check('valid contact submit reaches success state',
  api.state.get('contact.status') === 'success', api.state.get('contact.status'));

// ---------------- EventBus ----------------
let hits = 0;
const off = api.bus.subscribe('test:topic', () => { hits += 1; });
api.bus.publish('test:topic', {});
check('subscribe + publish delivers', hits === 1);
off();
api.bus.publish('test:topic', {});
check('unsubscribe handle detaches', hits === 1, `hits=${hits}`);
check('empty topic bucket deleted', !api.bus.topics().includes('test:topic'));

api.bus.subscribe('test:throw', () => { throw new Error('boom'); });
let survived = false;
api.bus.subscribe('test:throw', () => { survived = true; });
api.bus.publish('test:throw', {});
check('throwing subscriber does not block others', survived);
api.bus.clear('test:throw');

let onceCount = 0;
api.bus.once('test:once', () => { onceCount += 1; });
api.bus.publish('test:once', {});
api.bus.publish('test:once', {});
check('once() auto-detaches', onceCount === 1);

const liveTopics = api.bus.listenerCount();
check('bus has live component subscriptions before teardown', liveTopics > 0, `${liveTopics} topics`);

// ---------------- PHASE 3: teardown ----------------
const registrySize = api.app.registry.size;
check('12 components registered', registrySize === 12, `size=${registrySize}`);

const navComponent = api.app.registry.get('navigation');
const themeComponent = api.app.registry.get('themeToggle');

api.app.destroy();
await tick();

check('registry emptied on destroy', api.app.registry.size === 0);
check('components flagged destroyed', navComponent.destroyed && themeComponent.destroyed);
check('AbortController signal aborted', navComponent.controller.signal.aborted);
check('bus fully drained', api.bus.listenerCount() === 0, `${api.bus.listenerCount()} topics remain`);
check('component root references released', navComponent.root === null);

// Post-teardown: a click must be inert (listeners detached, not just ignored).
const themeBefore = doc.documentElement.className;
doc.querySelector('.nav__toggle')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await tick();
check('detached listeners no longer fire', doc.documentElement.className === themeBefore);

check('no runtime errors during full lifecycle',
  consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// ---------------- report ----------------
console.log('\n══════════════ RUNTIME VERIFICATION ══════════════');
results.forEach((r) =>
  console.log(`${r.pass ? '✓' : '✗'}  ${r.name}${r.detail ? `\n     └─ ${r.detail}` : ''}`));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);

server.close();
process.exit(failed.length ? 1 : 0);
