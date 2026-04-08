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

const config = {
  node_components: {
    Page,
    Text
  }
};

export function createRichTextSession(doc) {
  return new Session(schema, structuredClone(doc), config);
}
