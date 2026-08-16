# Prodesk Cloud — Sprint 02 Engineering Documentation

State injection, persistence, and memory-safe component architecture.

---

## Running the project

`content.json` is loaded with the Fetch API. **Browsers block `fetch()` on `file://` URLs**, and ES modules are subject to the same restriction, so opening `index.html` by double-clicking will show the content-error screen.

Serve the folder over HTTP:

```bash
npx serve .
# or
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

Diagnostic flags:

| URL | Effect |
|---|---|
| `?debug` | EventBus logs every subscribe / unsubscribe / publish to the console |

---

## 1. Architecture

```
PRODESK/
├── index.html              structure + mount points only; blocking pre-paint theme script
├── style.css               4-layer theme cascade + .no-transitions guard
│
├── data/
│   └── content.json        every string on the page; schemaVersion 1
│
└── js/
    ├── state/
    │   ├── schema.js       STATE_VERSION, DEFAULT_STATE, TRANSIENT_PATHS, migrations
    │   └── StateManager.js single source of truth; immutable writes; batched flush
    │
    ├── services/
    │   ├── EventBus.js     subscribe / unsubscribe / publish / once
    │   ├── StorageService.js namespaced, quota-safe, in-memory fallback
    │   └── ContentService.js fetch + validate content.json (the trust boundary)
    │
    ├── core/
    │   ├── Component.js    lifecycle base class; one AbortController per instance
    │   └── dom.js          el / frag / appendAll / replaceChildren — no innerHTML path
    │
    ├── components/         12 components, each owning one mount point
    └── app.js              composition root; 5 explicit boot phases
```

### Data flow — one direction only

```
  user event
      │
      ▼
  component handler ──► state.set(path, value)
                             │
                             ├──► StorageService.write()   (persist)
                             │
                             └──► bus.publish('state:<path>')
                                        │
                                        ▼
                             subscribed components re-render
