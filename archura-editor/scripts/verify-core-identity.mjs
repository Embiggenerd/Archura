// Verifies the running Go core's two-tier identity + ephemeral-token spine:
// register client -> configure component -> mint component-session, with origin
// and secret enforcement. Skips unless the core is reachable and CORE_ADMIN_KEY
// is set (the key is generated fresh per core boot):
//   PLATFORM_ADMIN_KEY from `go run ./cmd/devkeys admin`
//   CORE_ADMIN_KEY=<that key> node scripts/verify-core-identity.mjs
const CORE = process.env.CORE_URL || 'http://localhost:8080';
const ADMIN = process.env.CORE_ADMIN_KEY || '';
const SERVICE = process.env.CORE_SERVICE_KEY || '';
const ORIGIN = 'http://localhost:5199';

const reachable = await fetch(`${CORE}/healthz`).then((r) => r.ok).catch(() => false);
if (!reachable || !ADMIN) {
  console.log(`SKIP — core not reachable at ${CORE} or CORE_ADMIN_KEY unset`);
  process.exit(0);
}

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` — ${detail}`}`);
};
const post = (path, token, body) =>
  fetch(`${CORE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(SERVICE ? { 'X-Archura-Service-Authorization': `Bearer ${SERVICE}` } : {}),
    },
    body: JSON.stringify(body),
  });

const slug = `t-${Date.now().toString(36)}`;

// 1. Register client (platform admin)
const clientRes = await post('/v1/clients', ADMIN, { name: 'Test', slug, allowed_origins: [ORIGIN] });
const client = await clientRes.json();
check('client: registered with publishable + secret keys', clientRes.status === 201 && /^pk_/.test(client.publishable_key) && /^sk_/.test(client.secret_key));

// 2. Configure a component (tenant secret)
const compRes = await post('/v1/components', client.secret_key, {
  mode: 'payment',
  stripe_price_id: 'price_test123',
  success_url: `${ORIGIN}/success`,
  cancel_url: `${ORIGIN}/cancel`,
  allowed_origins: [ORIGIN],
});
const comp = await compRes.json();
check('component: created and configured with a Stripe price', compRes.status === 201 && /^cmp_/.test(comp.id));

// 3. Mint a component-session (tenant secret — the client backend, never the browser)
const sessRes = await post('/v1/component-sessions', client.secret_key, {
  component_id: comp.id,
  external_user_id: 'user_42',
  origin: ORIGIN,
});
const sess = await sessRes.json();
check('session: minted a scoped bearer token bound to the origin', sessRes.status === 201 && /^ct_/.test(sess.access_token) && sess.expires_in === 600);

// 4. Origin enforcement
const badOrigin = await post('/v1/component-sessions', client.secret_key, { component_id: comp.id, origin: 'http://evil.example' });
check('enforcement: a disallowed origin is rejected (403)', badOrigin.status === 403);

// 5. Secret required — the publishable key cannot mint
const pkMint = await post('/v1/component-sessions', client.publishable_key, { component_id: comp.id, origin: ORIGIN });
check('enforcement: the publishable key cannot mint a session (401)', pkMint.status === 401);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
