import 'grapesjs/dist/css/grapes.min.css';
import { litWcPlugin } from './lit-wc-plugin';
import { loadComponent } from './load-component';

type GrapesJSModule = typeof import('grapesjs');

export async function initEditor(container: HTMLElement, componentPath: string[] = ['heroes', 'Hero']) {
  console.log('[init-editor] booting editor', { componentPath });
  const grapesjs: GrapesJSModule = await import('grapesjs');
  const { moduleUrl, grapesTagName, storageKey } = await loadComponent(componentPath);
  console.log('[init-editor] loaded component config', { moduleUrl, grapesTagName, storageKey });
  const initialComponents = {
    type: 'wrapper',
    components: [
      {
        type: grapesTagName,
        tagName: grapesTagName,
      },
    ],
  };

  const editor = grapesjs.default.init({
    container,
    height: '100%',
    width: 'auto',
    storageManager: {
      type: 'local',
      autosave: true,
      autoload: true,
      options: {
        local: {
          key: storageKey,
        },
      },
    },
    selectorManager: {
      componentFirst: true
    },
    canvas: {
      scripts: []
    },
    plugins: [
      (editorInstance: any) => litWcPlugin(editorInstance, {
        moduleUrl,
        grapesTagName
      })
    ],
    fromElement: false,
    components: initialComponents
  });

  console.log('[init-editor] grapesjs initialized, waiting for iframe component readiness');
  await ((editor as any).__litWcReady ?? Promise.resolve());
  console.log('[init-editor] iframe component ready');

  return editor;
}
