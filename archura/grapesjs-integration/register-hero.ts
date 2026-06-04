import {
  heroBlockId,
  heroDefaults,
  heroDefaultStyle,
  heroParts,
  heroStyleSectors,
  heroTagNames,
  heroTraits,
  heroTypeId
} from './hero-definition';

type EditorLike = {
  Blocks: {
    add: (id: string, config: Record<string, unknown>) => void;
  };
  Components: {
    addType: (id: string, config: Record<string, unknown>) => void;
  };
  Commands?: {
    add?: (id: string, command: Record<string, unknown>) => void;
  };
  Panels?: {
    addPanel?: (config: Record<string, unknown>) => void;
    getPanel?: (id: string) => { get?: (key: string) => unknown } | undefined;
  };
  StyleManager?: {
    addSector?: (name: string, config: Record<string, unknown>, options?: Record<string, unknown>) => void;
  };
  getSelected?: () => any;
  Css?: {
    setRule?: (selector: string, style: Record<string, string>) => void;
  };
};

export function registerHero(editor: EditorLike, framework: 'lit' | 'svelte' = 'lit') {
  const tagName = heroTagNames[framework];
  const commandPrefix = `builder-hero:${framework}`;
  const applyModelToElement = (model: any, element?: HTMLElement | null) => {
    if (!element) return;

    const attributes = model.getAttributes?.() ?? {};
    const styles = model.getStyle?.() ?? {};

    if (typeof (element as any).applyEditorAttributes === 'function') {
      (element as any).applyEditorAttributes(attributes);
    } else {
      for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-gjs-') || name === 'id' || name === 'draggable') continue;
        if (value == null) continue;
        element.setAttribute(name, String(value));
      }
    }

    if (typeof (element as any).updateStyles === 'function') {
      (element as any).updateStyles(styles);
    } else {
      for (const [property, value] of Object.entries(styles)) {
        if (value == null || value === '') {
          element.style.removeProperty(property);
        } else {
          element.style.setProperty(property, String(value));
        }
      }
    }
  };
  const syncHostStyle = function (model: any) {
    const attributes = model.getAttributes?.() ?? {};
    const currentStyle = model.getStyle?.() ?? {};

    model.setStyle?.({
      ...currentStyle,
      '--hero-surface': attributes.surface ?? heroDefaults.surface,
      '--hero-accent': attributes.accent ?? heroDefaults.accent,
      '--hero-space-y': attributes['space-y'] ?? heroDefaults['space-y'],
      'text-align': attributes.align === 'center' ? 'center' : 'left'
    }, { silent: true });
  };
  const selectedHeroSelector = () => {
    const selected = editor.getSelected?.();
    if (!selected) return null;

    const selectedTag = selected.get?.('tagName')?.toLowerCase?.();
    if (selectedTag !== tagName) return null;

    return tagName;
  };
  const upsertPartRule = (part: 'headline', styles: Record<string, string>) => {
    const selector = selectedHeroSelector();
    if (!selector || !editor.Css?.setRule) return;

    editor.Css.setRule(`${selector}::part(${part})`, styles);
  };

  editor.Commands?.add?.(`${commandPrefix}:headline-editorial`, {
    run() {
      upsertPartRule('headline', {
        color: '#f6e7d8',
        'font-size': 'clamp(3rem, 8vw, 6.5rem)',
        'letter-spacing': '-0.08em'
      });
    }
  });

  editor.Commands?.add?.(`${commandPrefix}:headline-loud`, {
    run() {
      upsertPartRule('headline', {
        color: '#ffe082',
        'font-size': 'clamp(3.4rem, 9vw, 7rem)',
        'letter-spacing': '-0.05em',
        'text-transform': 'uppercase'
      });
    }
  });

  editor.Components.addType(heroTypeId, {
    isComponent: (el: Element) => {
      if (el.tagName?.toLowerCase() === tagName) {
        return { type: heroTypeId };
      }

      return false;
    },
    model: {
      defaults: {
        tagName,
        draggable: true,
        droppable: false,
        traits: heroTraits,
        attributes: {
          ...heroDefaults
        },
        style: {
          ...heroDefaultStyle
        },
        'data-builder-parts': heroParts.join(', '),
        stylable: [
          '--hero-surface',
          '--hero-accent',
          '--hero-space-y',
          '--hero-radius',
          'text-align',
          'max-width'
        ]
      },
      init(this: any) {
        this.on('change:attributes', () => {
          syncHostStyle(this);
          const view = this.view;
          applyModelToElement(this, view?.el);
        });
        this.on('change:style', () => {
          const view = this.view;
          applyModelToElement(this, view?.el);
        });
        syncHostStyle(this);
      }
    },
    view: {
      onRender(this: any) {
        applyModelToElement(this.model, this.el);
      },
      init(this: any) {
        this.listenTo(this.model, 'change:style', () => applyModelToElement(this.model, this.el));
        this.listenTo(this.model, 'change:attributes', () => applyModelToElement(this.model, this.el));
      }
    }
  });

  editor.Blocks.add(heroBlockId, {
    label: 'Hero',
    category: 'Marketing',
    select: true,
    content: {
      type: heroTypeId,
      attributes: {
        ...heroDefaults
      },
      style: {
        ...heroDefaultStyle
      }
    }
  });

  heroStyleSectors.forEach((sector, index) => {
    editor.StyleManager?.addSector?.(sector.name, sector, { at: index });
  });

  const existingOptionsPanel = editor.Panels?.getPanel?.('options');
  const existingButtons = (existingOptionsPanel?.get?.('buttons') as { add?: (items: unknown[]) => void } | undefined);

  if (existingButtons?.add) {
    existingButtons.add([
      {
        id: `${commandPrefix}:headline-editorial`,
        className: 'fa fa-header',
        command: `${commandPrefix}:headline-editorial`,
        attributes: { title: 'Hero headline editorial preset' }
      },
      {
        id: `${commandPrefix}:headline-loud`,
        className: 'fa fa-text-height',
        command: `${commandPrefix}:headline-loud`,
        attributes: { title: 'Hero headline loud preset' }
      },
      {
        id: `${commandPrefix}:headline-loud`,
        className: 'fa fa-text-height',
        command: `${commandPrefix}:headline-loud`,
        attributes: { title: 'Hero headline loud preset' }
      }
    ]);
  } else {
    editor.Panels?.addPanel?.({
      id: 'builder-hero-parts',
      visible: true,
      buttons: [
        {
          id: `${commandPrefix}:headline-editorial`,
          label: 'H Editorial',
          command: `${commandPrefix}:headline-editorial`
        },
        {
          id: `${commandPrefix}:headline-loud`,
          label: 'H Loud',
          command: `${commandPrefix}:headline-loud`
        }
      ]
    });
  }
}
