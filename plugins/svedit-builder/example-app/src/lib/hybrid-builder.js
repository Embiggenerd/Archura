function clone(value) {
  return structuredClone(value);
}

function createRichTextDoc(text = '') {
  return {
    document_id: 'page_1',
    nodes: {
      page_1: {
        id: 'page_1',
        type: 'page',
        body: ['text_1']
      },
      text_1: {
        id: 'text_1',
        type: 'text',
        content: {
          text,
          annotations: []
        }
      }
    }
  };
}

function getRichTextPlainText(doc) {
  const documentNode = doc?.nodes?.[doc?.document_id];
  if (!documentNode || !Array.isArray(documentNode.body)) return '';

  return documentNode.body
    .map((nodeId) => doc.nodes[nodeId]?.content?.text ?? '')
    .join('\n')
    .trim();
}

function defaultValueForField(field) {
  if (field.type === 'rich_text') return createRichTextDoc(field.defaultValue ?? '');
  return field.defaultValue ?? null;
}

function createComponentInstance(definition, id = `${definition.id}_1`) {
  const props = {};
  const richText = {};

  for (const [key, field] of Object.entries(definition.fields ?? {})) {
    const value = defaultValueForField(field);
    if (field.type === 'rich_text') {
      richText[key] = value;
    } else {
      props[key] = value;
    }
  }

  return {
    id,
    type: definition.id,
    props,
    richText
  };
}

function createPageState(definitions = [], instances = []) {
  const registry = new Map(definitions.map((definition) => [definition.id, definition]));
  return {
    registry,
    instances: clone(instances)
  };
}

function addComponentInstance(pageState, definitionId, id) {
  const definition = pageState.registry.get(definitionId);
  if (!definition) {
    throw new Error(`Unknown component definition: ${definitionId}`);
  }

  const instance = createComponentInstance(definition, id ?? `${definitionId}_${pageState.instances.length + 1}`);
  return {
    ...pageState,
    instances: [...pageState.instances, instance]
  };
}

function updateComponentProp(pageState, instanceId, key, value) {
  return {
    ...pageState,
    instances: pageState.instances.map((instance) =>
      instance.id === instanceId
        ? { ...instance, props: { ...instance.props, [key]: value } }
        : instance
    )
  };
}

function updateComponentRichText(pageState, instanceId, key, doc) {
  return {
    ...pageState,
    instances: pageState.instances.map((instance) =>
      instance.id === instanceId
        ? { ...instance, richText: { ...instance.richText, [key]: clone(doc) } }
        : instance
    )
  };
}

function getRenderProps(instance) {
  const richTextProps = Object.fromEntries(
    Object.entries(instance.richText ?? {}).map(([key, doc]) => [key, getRichTextPlainText(doc)])
  );

  return {
    ...instance.props,
    ...richTextProps
  };
}

export {
  addComponentInstance,
  createComponentInstance,
  createPageState,
  createRichTextDoc,
  getRenderProps,
  getRichTextPlainText,
  updateComponentProp,
  updateComponentRichText
};