```

No component reads truth out of the DOM. The DOM is a render target, never a database.

---

## 2. State schema

Persisted under the single key **`prodesk:app-state`**.

```jsonc
{
  "version": 1,
  "preferences": {
    "theme": "system",          // 'light' | 'dark' | 'system'
    "billingCycle": "monthly",  // 'monthly' | 'annual'
    "reducedMotion": false
  },
  "ui": {
    "navOpen": false,           // TRANSIENT — stripped before write
    "openFaqId": null           // persisted
  },
  "subscription": {
    "status": "idle",           // 'idle' | 'pending' | 'success' | 'error'
    "email": null,
    "updatedAt": null
  },
  "contact": {                  // TRANSIENT — stripped before write
    "status": "idle",
    "errors": {}
  },
  "session": {
    "visits": 0,
    "lastVisitAt": null,
    "statsRevealed": false
  }
}
```

**Transient paths** (`ui.navOpen`, `contact`) are removed by `stripTransient()` before every write. Restoring an open hamburger menu on a fresh load is disorienting, and an in-flight form status must never survive a reload.

**Versioning.** `migrate()` runs every migration newer than the stored payload's version, then `reconcile()` deep-merges it onto `DEFAULT_STATE`. Adding a field to the schema therefore never breaks a returning user, and unknown keys from an older build are dropped.

### Initialization flow

| Phase | Where | What |
|---|---|---|
| 0 | inline `<head>` script | Read theme from localStorage, apply `.theme--light` / `.theme--dark` **before first paint** |
| 1 | `StorageService` module load | Feature-detect localStorage; select memory fallback if blocked |
| 2 | `app.start()` | `state.hydrate()` — migrate, reconcile, increment visit counter, strip transients |
| 3 | `app.start()` | `contentService.load()` — fetch, parse, validate `content.json` |
| 4 | `app.mountComponents()` | Construct 12 components; render; wire listeners |
| 5 | `app.releaseTransitionGuard()` | Remove `.no-transitions` after two rAFs; publish `app:ready` |

Phase 2 completes before any render. Nothing paints with defaults and then corrects itself.

---

## 3. Theme persistence and the flicker fix

### The Sprint 1 bug

`:root` held **dark** colours as the bare default; light colours existed only inside `@media (prefers-color-scheme: light)`; and there was **no `.theme--light` class at all**. On a machine whose OS was set to dark, choosing "Light" removed `.theme--dark` and left the dark `:root` values in place — the light theme silently did nothing. The preference saved correctly; it just never rendered.

### The fix — a four-layer cascade

```css
:root                              { /* structural tokens + LIGHT baseline */ }
@media (prefers-color-scheme: dark) { :root { /* DARK, when no explicit choice */ } }
.theme--light                      { /* EXPLICIT choice — always wins */ }
.theme--dark                       { /* EXPLICIT choice — always wins */ }
```

Layers 2 and 3 have equal specificity `(0,1,0)`, so **source order decides** — the explicit classes must stay below the media query. `color-scheme` is set alongside so native scrollbars, form controls, and autofill follow the theme.

### Flicker prevention — two mechanisms

1. **Pre-paint restoration.** A blocking inline script in `<head>` reads `prodesk:app-state` and applies the theme class synchronously, before the first pixel is drawn. Sprint 1 applied it inside `DOMContentLoaded` in a deferred script — far too late.
2. **Transition guard.** `style.css` transitions `background-color` over 220ms on `body` and a dozen other selectors, so applying a theme class on load *animates as a visible fade*. `<html class="no-transitions">` suppresses all transitions until `app.js` removes it after two animation frames.

Either mechanism alone leaves a visible artefact. Both are required.

---

## 4. Memory leak prevention

### Where the leaks were

`script.js` contained **5 `addEventListener` calls and 0 `removeEventListener` calls.**

| # | Leak site | Sprint 1 line | Why it leaked |
|---|---|---|---|
| 1 | `window` resize | L36 | `window` outlives the page content. The handler closure captured `menu` and `toggle`, pinning those nodes for the session |
| 2 | `matchMedia` change | L75 | The MediaQueryList is owned by the browser and never garbage collected. Its listener pinned everything the closure captured |
| 3 | N nav-link clicks | L31–33 | One listener per link. Re-rendering the menu would detach the nodes while the handlers kept them reachable |
| 4 | N FAQ button clicks | L93 | Each closure captured `buttons` — a **live NodeList** — plus `panel`, for the page lifetime |
| 5 | Form submit | L125 | Held the form element and an in-flight fetch with no abort path |

**Why cleanup is required.** A listener is a strong reference from the event target to the handler function, and the handler closes over its component. Remove a node from the DOM without detaching its listeners and you get a *detached DOM tree*: the node is invisible but unreachable by the collector, because the listener chain still points at it. Do this on every re-render and memory grows monotonically until the tab is killed.

This is not hypothetical for Sprint 02 specifically: JSON hydration means re-rendering, and re-rendering without teardown is exactly the pattern that produces detached trees.

### Before / after

**Before — Sprint 1 `script.js`**

```javascript
function on(el, event, fn) {
  if (el) el.addEventListener(event, fn);   // registers, never tracks
}

function initFAQ() {
  const buttons = document.querySelectorAll('.faq__button');   // live NodeList, captured

  buttons.forEach(btn => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));

    on(btn, 'click', () => {
      const opening = btn.getAttribute('aria-expanded') !== 'true';
      if (opening) {
        buttons.forEach(other => {                              // O(n²) DOM lookups
          const otherPanel = document.getElementById(other.getAttribute('aria-controls'));
          other.setAttribute('aria-expanded', 'false');
          otherPanel?.classList.remove('faq__panel--open');
        });
      }
      btn.setAttribute('aria-expanded', String(opening));       // DOM is the state
      panel.classList.toggle('faq__panel--open', opening);
    });
  });
}
// no teardown anywhere in the file
```

**After — `core/Component.js` + `components/FaqAccordion.js`**

```javascript
// Component.js — cleanup is structural, not remembered
export class Component {
  constructor({ root, bus, state, content }) {
    this.controller = new AbortController();   // ONE controller per instance
    this._subscriptions = [];
    this._disposables = [];
    this._timers = new Set();
  }

  get signal() { return this.controller.signal; }

