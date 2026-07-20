// Runs every verification suite against fresh servers, in order.
// Usage: npm run verify:all
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const SUITES = [
  'verify-account-summary',
  'verify-worker-billing',
  'verify-account-flow',
  'verify-section1',
  'verify-section2',
  'verify-section3',
  'verify-section5',
  'verify-parity',
  'verify-parity2',
  'verify-editor-nav',
  'verify-responsive',
  'verify-breakpoints',
  'verify-stripe',
  'verify-invariants',
  'verify-deploy',
  'verify-client-styling',
  'verify-funnel',
];

const startServer = (args) =>
  spawn('npx', args, { cwd: pkgRoot, detached: true, stdio: 'ignore' });

const waitFor = async (url, label, timeoutMs = 90000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} did not become ready at ${url}`);
};

const kill = (child) => {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
};

console.log('› building (wrangler suites run against dist/)');
const build = spawnSync('npm', ['run', 'build'], { cwd: pkgRoot, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}

console.log('› starting vite (:5199) and wrangler dev (:8787)');
const vite = startServer(['vite', '--port', '5199', '--strictPort']);
const wrangler = startServer(['wrangler', 'dev', '--port', '8787']);

let failedSuites = 0;
try {
  await waitFor('http://localhost:5199/', 'vite');
  await waitFor('http://localhost:8787/', 'wrangler dev');

  for (const suite of SUITES) {
    const started = Date.now();
    const run = spawnSync('node', [join(here, `${suite}.mjs`)], { cwd: pkgRoot, encoding: 'utf8' });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    const summary = output.trim().split('\n').at(-1) ?? '(no output)';
    const seconds = ((Date.now() - started) / 1000).toFixed(0);
    if (run.status === 0) {
      console.log(`PASS ${suite} — ${summary} (${seconds}s)`);
    } else {
      failedSuites += 1;
      console.log(`FAIL ${suite} (${seconds}s)`);
      console.log(output.trim().split('\n').slice(-25).join('\n'));
    }
  }
} finally {
  kill(vite);
  kill(wrangler);
}

console.log(`\n${SUITES.length - failedSuites}/${SUITES.length} suites passed`);
process.exit(failedSuites ? 1 : 0);
