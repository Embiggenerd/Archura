import { fixture, assert, html } from '@open-wc/testing';
import grapesjs from 'grapesjs';
import '../src/lib/components/BuilderButtonLit.ts';
import '../src/lib/components/BuilderHeroLit.ts';

function getBuiltInIds() {
  const host = document.createElement('div');
  document.body.appendChild(host);

  const editor = grapesjs.init({
    container: host,
    storageManager: false,
    fromElement: false,
    height: '0',
    panels: { defaults: [] },
    blockManager: { appendTo: null },
    layerManager: { appendTo: null },
    styleManager: { appendTo: null },
    traitManager: { appendTo: null },
    selectorManager: { appendTo: null }
  });

  const ids = Object.keys(editor.StyleManager.getBuiltInAll());

  editor.destroy();
  host.remove();

  return ids;
}

const builtInIds = getBuiltInIds();

function standardSpec(property, value) {
  return {
    cssText: `${property}: ${value};`,
    cssProperty: property,
    expectedText: property
  };
}

function compositeSpec(cssProperty, value) {
  return {
    cssText: `${cssProperty}: ${value};`,
    cssProperty,
    expectedText: cssProperty
  };
}

const builtInStyleSpecs = {
  'text-shadow-h': compositeSpec('text-shadow', '2px 0 0 red'),
  top: standardSpec('top', '10px'),
  right: standardSpec('right', '12px'),
  bottom: standardSpec('bottom', '14px'),
  left: standardSpec('left', '16px'),
  'margin-top': standardSpec('margin-top', '10px'),
  'margin-right': standardSpec('margin-right', '12px'),
  'margin-bottom': standardSpec('margin-bottom', '14px'),
  'margin-left': standardSpec('margin-left', '16px'),
  'padding-top': standardSpec('padding-top', '10px'),
  'padding-right': standardSpec('padding-right', '12px'),
  'padding-bottom': standardSpec('padding-bottom', '14px'),
  'padding-left': standardSpec('padding-left', '16px'),
  width: standardSpec('width', '320px'),
  'min-width': standardSpec('min-width', '240px'),
  'max-width': standardSpec('max-width', '640px'),
  height: standardSpec('height', '480px'),
  'min-height': standardSpec('min-height', '120px'),
  'max-height': standardSpec('max-height', '720px'),
  'flex-basis': standardSpec('flex-basis', '50%'),
  'font-size': standardSpec('font-size', '32px'),
  'letter-spacing': standardSpec('letter-spacing', '0.08em'),
  'line-height': standardSpec('line-height', '1.4'),
  'text-shadow-v': compositeSpec('text-shadow', '0 3px 0 red'),
  'text-shadow-blur': compositeSpec('text-shadow', '0 0 5px red'),
  'border-radius-c': compositeSpec('border-radius', '18px'),
  'border-top-left-radius': standardSpec('border-top-left-radius', '12px'),
  'border-top-right-radius': standardSpec('border-top-right-radius', '14px'),
  'border-bottom-left-radius': standardSpec('border-bottom-left-radius', '16px'),
  'border-bottom-right-radius': standardSpec('border-bottom-right-radius', '18px'),
  'border-width': standardSpec('border-width', '3px'),
  'box-shadow-h': compositeSpec('box-shadow', '4px 0 8px 0 red'),
  'box-shadow-v': compositeSpec('box-shadow', '0 4px 8px 0 red'),
  'box-shadow-blur': compositeSpec('box-shadow', '0 0 12px 0 red'),
  'box-shadow-spread': compositeSpec('box-shadow', '0 0 0 6px red'),
  'transition-duration': standardSpec('transition-duration', '150ms'),
  perspective: standardSpec('perspective', '800px'),
  order: standardSpec('order', '2'),
  'flex-grow': standardSpec('flex-grow', '2'),
  'flex-shrink': standardSpec('flex-shrink', '0'),
  float: standardSpec('float', 'right'),
  position: standardSpec('position', 'relative'),
  'text-align': standardSpec('text-align', 'center'),
  color: standardSpec('color', 'red'),
  'text-shadow-color': compositeSpec('text-shadow', '0 0 4px red'),
  'border-color': standardSpec('border-color', 'blue'),
  'box-shadow-color': compositeSpec('box-shadow', '0 0 8px 0 blue'),
  'background-color': standardSpec('background-color', 'green'),
  'background-image': standardSpec(
    'background-image',
    'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))'
  ),
  opacity: standardSpec('opacity', '0.5'),
  display: standardSpec('display', 'grid'),
  'flex-direction': standardSpec('flex-direction', 'column'),
  'flex-wrap': standardSpec('flex-wrap', 'wrap'),
  'justify-content': standardSpec('justify-content', 'center'),
  'align-items': standardSpec('align-items', 'center'),
  'align-content': standardSpec('align-content', 'space-between'),
  'align-self': standardSpec('align-self', 'center'),
  'font-family': standardSpec('font-family', 'serif'),
  'font-weight': standardSpec('font-weight', '700'),
  'border-style': standardSpec('border-style', 'solid'),
  'box-shadow-type': compositeSpec('box-shadow', 'inset 0 0 8px 0 red'),
  'background-repeat': standardSpec('background-repeat', 'no-repeat'),
  'background-position': standardSpec('background-position', 'center center'),
  'background-attachment': standardSpec('background-attachment', 'fixed'),
  'background-size': standardSpec('background-size', 'cover'),
  'transition-property': standardSpec('transition-property', 'opacity'),
  'transition-timing-function': standardSpec('transition-timing-function', 'ease-in-out'),
  cursor: standardSpec('cursor', 'pointer'),
  overflow: standardSpec('overflow', 'hidden'),
  'overflow-x': standardSpec('overflow-x', 'scroll'),
  'overflow-y': standardSpec('overflow-y', 'auto'),
  margin: standardSpec('margin', '20px'),
  padding: standardSpec('padding', '24px'),
  border: standardSpec('border', '2px solid red'),
  'border-radius': standardSpec('border-radius', '20px'),
  transition: standardSpec('transition', 'opacity 200ms ease-in-out'),
  'box-shadow': standardSpec('box-shadow', '0 8px 16px 0 red'),
  'text-shadow': standardSpec('text-shadow', '1px 1px 2px red'),
  background: standardSpec('background', 'linear-gradient(red, blue)'),
  transform: standardSpec('transform', 'rotate(5deg)')
};

