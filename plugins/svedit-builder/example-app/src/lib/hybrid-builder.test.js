import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addComponentInstance,
  createPageState,
  createRichTextDoc,
  getRenderProps,
  getRichTextPlainText,
  updateComponentProp,
  updateComponentRichText
} from './hybrid-builder.js';

const definitions = [
  {
    id: 'hero',
    fields: {
      eyebrow: { type: 'text', defaultValue: 'New' },
      title: { type: 'rich_text', defaultValue: 'Hello world' },
      description: { type: 'rich_text', defaultValue: 'This is a hero block.' },
      bgColor: { type: 'color', defaultValue: '#f0f0f0' }
    }
  }
];

test('creates a component instance with plain props and rich-text docs separated', () => {
  const page = addComponentInstance(createPageState(definitions), 'hero', 'hero_1');
  const hero = page.instances[0];

  assert.equal(hero.type, 'hero');
  assert.equal(hero.props.eyebrow, 'New');
  assert.equal(hero.props.bgColor, '#f0f0f0');
  assert.equal(getRichTextPlainText(hero.richText.title), 'Hello world');
  assert.equal(getRichTextPlainText(hero.richText.description), 'This is a hero block.');
});

test('updates plain props without affecting rich-text fields', () => {
  let page = addComponentInstance(createPageState(definitions), 'hero', 'hero_1');
  page = updateComponentProp(page, 'hero_1', 'bgColor', '#111111');

  const hero = page.instances[0];
  assert.equal(hero.props.bgColor, '#111111');
  assert.equal(getRichTextPlainText(hero.richText.title), 'Hello world');
});

test('updates rich-text fields through a Svedit-style document and exposes plain render props', () => {
  let page = addComponentInstance(createPageState(definitions), 'hero', 'hero_1');
  const updatedDoc = createRichTextDoc('Registration that feels premium');

  page = updateComponentRichText(page, 'hero_1', 'title', updatedDoc);

  const hero = page.instances[0];
  const renderProps = getRenderProps(hero);

  assert.equal(getRichTextPlainText(hero.richText.title), 'Registration that feels premium');
  assert.equal(renderProps.title, 'Registration that feels premium');
  assert.equal(renderProps.description, 'This is a hero block.');
  assert.equal(renderProps.eyebrow, 'New');
});
