// Bundles each component as a self-contained ESM module (lit inlined) so
// published sites and white-label embeds can import them with one URL.
// Output: dist/components/<path>.js, served by the site Worker.
import { build } from 'esbuild';

const entries = ['cards/Card', 'heroes/Hero', 'media/Image', 'pages/Landing'];

await Promise.all(
  entries.map((entry) =>
    build({
      entryPoints: [`src/components/${entry}.js`],
      bundle: true,
      format: 'esm',
      minify: true,
      outfile: `dist/components/${entry}.js`,
    })
  )
);

console.log(`built ${entries.length} component modules into dist/components/`);