  listen(target, type, handler, options = {}) {
    if (!target) return this;
    // Every listener is bound to the component's lifetime at registration time.
    target.addEventListener(type, handler, { ...options, signal: this.signal });
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.onDestroy();

    this.controller.abort();                        // 1. ALL DOM listeners, atomically
    this._subscriptions.forEach((off) => off());    // 2. bus subscriptions
    this._disposables.forEach((d) => d.disconnect?.());  // 3. observers
    this._timers.forEach((id) => clearTimeout(id)); // 4. pending timers
    this.root = null;                               // 5. drop hard references
    this.content = null;
  }
}
```

```javascript
// FaqAccordion.js — ONE delegated listener replaces N, and it is tracked
bindEvents() {
  this.listen(this.list, 'click', (event) => {
    const button = event.target.closest('.faq__button');
    if (!button) return;
    const open = this.state.get('ui.openFaqId');
    this.state.set('ui.openFaqId', open === button.dataset.faqId ? null : button.dataset.faqId);
  });

  this.observeState('ui.openFaqId', ({ value }) => this.sync(value));  // handle stored
}
```

**Explicit `removeEventListener` equivalents.** `AbortController.abort()` is the spec-defined bulk form of `removeEventListener`. The direct calls it replaces are:

```javascript
// What the framework does for you on destroy():
target.removeEventListener('click',  handler);
window.removeEventListener('resize', handler);
mediaQuery.removeEventListener('change', handler);

// And the equivalent one-liner, which cannot be partially forgotten:
this.controller.abort();
```

Individual removal is what people forget, and forgetting one is invisible until a heap snapshot. There is deliberately no `off()` method on `Component` — `destroy()` is the only teardown path.

### Five categories handled

| Category | Retained by | Cleanup |
|---|---|---|
| DOM listeners | event target → handler → closure | `controller.abort()` |
| Bus subscriptions | `EventBus._topics` Map → callback → component | stored unsubscribe handles, drained |
| `IntersectionObserver` | observer holds **strong** refs to observed nodes | `this.track(observer)` → `disconnect()` |
| `requestAnimationFrame` | self-rescheduling loop writing to detached nodes | `cancelAnimationFrame` + `this.destroyed` guard each frame |
| In-flight `fetch` | promise chain → component | `signal: this.signal`; `AbortError` swallowed |

### Verified by automated test

```
✓  12 components registered
✓  registry emptied on destroy
✓  components flagged destroyed
✓  AbortController signal aborted
✓  bus fully drained                    [0 topics remain]
✓  component root references released
✓  detached listeners no longer fire
```

---

## 5. DevTools verification guide

Serve the project, then open `http://localhost:5173`.

### A. Event listener audit

1. **F12** → **Elements**.
2. Select `<div class="faq__list">` in the tree.
3. Open the **Event Listeners** tab in the right pane.
4. Untick **Ancestors** so only listeners on this node are shown.

**Expected:** exactly **one** `click` listener on `.faq__list`, regardless of how many FAQ items exist. Select an individual `.faq__button` — with Ancestors off it has **zero** listeners.

*Sprint 1 comparison:* each `.faq__button` carried its own `click` listener — 3 items meant 3 listeners, 20 items would mean 20.

5. Repeat on `.nav__menu` — one delegated `click` listener for all five nav links.

### B. Listener count over interaction

In the **Console**:

```javascript
__PRODESK__.bus.listenerCount();   // topic count
__PRODESK__.bus.topics();          // which topics are live
```

Toggle the theme 20 times, open and close every FAQ, flip billing back and forth, then re-run. **Expected: identical numbers.** Interaction publishes on existing topics; it never registers new ones.

### C. Heap snapshot — the leak proof

1. **Memory** tab → **Heap snapshot** → **Take snapshot**. Label this **Snapshot 1**.
2. Trigger work: toggle the theme 10×, open every FAQ, flip billing 10×, scroll the stats into view, resize the window across the 768px breakpoint 5×.
3. Destroy every component from the Console:
   ```javascript
   __PRODESK__.app.destroy();
   ```
4. Force collection: click the **🗑 (Collect garbage)** icon in the Memory toolbar, twice.
5. **Take snapshot** → **Snapshot 2**.
6. Set the dropdown from *Summary* to **Comparison**, with Snapshot 1 as the baseline.

**What to look for:**

