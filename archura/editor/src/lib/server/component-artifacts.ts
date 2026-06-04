import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CanonicalArtifact } from '$lib/artifacts/artifact';

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function resolveArtifactsRoot() {
  const candidates = [
    path.resolve(process.cwd(), 'archura/component-data/exported/embed'),
    path.resolve(process.cwd(), '../component-data/exported/embed'),
    path.resolve(process.cwd(), 'component-data/exported/embed'),
  ];

  const existingCandidate = candidates.find((candidate) => existsSync(path.dirname(candidate)));
  return existingCandidate ?? candidates[0];
}

function validateArtifacts(artifacts: CanonicalArtifact[]) {
  if (!artifacts.length) {
    throw new Error('No artifacts were provided.');
  }

  const exportId = artifacts[0]?.meta.exportId;
  if (!exportId) {
    throw new Error('Missing exportId.');
  }
  if (!artifacts.every((artifact) => artifact.meta.exportId === exportId)) {
    throw new Error('Artifacts must share the same exportId.');
  }
}

function buildFileStem(artifactId: string, tagName: string) {
  return `${sanitizePathSegment(artifactId)}-${sanitizePathSegment(tagName.toLowerCase())}`;
}

function createWrapperModule(artifact: CanonicalArtifact) {
  const moduleUrl = JSON.stringify(artifact.config.moduleUrl);
  const wrapperTagName = JSON.stringify(artifact.config.wrapperTagName);
  const html = JSON.stringify(artifact.snapshot.html);
  const css = JSON.stringify(artifact.snapshot.css);

  return `const moduleUrl = ${moduleUrl};
const wrapperTagName = ${wrapperTagName};
const html = ${html};
const css = ${css};

await import(moduleUrl);

class ExportedComponentWrapper extends HTMLElement {
  connectedCallback() {
    const shadowRoot = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (shadowRoot.childNodes.length > 0) {
      return;
    }

    shadowRoot.innerHTML = \`<style>\${css}</style>\${html}\`;
  }
}

if (!customElements.get(wrapperTagName)) {
  customElements.define(wrapperTagName, ExportedComponentWrapper);
}
`;
}

function createDemoDocument(wrapperTagName: string, jsFileName: string) {
  const title = `${wrapperTagName} Demo`;
  const codeExample = `&lt;${wrapperTagName}&gt;&lt;/${wrapperTagName}&gt;`;

  return ['<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <title>${title}</title>`,
    '    <style>',
    '      body {',
    '        margin: 0;',
    '        padding: 24px;',
    '        background: #f3f4f6;',
    '        color: #111827;',
    '        font-family: Helvetica, Arial, sans-serif;',
    '      }',
    '',
    '      main {',
    '        max-width: 1200px;',
    '        margin: 0 auto;',
    '      }',
    '',
    '      .frame {',
    '        border: 1px solid rgba(17, 24, 39, 0.08);',
    '        background: white;',
    '        border-radius: 16px;',
    '        padding: 24px;',
    '        box-shadow: 0 16px 48px rgba(15, 23, 42, 0.08);',
    '      }',
    '',
    '      code {',
    '        display: inline-block;',
    '        margin-bottom: 16px;',
    '        padding: 4px 8px;',
    '        border-radius: 999px;',
    '        background: #e5e7eb;',
    '      }',
    '    </style>',
    `    <script type="module" src="./${jsFileName}"></script>`,
    '  </head>',
    '  <body>',
    '    <main>',
    `      <code>${codeExample}</code>`,
    '      <div class="frame">',
    `        <${wrapperTagName}></${wrapperTagName}>`,
    '      </div>',
    '    </main>',
    '  </body>',
    '</html>',
    '',
  ].join('\n');
}

export async function writeDerivedComponentArtifacts(artifacts: CanonicalArtifact[]) {
  validateArtifacts(artifacts);

  const exportId = sanitizePathSegment(artifacts[0].meta.exportId);
  const artifactDir = path.join(resolveArtifactsRoot(), exportId);
  await mkdir(artifactDir, { recursive: true });

  await Promise.all(
    artifacts.flatMap((artifact) => {
      const fileStem = buildFileStem(artifact.id, artifact.config.tagName);
      const htmlFileName = `${fileStem}.html`;
      const cssFileName = `${fileStem}.css`;
      const assetFileName = `${fileStem}.assets.json`;
      const jsFileName = `${fileStem}.js`;
      const demoFileName = `${fileStem}-demo.html`;
      const htmlPath = path.join(artifactDir, htmlFileName);
      const cssPath = path.join(artifactDir, cssFileName);
      const assetPath = path.join(artifactDir, assetFileName);
      const jsPath = path.join(artifactDir, jsFileName);
      const demoPath = path.join(artifactDir, demoFileName);

      return [
        writeFile(htmlPath, `${artifact.snapshot.html}\n`, 'utf8'),
        writeFile(cssPath, artifact.snapshot.css ? `${artifact.snapshot.css}\n` : '', 'utf8'),
        writeFile(assetPath, `${JSON.stringify(artifact.config.assets, null, 2)}\n`, 'utf8'),
        writeFile(jsPath, createWrapperModule(artifact), 'utf8'),
        writeFile(demoPath, createDemoDocument(artifact.config.wrapperTagName, jsFileName), 'utf8'),
      ];
    })
  );

  const manifest = {
    exportId,
    generatedAt: artifacts[0].meta.updatedAt,
    artifactIds: artifacts.map((artifact) => artifact.id),
    components: artifacts.map((artifact) => {
      const fileStem = buildFileStem(artifact.id, artifact.config.tagName);
      return {
        id: artifact.id,
        tagName: artifact.config.tagName,
        wrapperTagName: artifact.config.wrapperTagName,
        htmlFileName: `${fileStem}.html`,
        cssFileName: `${fileStem}.css`,
        assetFileName: `${fileStem}.assets.json`,
        jsFileName: `${fileStem}.js`,
        demoFileName: `${fileStem}-demo.html`,
      };
    }),
  };

  await Promise.all([
    writeFile(path.join(artifactDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
  ]);

  return {
    exportId,
    artifactDir,
    componentCount: artifacts.length,
  };
}
