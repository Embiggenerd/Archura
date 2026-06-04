import { registerWebComponent } from './register-web-component';

type EditorLike = {
  Canvas: {
    getDocument: () => Document;
    getWindow: () => Window | null;
  };
  on: (event: string, handler: () => void | Promise<void>) => void;
  [key: string]: unknown;
};

export type LitWcPluginOptions = {
  moduleUrl: string;
  grapesTagName: string;
};

export function litWcPlugin(editor: EditorLike, options: LitWcPluginOptions) {
  const { moduleUrl, grapesTagName } = options;
  const waitForDefinition = (canvasWindow: Window | null, timeoutMs: number) =>
    new Promise<void>((resolve, reject) => {
      if (!canvasWindow?.customElements?.whenDefined) {
        resolve();
        return;
      }

      const timeoutId = window.setTimeout(() => {
        reject(new Error(`Timed out waiting for custom element definition: ${grapesTagName}`));
      }, timeoutMs);

      canvasWindow.customElements
        .whenDefined(grapesTagName)
        .then(() => {
          window.clearTimeout(timeoutId);
          resolve();
        })
        .catch((error) => {
          window.clearTimeout(timeoutId);
          reject(error);
        });
    });

  registerWebComponent(editor as any, grapesTagName);
  editor.__litWcReady = new Promise<void>((resolve, reject) => {
    editor.on('load', async () => {
      try {
        console.log('[lit-wc-plugin] editor load fired', { grapesTagName, moduleUrl });
        const canvasDocument = editor.Canvas.getDocument();
        const canvasWindow = editor.Canvas.getWindow();

        if (!canvasDocument?.head?.querySelector(`script[data-builder-module="${moduleUrl}"]`)) {
          console.log('[lit-wc-plugin] injecting component module into iframe', { moduleUrl });
          await new Promise<void>((resolveScript, rejectScript) => {
            const script = canvasDocument.createElement('script');
            script.type = 'module';
            script.src = moduleUrl;
            script.dataset.builderModule = moduleUrl;
            script.onload = () => {
              console.log('[lit-wc-plugin] iframe module loaded', { moduleUrl });
              resolveScript();
            };
            script.onerror = () => rejectScript(new Error(`Failed to load builder module: ${moduleUrl}`));
            canvasDocument.head.appendChild(script);
          });
        }

        console.log('[lit-wc-plugin] waiting for custom element definition', { grapesTagName });
        await waitForDefinition(canvasWindow, 5000);
        console.log('[lit-wc-plugin] custom element defined', { grapesTagName });

        resolve();
      } catch (error) {
        console.error('[lit-wc-plugin] failed to initialize component in iframe', error);
        reject(error);
      }
    });
  });
}
