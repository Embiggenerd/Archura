// Bundles each component as a self-contained ESM module (lit inlined) so
// published sites and white-label embeds can import them with one URL.
// Output: dist/components/<path>.js, served by the site Worker.
// `--watch` keeps rebuilding on source changes (local dev via dev-up.sh).
import { build, context } from 'esbuild';

const entries = [
  'cards/Card',
  'heroes/Hero',
  'media/Image',
  'payments/StripePayment',
  'pages/Landing',
  'pages/Cards',
];

const configs = entries.map((entry) => ({
  entryPoints: [`src/components/${entry}.js`],
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: `dist/components/${entry}.js`,
}));

if (process.argv.includes('--watch')) {
  const contexts = await Promise.all(configs.map((config) => context(config)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`watching ${entries.length} component modules → dist/components/`);
} else {
  await Promise.all(configs.map((config) => build(config)));
  console.log(`built ${entries.length} component modules into dist/components/`);
}