function hostComputedSpec(property, value, expected = value) {
  return {
    cssText: `${property}: ${value};`,
    getTarget: (el) => el,
    assert: (target) => {
      const actual = getComputedStyle(target).getPropertyValue(property).trim();
      assert.equal(actual, expected, `Expected computed ${property} to equal "${expected}"`);
    }
  };
}

function hostComputedIncludesSpec(property, value, expectedFragment) {
  return {
    cssText: `${property}: ${value};`,
    getTarget: (el) => el,
    assert: (target) => {
      const actual = getComputedStyle(target).getPropertyValue(property).trim();
      assert.include(actual, expectedFragment, `Expected computed ${property} to include "${expectedFragment}"`);
    }
  };
}

function shadowComputedSpec(selector, property, value, expected = value) {
  return {
    cssText: `${property}: ${value};`,
    getTarget: (el) => el.shadowRoot?.querySelector(selector),
    assert: (target) => {
      assert.ok(target, `Expected shadow target "${selector}" to exist`);
      const actual = getComputedStyle(target).getPropertyValue(property).trim();
      assert.equal(actual, expected, `Expected shadow computed ${property} on "${selector}" to equal "${expected}"`);
    }
  };
}

function shadowComputedIncludesSpec(selector, property, value, expectedFragment) {
  return {
    cssText: `${property}: ${value};`,
    getTarget: (el) => el.shadowRoot?.querySelector(selector),
    assert: (target) => {
      assert.ok(target, `Expected shadow target "${selector}" to exist`);
      const actual = getComputedStyle(target).getPropertyValue(property).trim();
      assert.include(
        actual,
        expectedFragment,
        `Expected shadow computed ${property} on "${selector}" to include "${expectedFragment}"`
      );
    }
  };
}

