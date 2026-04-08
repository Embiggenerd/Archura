import { fixture, assert, html } from '@open-wc/testing';
import '../src/lib/components/BuilderButtonLit.ts';

suite('BuilderButtonLit', () => {
  test('is defined as a custom element', () => {
    const el = document.createElement('builder-button-lit');
    assert.equal(el.tagName.toLowerCase(), 'builder-button-lit');
    assert.instanceOf(el, customElements.get('builder-button-lit'));
  });

  test('renders the default label', async () => {
    const el = await fixture(html`<builder-button-lit></builder-button-lit>`);
    const button = el.shadowRoot?.querySelector('.button');

    assert.equal(button?.textContent?.trim(), 'Button');
  });

  test('renders a custom label', async () => {
    const el = await fixture(html`<builder-button-lit label="Get a quote"></builder-button-lit>`);
    const button = el.shadowRoot?.querySelector('.button');

    assert.equal(button?.textContent?.trim(), 'Get a quote');
  });

  test('consumes host CSS custom properties for background, color, and border', async () => {
    const el = await fixture(html`
      <builder-button-lit
        style="--button-bg: rgb(255, 0, 0); --button-ink: rgb(255, 255, 0); --button-border-color: rgb(0, 0, 255);"
      ></builder-button-lit>
    `);

    const button = el.shadowRoot?.querySelector('.button');
    const computed = getComputedStyle(button);

    assert.equal(computed.backgroundColor, 'rgb(255, 0, 0)');
    assert.equal(computed.color, 'rgb(255, 255, 0)');
    assert.equal(computed.borderTopColor, 'rgb(0, 0, 255)');
  });

  test('consumes host CSS custom properties for sizing and radius', async () => {
    const el = await fixture(html`
      <builder-button-lit
        style="--button-padding-inline: 2rem; --button-radius: 24px; --button-min-height: 60px;"
      ></builder-button-lit>
    `);

    const button = el.shadowRoot?.querySelector('.button');
    const computed = getComputedStyle(button);

    assert.equal(computed.paddingLeft, '32px');
    assert.equal(computed.paddingRight, '32px');
    assert.equal(computed.borderRadius, '24px');
    assert.equal(computed.minHeight, '60px');
  });

  test('uses host font inheritance', async () => {
    const el = await fixture(html`
      <builder-button-lit style="font-size: 30px; font-family: serif;"></builder-button-lit>
    `);

    const button = el.shadowRoot?.querySelector('.button');
    const computed = getComputedStyle(button);

    assert.equal(computed.fontSize, '30px');
    assert.include(computed.fontFamily.toLowerCase(), 'serif');
  });
});
