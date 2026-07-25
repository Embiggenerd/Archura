// Builds the harness: the host bundle (unchanged editor source + harness
// glue) and each fixture module as a self-contained ESM bundle, the same
// shape the integration host will publish for real compiler output.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: [join(here, 'host-entry.js')],
  bundle: true,
  format: 'esm',
  outfile: join(out, 'host.js'),
  sourcemap: true,
  logLevel: 'info',
});

await build({
  entryPoints: [join(here, 'fixtures', 'PricingCard.js'), join(here, 'fixtures', 'Landing.js')],
  bundle: true,
  format: 'esm',
  outdir: out,
  sourcemap: true,
  logLevel: 'info',
});
