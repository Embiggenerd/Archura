import type { HeroTrait } from './hero-definition';

export const gjsFullDemoTagName = 'my-grapes-full-demo';
export const gjsFullDemoTypeId = 'gjs-full-demo';
export const gjsFullDemoBlockId = 'gjs-full-demo-block';

export const gjsFullDemoTraits: HeroTrait[] = [
  { type: 'text', name: 'title', label: 'Title', changeProp: true },
  { type: 'textarea', name: 'body', label: 'Body', changeProp: true }
];

type EditorLike = {
  Blocks: {
    add: (id: string, config: Record<string, unknown>) => void;
  };
  Components: {
    addType: (id: string, config: Record<string, unknown>) => void;
  };
};

function applyModelToElement(model: any, element?: HTMLElement | null) {
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
}

/**
 * Registers the Lit full-demo web component as a GrapesJS type + block.
 * Persistence: traits and host styles round-trip via editor project JSON (StorageManager).
 */
export function registerGjsFullDemo(editor: EditorLike) {
  editor.Components.addType(gjsFullDemoTypeId, {
    isComponent: (el: Element) => {
      if (el.tagName?.toLowerCase() === gjsFullDemoTagName) {
        return { type: gjsFullDemoTypeId };
      }
      return false;
    },
    model: {
      defaults: {
        tagName: gjsFullDemoTagName,
        draggable: true,
        droppable: true,
        traits: gjsFullDemoTraits,
        attributes: {
          title: 'Full Grapes.js Demo',
          body: 'Every Style Manager control works here.'
        },
        stylable: true
      },
      init(this: any) {
        this.on('change:attributes', () => {
          const view = this.view;
          applyModelToElement(this, view?.el);
        });
        this.on('change:style', () => {
          const view = this.view;
          applyModelToElement(this, view?.el);
        });
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

  editor.Blocks.add(gjsFullDemoBlockId, {
    label: 'Full style demo (Lit)',
    category: 'Lit',
    select: true,
    content: {
      type: gjsFullDemoTypeId,
      attributes: {
        title: 'Full Grapes.js Demo',
        body: 'Every Style Manager control works here.'
      }
    }
  });
}
