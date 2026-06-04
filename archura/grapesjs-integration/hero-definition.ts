export type HeroTrait =
  | {
      type: 'text' | 'textarea' | 'select' | 'color';
      name: string;
      label: string;
      changeProp?: boolean;
      options?: Array<{ id: string; label: string }>;
    }
  | {
      type: 'number';
      name: string;
      label: string;
      changeProp?: boolean;
      min?: number;
      max?: number;
      step?: number;
    };

export const heroTagNames = {
  lit: 'builder-hero-lit',
  svelte: 'builder-hero-svelte'
} as const;

export const heroBlockId = 'builder-hero';
export const heroTypeId = 'builder-hero';

export const heroTraits: HeroTrait[] = [
  {
    type: 'text',
    name: 'headline',
    label: 'Headline',
    changeProp: true
  },
  {
    type: 'textarea',
    name: 'subheadline',
    label: 'Subheadline',
    changeProp: true
  },
  {
    type: 'select',
    name: 'theme',
    label: 'Theme',
    changeProp: true,
    options: [
      { id: 'light', label: 'Light' },
      { id: 'dark', label: 'Dark' },
      { id: 'brand', label: 'Brand' }
    ]
  },
  {
    type: 'select',
    name: 'align',
    label: 'Align',
    changeProp: true,
    options: [
      { id: 'left', label: 'Left' },
      { id: 'center', label: 'Center' }
    ]
  },
  {
    type: 'color',
    name: 'surface',
    label: 'Surface',
    changeProp: true
  },
  {
    type: 'color',
    name: 'accent',
    label: 'Accent',
    changeProp: true
  },
  {
    type: 'text',
    name: 'space-y',
    label: 'Space Y',
    changeProp: true
  }
];

export const heroDefaults = {
  headline: 'Move with confidence',
  subheadline: 'Fast quotes, reliable crews, and a polished experience from the first visit.',
  theme: 'light',
  align: 'left',
  surface: '#f6f1e8',
  accent: '#c4672d',
  'space-y': 'clamp(3rem, 8vw, 6rem)'
} as const;

export const heroDefaultStyle = {
  '--hero-surface': heroDefaults.surface,
  '--hero-accent': heroDefaults.accent,
  '--hero-space-y': heroDefaults['space-y'],
  '--hero-radius': '2rem',
  'max-width': '100%',
  'text-align': heroDefaults.align
} as const;

export const heroStyleSectors = [
  {
    name: 'Hero Tokens',
    open: true,
    buildProps: ['--hero-surface', '--hero-accent', '--hero-space-y', '--hero-radius']
  },
  {
    name: 'Hero Layout',
    open: true,
    buildProps: ['text-align', 'max-width']
  },
  {
    name: 'Part Hooks',
    open: false,
    properties: [
      {
        id: 'parts-note',
        type: 'integer',
        property: '--parts-note',
        name: 'Available `::part` hooks',
        defaults: 'section, eyebrow, headline, subheadline, actions'
      }
    ]
  }
] as const;

export const heroParts = [
  'section',
  'eyebrow',
  'headline',
  'subheadline',
  'actions'
] as const;