const builtInComputedSpecs = {
  'text-shadow-h': hostComputedIncludesSpec('text-shadow', '2px 0 0 red', '2px'),
  top: hostComputedSpec('top', '10px'),
  right: hostComputedSpec('right', '12px'),
  bottom: hostComputedSpec('bottom', '14px'),
  left: hostComputedSpec('left', '16px'),
  'margin-top': hostComputedSpec('margin-top', '10px'),
  'margin-right': hostComputedSpec('margin-right', '12px'),
  'margin-bottom': hostComputedSpec('margin-bottom', '14px'),
  'margin-left': hostComputedSpec('margin-left', '16px'),
  'padding-top': hostComputedSpec('padding-top', '10px'),
  'padding-right': hostComputedSpec('padding-right', '12px'),
  'padding-bottom': hostComputedSpec('padding-bottom', '14px'),
  'padding-left': hostComputedSpec('padding-left', '16px'),
  width: hostComputedSpec('width', '320px'),
  'min-width': hostComputedSpec('min-width', '240px'),
  'max-width': hostComputedSpec('max-width', '640px'),
  height: hostComputedSpec('height', '480px'),
  'min-height': hostComputedSpec('min-height', '120px'),
  'max-height': hostComputedSpec('max-height', '720px'),
  'flex-basis': hostComputedSpec('flex-basis', '50%'),
  'font-size': hostComputedSpec('font-size', '32px'),
  'letter-spacing': hostComputedSpec('letter-spacing', '0.08em', '1.28px'),
  'line-height': hostComputedSpec('line-height', '1.4', '22.4px'),
  'text-shadow-v': hostComputedIncludesSpec('text-shadow', '0 3px 0 red', '3px'),
  'text-shadow-blur': hostComputedIncludesSpec('text-shadow', '0 0 5px red', '5px'),
  'border-radius-c': hostComputedSpec('border-radius', '18px'),
  'border-top-left-radius': hostComputedSpec('border-top-left-radius', '12px'),
  'border-top-right-radius': hostComputedSpec('border-top-right-radius', '14px'),
  'border-bottom-left-radius': hostComputedSpec('border-bottom-left-radius', '16px'),
  'border-bottom-right-radius': hostComputedSpec('border-bottom-right-radius', '18px'),
  'border-width': hostComputedSpec('border-top-width', '3px'),
  'box-shadow-h': hostComputedIncludesSpec('box-shadow', '4px 0 8px 0 red', '4px'),
  'box-shadow-v': hostComputedIncludesSpec('box-shadow', '0 4px 8px 0 red', '4px'),
  'box-shadow-blur': hostComputedIncludesSpec('box-shadow', '0 0 12px 0 red', '12px'),
  'box-shadow-spread': hostComputedIncludesSpec('box-shadow', '0 0 0 6px red', '6px'),
  'transition-duration': hostComputedSpec('transition-duration', '150ms', '0.15s'),
  perspective: hostComputedSpec('perspective', '800px'),
  order: hostComputedSpec('order', '2'),
  'flex-grow': hostComputedSpec('flex-grow', '2'),
  'flex-shrink': hostComputedSpec('flex-shrink', '0'),
  float: hostComputedSpec('float', 'right'),
  position: hostComputedSpec('position', 'relative'),
  'text-align': hostComputedSpec('text-align', 'center'),
  color: hostComputedSpec('color', 'red', 'rgb(255, 0, 0)'),
  'text-shadow-color': hostComputedIncludesSpec('text-shadow', '0 0 4px red', 'rgb(255, 0, 0)'),
  'border-color': hostComputedSpec('border-top-color', 'blue', 'rgb(0, 0, 255)'),
  'box-shadow-color': hostComputedIncludesSpec('box-shadow', '0 0 8px 0 blue', 'rgb(0, 0, 255)'),
  'background-color': hostComputedSpec('background-color', 'green', 'rgb(0, 128, 0)'),
  'background-image': hostComputedIncludesSpec(
    'background-image',
    'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))',
    'linear-gradient'
  ),
  opacity: hostComputedSpec('opacity', '0.5'),
  display: hostComputedSpec('display', 'grid'),
  'flex-direction': hostComputedSpec('flex-direction', 'column'),
  'flex-wrap': hostComputedSpec('flex-wrap', 'wrap'),
  'justify-content': hostComputedSpec('justify-content', 'center'),
  'align-items': hostComputedSpec('align-items', 'center'),
  'align-content': hostComputedSpec('align-content', 'space-between'),
  'align-self': hostComputedSpec('align-self', 'center'),
  'font-family': hostComputedIncludesSpec('font-family', 'serif', 'serif'),
  'font-weight': hostComputedSpec('font-weight', '700'),
  'border-style': hostComputedSpec('border-top-style', 'solid'),
  'box-shadow-type': hostComputedIncludesSpec('box-shadow', 'inset 0 0 8px 0 red', 'inset'),
  'background-repeat': hostComputedSpec('background-repeat', 'no-repeat'),
  'background-position': hostComputedSpec('background-position', 'center center', '50% 50%'),
  'background-attachment': hostComputedSpec('background-attachment', 'fixed'),
  'background-size': hostComputedSpec('background-size', 'cover'),
  'transition-property': hostComputedSpec('transition-property', 'opacity'),
  'transition-timing-function': hostComputedSpec('transition-timing-function', 'ease-in-out'),
  cursor: hostComputedSpec('cursor', 'pointer'),
  overflow: hostComputedSpec('overflow', 'hidden'),
  'overflow-x': hostComputedSpec('overflow-x', 'scroll'),
  'overflow-y': hostComputedSpec('overflow-y', 'auto'),
  margin: hostComputedSpec('margin-top', '20px'),
  padding: hostComputedSpec('padding-top', '24px'),
  border: hostComputedSpec('border-top-width', '2px'),
  'border-radius': hostComputedSpec('border-radius', '20px'),
  transition: hostComputedIncludesSpec('transition', 'opacity 200ms ease-in-out', 'opacity'),
  'box-shadow': hostComputedIncludesSpec('box-shadow', '0 8px 16px 0 red', '8px'),
  'text-shadow': hostComputedIncludesSpec('text-shadow', '1px 1px 2px red', '2px'),
  background: hostComputedIncludesSpec('background-image', 'linear-gradient(red, blue)', 'linear-gradient'),
  transform: hostComputedIncludesSpec('transform', 'rotate(5deg)', 'matrix')
};

