// Run every ./e2e suite. Does not start servers — bring the stack up first.
// Exit 1 if any suite fails; exit 2 if a suite reports infra missing.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const SUITES = ['stories-client-registration.mjs', 'editor.mjs', 'funnel.mjs'];

let worst = 0;
for (const suite of SUITES) {
  const started = Date.now();
  console.log(`\n› ${suite}`);
  const run = spawnSync(process.execPath, [join(here, suite)], {
    cwd: here,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(out);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  const code = run.status ?? 1;
  if (code === 0) {
    console.log(`OK ${suite} (${seconds}s)`);
  } else {
    console.log(`FAIL ${suite} exit=${code} (${seconds}s)`);
    worst = Math.max(worst, code);
  }
}

process.exit(worst);
