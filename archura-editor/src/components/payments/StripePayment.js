import { html } from 'lit';
import { Base } from '../base/Base.js';

// Two distinct credentials (both borrow the pk_ convention, so keep them apart):
//  - `stripe-publishable-key`: a REAL Stripe key (pk_test_/pk_live_) that inits
//    Stripe.js. Only this can mount card Elements.
//  - `client-key` (+ `api`): the ARCHURA tenant key. The component authenticates
//    to Archura with it to fetch the tenant's real Stripe key and a client
//    secret. Bootstrap path — needs the core endpoint (not built yet).
// Missing/dummy Stripe key => mock (preview) mode: styled placeholders, no Stripe.js.

// A real Stripe key reaches Stripe's servers; an Archura key never should. We
// can't tell them apart by prefix alone, so they live in separate attributes and
// only `stripe-publishable-key` is ever handed to Stripe.js.
function isStripeKey(key) {
  return typeof key === 'string' && /^pk_(test|live)_/.test(key)
}

/**
 * Reads the host's custom-property styling contract and maps it into the
 * constrained `style` object Stripe's split card Elements accept. This is the
 * bridge that lets the merchant's Archura styling theme the (iframed, otherwise
 * un-CSS-able) card fields. Pure + exported so it can be unit-tested.
 */
export function stripeElementStyle(cs) {
  const v = (name, fallback) => {
    const got = cs.getPropertyValue(name).trim();
    return got || fallback;
  };
  return {
    base: {
      color: v('--color', '#111827'),
      fontFamily: v('--font-family', 'system-ui, -apple-system, sans-serif'),
      fontSize: v('--font-size', '16px'),
      fontSmoothing: 'antialiased',
      '::placeholder': { color: v('--placeholder-color', '#9ca3af') },
    },
    invalid: {
      color: v('--error-color', '#dc2626'),
      iconColor: v('--error-color', '#dc2626'),
    },
  };
}

// Injected once per document (deduped). Scoped under the tag so it doesn't leak,
// and consumes the custom-property contract from the host — since this component
// renders in LIGHT DOM (Stripe Elements cannot mount inside shadow DOM), the
// props cascade from the host into the form naturally.
const STYLE_TEXT = `
archura-stripe-payment {
  display: var(--display, block);
  box-sizing: border-box;
  width: var(--width, auto);
  max-width: var(--max-width, 420px);
  margin: var(--margin, 0);
  padding: var(--padding, 1.5rem);
  border: var(--border, none);
  border-radius: var(--border-radius, 12px);
  background-color: var(--background-color, transparent);
  color: var(--color, #111827);
  font-family: var(--font-family, system-ui, -apple-system, sans-serif);
  font-size: var(--font-size, 16px);
}
archura-stripe-payment .form { display: flex; flex-direction: column; gap: 14px; }
archura-stripe-payment .row { display: flex; gap: 12px; }
archura-stripe-payment .row > .field { flex: 1; }
archura-stripe-payment .field { display: flex; flex-direction: column; gap: 6px; }
archura-stripe-payment label {
  font-size: var(--label-font-size, 0.8rem); font-weight: 600;
  color: var(--label-color, var(--color, #374151));
}
archura-stripe-payment .control {
  min-height: 44px; display: flex; align-items: center; padding: 0 12px;
  border: var(--field-border, 1px solid #d1d5db); border-radius: var(--field-radius, 8px);
  background: var(--field-background, #ffffff);
}
archura-stripe-payment .mount { flex: 1; min-width: 0; }
archura-stripe-payment .placeholder { color: var(--placeholder-color, var(--color, #9ca3af)); letter-spacing: 0.04em; user-select: none; }
archura-stripe-payment:not(.live) .mount { display: none; }
archura-stripe-payment.live .placeholder { display: none; }
archura-stripe-payment button.pay {
  margin-top: 4px; padding: 12px 16px; border: none; border-radius: var(--button-radius, 8px);
  background: var(--button-background, #4f46e5); color: var(--button-color, #ffffff);
  font: 600 var(--button-font-size, 1rem)/1 var(--font-family, sans-serif); cursor: pointer;
}
archura-stripe-payment button.pay:hover { background: var(--button-hover-background, #4338ca); }
archura-stripe-payment .status { min-height: 1.2em; font-size: 0.85rem; }
archura-stripe-payment .status.error { color: var(--error-color, #dc2626); }
archura-stripe-payment .badge { margin-top: 8px; font-size: 0.7rem; color: var(--color, #9ca3af); text-align: center; }
`;

export class StripePayment extends Base {
  static grapesTagName = 'archura-stripe-payment';

  static properties = {
    amount: { type: Number },
    currency: { type: String },
    buttonLabel: { type: String, attribute: 'button-label' },
    // Real Stripe key (direct live path — e.g. a test pk while developing).
    stripePublishableKey: { type: String, attribute: 'stripe-publishable-key' },
    // The session-token (ct_…) is minted by the CLIENT's backend via the core's
    // /v1/component-sessions (which needs the tenant secret — the browser must
    // never hold it) and injected here; the component authorizes the charge with
    // it. `client-key` + `api` (the tenant identity for the bootstrap path) come
    // from Base, shared by every component.
    sessionToken: { type: String, attribute: 'session-token' },
    status: { state: true },
  };