const builtInShadowConsumptionSpecs = {
  'text-shadow-h': shadowComputedIncludesSpec('.headline', 'text-shadow', '2px 0 0 red', '2px'),
  top: shadowComputedSpec('.hero', 'top', '10px'),
  right: shadowComputedSpec('.hero', 'right', '12px'),
  bottom: shadowComputedSpec('.hero', 'bottom', '14px'),
  left: shadowComputedSpec('.hero', 'left', '16px'),
  'margin-top': shadowComputedSpec('.hero', 'margin-top', '10px'),
  'margin-right': shadowComputedSpec('.hero', 'margin-right', '12px'),
  'margin-bottom': shadowComputedSpec('.hero', 'margin-bottom', '14px'),
  'margin-left': shadowComputedSpec('.hero', 'margin-left', '16px'),
  'padding-top': shadowComputedSpec('.hero', 'padding-top', '10px'),
  'padding-right': shadowComputedSpec('.hero', 'padding-right', '12px'),
  'padding-bottom': shadowComputedSpec('.hero', 'padding-bottom', '14px'),
  'padding-left': shadowComputedSpec('.hero', 'padding-left', '16px'),
  width: shadowComputedSpec('.hero', 'width', '320px'),
  'min-width': shadowComputedSpec('.hero', 'min-width', '240px'),
  'max-width': shadowComputedSpec('.hero', 'max-width', '640px'),
  height: shadowComputedSpec('.hero', 'height', '480px'),
  'min-height': shadowComputedSpec('.hero', 'min-height', '120px'),
  'max-height': shadowComputedSpec('.hero', 'max-height', '720px'),
  'flex-basis': shadowComputedSpec('.hero', 'flex-basis', '50%'),
  'font-size': shadowComputedSpec('.headline', 'font-size', '32px'),
  'letter-spacing': shadowComputedSpec('.headline', 'letter-spacing', '0.08em', '2.56px'),
  'line-height': shadowComputedSpec('.headline', 'line-height', '1.4', '44.8px'),
  'text-shadow-v': shadowComputedIncludesSpec('.headline', 'text-shadow', '0 3px 0 red', '3px'),
  'text-shadow-blur': shadowComputedIncludesSpec('.headline', 'text-shadow', '0 0 5px red', '5px'),
  'border-radius-c': shadowComputedSpec('.hero', 'border-radius', '18px'),
  'border-top-left-radius': shadowComputedSpec('.hero', 'border-top-left-radius', '12px'),
  'border-top-right-radius': shadowComputedSpec('.hero', 'border-top-right-radius', '14px'),
  'border-bottom-left-radius': shadowComputedSpec('.hero', 'border-bottom-left-radius', '16px'),
  'border-bottom-right-radius': shadowComputedSpec('.hero', 'border-bottom-right-radius', '18px'),
  'border-width': shadowComputedSpec('.hero', 'border-top-width', '3px'),
  'box-shadow-h': shadowComputedIncludesSpec('.hero', 'box-shadow', '4px 0 8px 0 red', '4px'),
  'box-shadow-v': shadowComputedIncludesSpec('.hero', 'box-shadow', '0 4px 8px 0 red', '4px'),
  'box-shadow-blur': shadowComputedIncludesSpec('.hero', 'box-shadow', '0 0 12px 0 red', '12px'),
  'box-shadow-spread': shadowComputedIncludesSpec('.hero', 'box-shadow', '0 0 0 6px red', '6px'),
  'transition-duration': shadowComputedSpec('.hero', 'transition-duration', '150ms', '0.15s'),
  perspective: shadowComputedSpec('.hero', 'perspective', '800px'),
  order: shadowComputedSpec('.hero', 'order', '2'),
  'flex-grow': shadowComputedSpec('.hero', 'flex-grow', '2'),
  'flex-shrink': shadowComputedSpec('.hero', 'flex-shrink', '0'),
  float: shadowComputedSpec('.hero', 'float', 'right'),
  position: shadowComputedSpec('.hero', 'position', 'relative'),
  'text-align': shadowComputedSpec('.shell', 'text-align', 'center'),
  color: shadowComputedSpec('.headline', 'color', 'red', 'rgb(255, 0, 0)'),
  'text-shadow-color': shadowComputedIncludesSpec('.headline', 'text-shadow', '0 0 4px red', 'rgb(255, 0, 0)'),
  'border-color': shadowComputedSpec('.hero', 'border-top-color', 'blue', 'rgb(0, 0, 255)'),
  'box-shadow-color': shadowComputedIncludesSpec('.hero', 'box-shadow', '0 0 8px 0 blue', 'rgb(0, 0, 255)'),
  'background-color': shadowComputedSpec('.hero', 'background-color', 'green', 'rgb(0, 128, 0)'),
  'background-image': shadowComputedIncludesSpec(
    '.hero',
    'background-image',
    'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))',
    'linear-gradient'
  ),
  opacity: shadowComputedSpec('.hero', 'opacity', '0.5'),
  display: shadowComputedSpec('.hero', 'display', 'grid'),
  'flex-direction': shadowComputedSpec('.actions', 'flex-direction', 'column'),
  'flex-wrap': shadowComputedSpec('.actions', 'flex-wrap', 'wrap'),
  'justify-content': shadowComputedSpec('.actions', 'justify-content', 'center'),
  'align-items': shadowComputedSpec('.actions', 'align-items', 'center'),
  'align-content': shadowComputedSpec('.actions', 'align-content', 'space-between'),
  'align-self': shadowComputedSpec('.hero', 'align-self', 'center'),
  'font-family': shadowComputedIncludesSpec('.headline', 'font-family', 'serif', 'serif'),
  'font-weight': shadowComputedSpec('.headline', 'font-weight', '700'),
  'border-style': shadowComputedSpec('.hero', 'border-top-style', 'solid'),
  'box-shadow-type': shadowComputedIncludesSpec('.hero', 'box-shadow', 'inset 0 0 8px 0 red', 'inset'),
  'background-repeat': shadowComputedSpec('.hero', 'background-repeat', 'no-repeat'),
  'background-position': shadowComputedSpec('.hero', 'background-position', 'center center', '50% 50%'),
  'background-attachment': shadowComputedSpec('.hero', 'background-attachment', 'fixed'),
  'background-size': shadowComputedSpec('.hero', 'background-size', 'cover'),
  'transition-property': shadowComputedSpec('.hero', 'transition-property', 'opacity'),
  'transition-timing-function': shadowComputedSpec('.hero', 'transition-timing-function', 'ease-in-out'),
  cursor: shadowComputedSpec('builder-button-lit', 'cursor', 'pointer'),
  overflow: shadowComputedSpec('.hero', 'overflow', 'hidden'),
  'overflow-x': shadowComputedSpec('.hero', 'overflow-x', 'scroll'),
  'overflow-y': shadowComputedSpec('.hero', 'overflow-y', 'auto'),
  margin: shadowComputedSpec('.hero', 'margin-top', '20px'),
  padding: shadowComputedSpec('.hero', 'padding-top', '24px'),
  border: shadowComputedSpec('.hero', 'border-top-width', '2px'),
  'border-radius': shadowComputedSpec('.hero', 'border-radius', '20px'),
  transition: shadowComputedIncludesSpec('.hero', 'transition', 'opacity 200ms ease-in-out', 'opacity'),
  'box-shadow': shadowComputedIncludesSpec('.hero', 'box-shadow', '0 8px 16px 0 red', '8px'),
  'text-shadow': shadowComputedIncludesSpec('.headline', 'text-shadow', '1px 1px 2px red', '2px'),
  background: shadowComputedIncludesSpec('.hero', 'background-image', 'linear-gradient(red, blue)', 'linear-gradient'),
  transform: shadowComputedIncludesSpec('.hero', 'transform', 'rotate(5deg)', 'matrix')
};

