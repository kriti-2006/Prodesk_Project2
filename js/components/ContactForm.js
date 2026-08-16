/**
 * ContactForm component handling validation and asynchronous form submission.
 */

import { Component } from '../core/Component.js';
import { el, frag, replaceChildren } from '../core/dom.js';
import { SUBSCRIBE_STATUS } from '../state/schema.js';
import { TOPICS } from '../services/EventBus.js';

const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export class ContactForm extends Component {
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
