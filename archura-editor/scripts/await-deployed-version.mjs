// Post-deploy gate: poll /api/version until the live worker reports the
// commit we just deployed, so `npm run deploy` only exits 0 once the new
// version is actually serving. Origin overridable for other environments:
//   VERIFY_ORIGIN=https://staging.example node scripts/await-deployed-version.mjs
import { execSync } from 'node:child_process';

const origin = process.env.VERIFY_ORIGIN ?? 'https://envelopment.ai';
const expected = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== '';
if (dirty) {
  console.warn('⚠ working tree is dirty — the deployed code includes uncommitted changes beyond this commit sha');
}

const deadline = Date.now() + 60_000;
let last = '(no response yet)';
process.stdout.write(`verifying ${origin}/api/version reports ${expected.slice(0, 12)}… `);
while (Date.now() < deadline) {
  const body = await fetch(`${origin}/api/version`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { commit: `(http ${r.status})` }))
    .catch((error) => ({ commit: `(${error.message})` }));
  last = body.commit;
  if (body.commit === expected) {
    console.log(`✓ live (deployed_at ${body.deployed_at})`);
    process.exit(0);
  }
  process.stdout.write('.');
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error(`\n✗ timed out after 60s — live version reports: ${last}`);
console.error('The upload may have succeeded anyway; check `wrangler deployments list`.');
process.exit(1);
