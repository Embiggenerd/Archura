// One-flow test-client registration (the minimal registration process):
// 1. claim the edge namespace `sites/<slug>` on the Worker (IP-gated),
// 2. create the core tenant with the same slug, passing the claim token as
//    edge_claim_token so core stores the tenant → namespace binding,
// 3. append the credentials to the repo-root .env and print the embed snippet.
// Core is optional: without a reachable core + admin key the client is
// edge-only (enough for the styling milestone) and step 2 is skipped.
//
// Usage: node scripts/register-test-client.mjs [slug]
//   WORKER_URL (default http://localhost:8787), CORE_ADMIN_KEY (or .env)
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const WORKER = process.env.WORKER_URL || 'http://localhost:8787';
const slug = process.argv[2] || `client-${Date.now().toString(36)}`;
const envPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

const envValue = (name) => {
  if (process.env[name]) return process.env[name];
  try {
    return readFileSync(envPath, 'utf8').match(new RegExp(`^${name}=(\\S+)`, 'm'))?.[1] ?? '';
  } catch {
    return '';
  }
};

// Append on its own line even when the file lacks a trailing newline
const appendEnvLine = (line) => {
  let prefix = '';
  try {
    const current = readFileSync(envPath, 'utf8');
    if (current.length > 0 && !current.endsWith('\n')) prefix = '\n';
  } catch {
    // no .env yet
  }
  appendFileSync(envPath, `${prefix}${line}\n`);
};

// --- 1. Claim the edge namespace ---
const claimRes = await fetch(`${WORKER}/api/sites`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ site: slug }),
});
if (!claimRes.ok) {
  console.error(`FAIL claim: ${claimRes.status} ${await claimRes.text()}`);
  process.exit(1);
}
const { site, token, url } = await claimRes.json();
console.log(`claimed namespace: sites/${site} → ${url}`);

// --- 2. Create the core tenant + binding (optional) ---
// Talks to the local core DIRECTLY (the blanket /api/core proxy is dev-only
// and this script has the keys anyway): CORE_URL + CORE_SERVICE_KEY as
// printed by dev-up.sh, same convention as verify-core-identity.mjs.
const admin = envValue('CORE_ADMIN_KEY');
const CORE = process.env.CORE_URL || 'http://localhost:8080';
const service = envValue('CORE_SERVICE_KEY');
if (admin) {
  const origin = new URL(WORKER).origin;
  const clientRes = await fetch(`${CORE}/v1/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${admin}`,
      ...(service ? { 'X-Archura-Service-Authorization': `Bearer ${service}` } : {}),
    },
    body: JSON.stringify({
      name: `Test client ${site}`,
      slug: site,
      allowed_origins: [origin],
      edge_claim_token: token,
    }),
  });
  if (clientRes.ok) {
    const client = await clientRes.json();
    console.log(`core tenant created: ${client.id} (pk: ${client.publishable_key})`);
    appendEnvLine(`ARCHURA_CLIENT_PK_${site.replaceAll('-', '_')}=${client.publishable_key}`);
  } else {
    console.log(`core tenant skipped: ${clientRes.status} ${await clientRes.text()}`);
  }
} else {
  console.log('core tenant skipped: no CORE_ADMIN_KEY (edge-only client)');
}

// --- 3. Persist + print the embed snippet ---
appendEnvLine(`ARCHURA_CLIENT_TOKEN_${site.replaceAll('-', '_')}=${token}`);
console.log(`claim token appended to .env (ARCHURA_CLIENT_TOKEN_${site.replaceAll('-', '_')})`);

console.log(`\nEdit:  ${WORKER}/edit/?site=${site}`);
console.log(`\nGet embed code — paste on any page:\n`);
console.log(`  <script type="module" src="${WORKER}/s/${site}/embed/StripePayment.js"></script>`);
console.log(`  <archura-stripe-payment></archura-stripe-payment>\n`);