// Print the full GrapesJS built-in styling vocabulary once per run so the test
// output shows the actual inventory we are targeting.
// eslint-disable-next-line no-console
console.log('GrapesJS StyleManager.getBuiltInAll() ids:', JSON.stringify(builtInIds, null, 2));

suite('BuilderHeroLit', () => {
  test('is defined as a custom element', () => {
    const el = document.createElement('builder-hero-lit');
    assert.equal(el.tagName.toLowerCase(), 'builder-hero-lit');
    assert.instanceOf(el, customElements.get('builder-hero-lit'));
  });

  test('renders expected default parts and content', async () => {
    const el = await fixture(html`<builder-hero-lit></builder-hero-lit>`);

    assert.equal(el.shadowRoot?.querySelector('[part="headline"]')?.textContent?.trim(), 'Move with confidence');
    assert.equal(
      el.shadowRoot?.querySelector('[part="subheadline"]')?.textContent?.trim(),
      'Fast quotes, reliable crews, and a polished experience from the first visit.'
    );
    assert.equal(el.shadowRoot?.querySelectorAll('builder-button-lit')?.length, 2);
  });

  test('renders attribute-driven headline and alignment', async () => {
    const el = await fixture(html`
      <builder-hero-lit headline="Custom headline" align="center"></builder-hero-lit>
    `);

    const section = el.shadowRoot?.querySelector('.hero');
    const shell = el.shadowRoot?.querySelector('.shell');

    assert.equal(el.shadowRoot?.querySelector('[part="headline"]')?.textContent?.trim(), 'Custom headline');
    assert.equal(section?.getAttribute('data-align'), 'center');
    assert.equal(getComputedStyle(shell).textAlign, 'center');
  });

  test('maps editable attributes into rendered host CSS variables', async () => {
    const el = await fixture(html`
      <builder-hero-lit
        surface="#6f2f17"
        accent="#f1b07a"
        space-y="clamp(4rem, 10vw, 7rem)"
      ></builder-hero-lit>
    `);

    await el.updateComplete;

    const section = el.shadowRoot?.querySelector('.hero');
    const style = section?.getAttribute('style') ?? '';

    assert.match(style, /--hero-surface:#6f2f17/);
    assert.match(style, /--hero-accent:#f1b07a/);
    assert.match(style, /--hero-space-y:clamp\(4rem, 10vw, 7rem\)/);
  });

  test('applies the spacing attribute to rendered padding', async () => {
    const el = await fixture(html`
      <builder-hero-lit space-y="40px"></builder-hero-lit>
    `);

    await el.updateComplete;

    const section = el.shadowRoot?.querySelector('.hero');
    const computed = getComputedStyle(section);

    assert.equal(computed.paddingTop, '40px');
    assert.equal(computed.paddingBottom, '40px');
  });

  for (const id of builtInIds) {
    test(`maps GrapesJS built-in "${id}" to component CSS text`, async () => {
      const spec = builtInStyleSpecs[id];

      assert.ok(
        spec,
        `Expected GrapesJS built-in "${id}" to have a concrete CSS-text test spec on BuilderHeroLit`
      );

      const el = await fixture(html`<builder-hero-lit></builder-hero-lit>`);

      el.setAttribute('style', spec.cssText);

      const cssText = el.style.cssText.toLowerCase();
      assert.include(
        cssText,
        spec.expectedText,
        `Expected BuilderHeroLit cssText to include "${spec.expectedText}" for GrapesJS built-in "${id}"`
      );
      assert.notEqual(
        el.style.getPropertyValue(spec.cssProperty),
        '',
        `Expected BuilderHeroLit to store a non-empty "${spec.cssProperty}" value for GrapesJS built-in "${id}"`
      );
    });
  }
});

suite('BuilderHeroLit computed-style coverage for GrapesJS built-ins', () => {
  for (const id of builtInIds) {
    test(`applies GrapesJS built-in "${id}" as a computed style change`, async () => {
      const spec = builtInComputedSpecs[id];

      assert.ok(
        spec,
        `Expected GrapesJS built-in "${id}" to have a computed-style test spec on BuilderHeroLit`
      );

      const el = await fixture(html`<builder-hero-lit></builder-hero-lit>`);

      el.setAttribute('style', spec.cssText);

      const target = spec.getTarget(el);
      spec.assert(target);
    });
  }
});

suite('BuilderHeroLit shadow consumption compliance for GrapesJS built-ins', () => {
  for (const id of builtInIds) {
    test(`consumes GrapesJS built-in "${id}" inside shadow DOM`, async () => {
      const spec = builtInShadowConsumptionSpecs[id];

      assert.ok(
        spec,
        `Expected GrapesJS built-in "${id}" to have a first-pass shadow consumption spec on BuilderHeroLit`
      );

      const el = await fixture(html`<builder-hero-lit></builder-hero-lit>`);

      el.setAttribute('style', spec.cssText);
      await el.updateComplete;

      const target = spec.getTarget(el);
      spec.assert(target);
    });
  }
});
