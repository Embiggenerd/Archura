// Step 7 pipeline, compiler half: run the real Plasmic->Archura exporter on
// the fixture model, materialize its generated ESM files, bundle each module
// self-contained (the shape the editor's <script type=module> injection
// needs), and convert modulePath -> served moduleUrl for the registry.
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wabDir = process.env.PLASMIC_WAB ?? join(here, '..', '..', '..', 'plasmic', 'platform', 'wab');
const generatedDir = join(here, 'generated');
const outDir = join(here, 'out-real');
const bundleJson = join(generatedDir, 'bundle.json');

rmSync(generatedDir, { recursive: true, force: true });
rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(generatedDir, 'plasmic'), { recursive: true });
mkdirSync(outDir, { recursive: true });

// 1. Run the exporter. Import specifiers are relative to the materialized
//    location (generated/plasmic/ -> ../../../ -> archura-editor/).
execFileSync(
  'yarn',
  [
    'run-ts',
    'src/wab/shared/archura-exporter/emit-fixture.ts',
    '--out', bundleJson,
    '--base', '../../../src/components/base/Base.js',
    '--pagebase', '../../../src/components/base/PageBase.js',
    '--lit', 'lit',
  ],
  { cwd: wabDir, stdio: 'inherit', env: { ...process.env, SKIP_YARN_COREPACK_CHECK: '1' } }
);

const bundle = JSON.parse(readFileSync(bundleJson, 'utf8'));
if (bundle.diagnostics.some((d) => d.severity === 'error')) {
  throw new Error('Export produced error diagnostics');
}

// 2. Materialize generated sources exactly as emitted.
for (const file of bundle.files) {
  writeFileSync(join(generatedDir, file.path), file.source);
}

// 3. Bundle each generated module self-contained (Lit + Base inlined).
await build({
  entryPoints: bundle.files.map((file) => join(generatedDir, file.path)),
  bundle: true,
  format: 'esm',
  outdir: outDir,
  sourcemap: true,
  logLevel: 'info',
});

// 4. modulePath -> served moduleUrl. The editor must only ever see moduleUrl.
const definitions = bundle.definitions.map(({ modulePath, ...definition }) => ({
  ...definition,
  moduleUrl: `/out-real/${modulePath.split('/').at(-1)}`,
}));
for (const definition of definitions) {
  if (!definition.moduleUrl || 'modulePath' in definition) {
    throw new Error('Definition conversion failed');
  }
}
writeFileSync(join(outDir, 'registry.json'), JSON.stringify(definitions, null, 2));

// 5. Host bundle (unchanged editor + real-registry harness glue).
await build({
  entryPoints: [join(here, 'host-entry-real.js')],
  bundle: true,
  format: 'esm',
  outfile: join(outDir, 'host.js'),
  sourcemap: true,
  logLevel: 'info',
});

console.log(`Materialized ${bundle.files.length} generated modules; registry has ${definitions.length} definitions.`);
