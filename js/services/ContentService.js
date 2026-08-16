/**
 * ContentService fetches and validates content payload structure.
 */

import { bus, TOPICS } from './EventBus.js';

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

export class ContentError extends Error {
  constructor(message, { cause = null, kind = 'unknown' } = {}) {
    super(message);
    this.name = 'ContentError';
    this.cause = cause;
    this.kind = kind;
  }
}

export class ContentService {
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

export const contentService = new ContentService();
