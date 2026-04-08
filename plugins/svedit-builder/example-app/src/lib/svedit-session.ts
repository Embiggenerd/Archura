import { Session, define_document_schema } from '$lib/svedit';
import Page from '$lib/nodes/Page.svelte';
import Text from '$lib/nodes/Text.svelte';

const schema = define_document_schema({
  page: {
    kind: 'document',
    properties: {
      body: {
        type: 'node_array',
        node_types: ['text'],
        default_node_type: 'text'
      }
    }
  },
  text: {
    kind: 'text',
    properties: {
      content: {
        type: 'annotated_text',
        node_types: [],
        allow_newlines: true
      }
    }
  }
});

const doc = {
  document_id: 'page_1',
  nodes: {
    page_1: {
      id: 'page_1',
      type: 'page',
      body: ['text_1', 'text_2']
    },
    text_1: {
      id: 'text_1',
      type: 'text',
      content: {
        text: 'Editable Registration Card',
        annotations: []
      }
    },
    text_2: {
      id: 'text_2',
      type: 'text',
      content: {
        text: 'This page uses a real Svedit session. Edit the text directly in the rendered page.',
        annotations: []
      }
    }
  }
};

const config = {
  node_components: {
    Page,
    Text
  }
};

export function createDemoSession() {
  return new Session(schema, structuredClone(doc), config);
}
