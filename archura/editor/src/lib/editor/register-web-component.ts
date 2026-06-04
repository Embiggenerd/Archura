type EditorLike = {
  Components: {
    addType: (id: string, config: Record<string, unknown>) => void;
  };
};

export function registerWebComponent(editor: EditorLike, grapesTagName: string) {
  editor.Components.addType(grapesTagName, {
    isComponent: (el: Element) => {
      if (el.tagName?.toLowerCase() === grapesTagName) {
        return { type: grapesTagName };
      }

      return false;
    },
    model: {
      defaults: {
        tagName: grapesTagName,
        draggable: true,
        droppable: false,
        stylable: true,
      },
    },
  });
}