| Check | Expected result |
|---|---|
| Filter the class list for `Detached` | **Zero** `Detached HTMLDivElement` / `Detached HTMLButtonElement` entries retained |
| `#Delta` column for `Component` subclasses | **Negative or 0** — instances released, not accumulated |
| Total JS heap, Snapshot 2 vs 1 | Within noise of baseline; **no monotonic growth** |
| Retainers of any surviving node | Must not show `EventBus._topics` or an `AbortSignal` in the chain |

**Optional — the definitive check.** Before step 3, take a reference:

```javascript
const nav = __PRODESK__.app.registry.get('navigation');
```

Then `__PRODESK__.app.destroy()`, collect garbage, and inspect: `nav.root === null`, `nav.controller.signal.aborted === true`, `nav.destroyed === true`. Drop the variable (`nav = null`), collect again, and the instance disappears from the next snapshot.

### D. Allocation instrumentation (continuous growth check)

1. **Memory** → **Allocation instrumentation on timeline** → **Start**.
2. Toggle the theme continuously for ~30 seconds.
3. **Stop.**

**Expected:** blue allocation bars that turn grey as objects are collected. **Sustained blue bars that never grey out indicate a retained allocation** — the failure signature.

### E. Flicker verification

1. **Network** tab → throttle to **Slow 3G**.
2. Set the theme to Dark, then hard-reload (**Ctrl/Cmd + Shift + R**).
3. **Performance** tab → record with **Screenshots** enabled → reload.

**Expected:** every screenshot frame from the very first paint is dark. No white flash, no fade transition. Inspect `<html>` in Elements during load — `class="no-transitions theme--dark"` is present before any content renders.

### F. State persistence

1. **Application** → **Storage** → **Local Storage** → your origin.
2. Confirm exactly **one** key: `prodesk:app-state`.
3. Change the theme, open a FAQ, switch to annual billing. Watch the value update live.
4. Reload. Confirm `session.visits` increments and every choice is restored.
5. Confirm `ui.navOpen` and `contact` are **absent** from the stored payload — transient state is stripped.

---

## 6. Security posture

| Control | Implementation |
|---|---|
| XSS | **Zero `innerHTML`** in executable code across all 18 modules — verified by automated scan. `dom.js` offers no raw-markup path; all text goes through `textContent` |
| Untrusted content | `ContentService` validates `content.json` at one boundary: schema version, required sections, array shapes, duplicate ids |
| Injection proof | Automated test asserts `el('p', { text: '<img src=x onerror=alert(1)>' })` renders as literal text and creates no `<img>` node |
| Unhandled rejections | Every `fetch` is wrapped in `try/catch/finally` with an explicit `AbortError` branch. Sprint 1's `await fetch(...)` had none |
| Form validation | Real inline validation with `aria-invalid` and `aria-live` errors. Sprint 1 had `novalidate` and no JS handler — no validation at all |
| Error UX | Status regions with actionable copy. `alert()` removed |
| Outbound links | `rel="noopener noreferrer"` on all social links |
| Storage | Namespaced under `prodesk:`; `clearNamespace()` never calls `localStorage.clear()` |

---

## 7. Performance notes

| Change | Effect |
|---|---|
| `DocumentFragment` batching | One reflow per grid instead of one per card |
| Event delegation | 1 listener replaces N on FAQ and nav |
| Cached panel refs | FAQ toggle is a `Map` lookup; Sprint 1 ran O(n²) `getElementById` calls per click |
| `matchMedia` over `resize` | Fires only when the breakpoint is actually crossed; Sprint 1 read `window.innerWidth` on every resize event (forced layout, unthrottled) |
| Batched state flush | A 3-path `patch()` produces one localStorage write and one render pass, not three |
| Targeted re-render | Billing toggle rewrites only price text nodes; cards are never rebuilt, so no listener is orphaned |
| `prefers-reduced-motion` | Count-up animation snaps to final values |

---

## 8. Test suite

Two Node + jsdom harnesses cover the full lifecycle.

```bash
npm install jsdom
node test-runtime.mjs   # 46 checks — boot, hydration, state, bus, teardown
node test-reload.mjs    #  9 checks — persistence across a simulated second load
```

**55/55 passing.** The reload harness seeds `localStorage` with a returning user's state, executes the inline pre-paint script exactly as the browser would, and asserts the theme class is already correct at first paint.
