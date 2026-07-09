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
];