  static styleParts = {
    host: ['spacing', 'dimension', 'decorations', 'typography'],
    cardLabel: ['typography'],
    expiryLabel: ['typography'],
    cvcLabel: ['typography'],
    payButton: ['typography'],
    badge: ['typography'],
  };

  // Light DOM: Stripe Elements cannot mount inside a shadow root.
  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.amount = 1000; // minor units (e.g. cents)
    this.currency = 'usd';
    this.buttonLabel = 'Pay';
    this.sessionToken = '';
    this.status = '';
    this._live = false;
  }

  connectedCallback() {
    super.connectedCallback();
    // Style lives in the document (not the light-DOM subtree) so it never lands
    // in the saved artifact and isn't duplicated per instance.
    const doc = this.ownerDocument;
    if (doc && !doc.getElementById('archura-stripe-style')) {
      const style = doc.createElement('style');
      style.id = 'archura-stripe-style';
      style.textContent = STYLE_TEXT;
      doc.head.appendChild(style);
    }
  }

  get #priceLabel() {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: (this.currency || 'usd').toUpperCase(),
      }).format((this.amount || 0) / 100);
    } catch {
      return `${(this.amount || 0) / 100} ${this.currency}`;
    }
  }

  firstUpdated() {
    super.firstUpdated?.();
    if (isStripeKey(this.stripePublishableKey)) {
      this.#initLive(this.stripePublishableKey).catch((err) => {
        this.status = 'Could not load payment fields.';
        this.dispatchEvent(new CustomEvent('archura:error', { detail: { error: String(err) }, bubbles: true, composed: true }));
      });
    }
  }

  render() {
    // Field DOM is static (no Lit bindings inside .control) so Lit renders it
    // once and never touches the nodes Stripe mounts into.
    console.log("***", this.stripePublishableKey)
    return html`
      <div class="form">
        <div class="field">
          <label data-part="cardLabel">Card number</label>
          <div class="control">
            <div class="mount" data-mount="number"></div>
            <span class="placeholder">•••• •••• •••• 4242</span>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label data-part="expiryLabel">Expiry</label>
            <div class="control">
              <div class="mount" data-mount="expiry"></div>
              <span class="placeholder">MM / YY</span>
            </div>
          </div>
          <div class="field">
            <label data-part="cvcLabel">CVC</label>
            <div class="control">
              <div class="mount" data-mount="cvc"></div>
              <span class="placeholder">•••</span>
            </div>
          </div>
        </div>
        <button class="pay" data-part="payButton" @click=${this.#pay}>${this.buttonLabel} ${this.#priceLabel}</button>
        <div class="status ${this.status ? 'error' : ''}">${this.status}</div>
        <div class="badge" data-part="badge">${this._live ? 'Secured by Stripe' : 'Preview — add a publishable key to accept cards'}</div>
      </div>
    `;
  }

  async #initLive(stripeKey) {
    const Stripe = await loadStripeJs();
    if (!Stripe) throw new Error('Stripe.js unavailable');
    const stripe = Stripe(stripeKey);
    const elements = stripe.elements();
    const style = stripeElementStyle(getComputedStyle(this));

    // Reveal the mount nodes before mounting (Stripe can't measure a hidden one).
    this._live = true;
    this.classList.add('live');
    this.requestUpdate();
    await this.updateComplete;

    const mount = (kind, sel) => {
      const el = elements.create(kind, { style });
      const node = this.querySelector(`[data-mount="${sel}"]`);
      if (node) el.mount(node);
      return el;
    };

    this._cardNumber = mount('cardNumber', 'number');
    mount('cardExpiry', 'expiry');
    mount('cardCvc', 'cvc');
    this._stripe = stripe;
  }

  async #pay() {
    if (!this._live) {
      this.dispatchEvent(new CustomEvent('archura:pay-preview', { bubbles: true, composed: true }));
      return;
    }
    // The charge itself: the component POSTs to the core's checkout endpoint
    // (M4) with the session token to get a client_secret, then confirms with
    // Stripe.js. M4 isn't built, so we stop at this seam and hand the caller the
    // session token + card element it needs to complete the flow.
    this.status = '';
    this.dispatchEvent(
      new CustomEvent('archura:pay', {
        detail: {
          amount: this.amount,
          currency: this.currency,
          sessionToken: this.sessionToken,
          api: this.api,
          cardNumber: this._cardNumber,
        },
        bubbles: true,
        composed: true,
      })
    );
  }
}

// Minimal Stripe.js loader (injects the required js.stripe.com script — Stripe
// must be loaded from their domain for PCI; it cannot be self-hosted).
let stripeJsPromise = null;
function loadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripeJsPromise) return stripeJsPromise;
  stripeJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src^="https://js.stripe.com/v3"]');
    const done = () => resolve(window.Stripe ?? null);
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('stripe.js load failed')));
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3';
    s.onload = done;
    s.onerror = () => reject(new Error('stripe.js load failed'));
    document.head.appendChild(s);
  });
  return stripeJsPromise;
}

if (!customElements.get(StripePayment.grapesTagName)) {
  customElements.define(StripePayment.grapesTagName, StripePayment);
}

