import type { ArchuraComponentDefinition } from '../editor/types.js';

// Module URLs resolve relative to this file, so they are correct wherever
// the package is installed — no assumption about the host's server layout.
export const defaultComponents: ArchuraComponentDefinition[] = [
  {
    kind: 'component',
    path: ['cards', 'Card'],
    tagName: 'archura-card',
    moduleUrl: new URL('./cards/Card.js', import.meta.url).href,
    label: 'Card',
  },
  {
    kind: 'component',
    path: ['heroes', 'Hero'],
    tagName: 'archura-hero',
    moduleUrl: new URL('./heroes/Hero.js', import.meta.url).href,
    label: 'Hero',
  },
  {
    kind: 'component',
    path: ['media', 'Image'],
    tagName: 'archura-image',
    moduleUrl: new URL('./media/Image.js', import.meta.url).href,
    label: 'Image',
  },
  {
    kind: 'page',
    path: ['pages', 'Landing'],
    tagName: 'archura-landing',
    moduleUrl: new URL('./pages/Landing.js', import.meta.url).href,
    label: 'Landing',
    uses: [
      ['heroes', 'Hero'],
      ['cards', 'Card'],
    ],
  },
  {
    kind: 'page',
    path: ['pages', 'Cards'],
    tagName: 'archura-cards',
    moduleUrl: new URL('./pages/Cards.js', import.meta.url).href,
    label: 'Cards',
    uses: [
      ['heroes', 'Hero'],
      ['cards', 'Card'],
    ],
  },
];
