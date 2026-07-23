const origin = process.env.ARCHURA_ORIGIN ?? 'http://localhost:8787';

// This suite needs the local Go core and its development mailbox. The
// aggregate editor suite also runs without core, so skip cleanly there.
let probeStatus = 'unreachable';
for (let attempt = 0; attempt < 4; attempt++) {
  const probe = await fetch(new URL('/api/dev/mailbox', origin)).catch(() => null);
  probeStatus = probe?.status ?? 'unreachable';
  if (probeStatus === 200) break;
  await new Promise((resolve) => setTimeout(resolve, 2500));
}
if (probeStatus !== 200) {
  console.log(`SKIP — account flow needs wrangler dev + local core mailbox (probe: ${probeStatus})`);
  process.exit(0);
}

const suffix = Date.now().toString(36);
const ownerEmail = `owner-${suffix}@example.com`;
const memberEmail = `member-${suffix}@example.com`;
const organizationName = `Account flow ${suffix}`;
const organizationSlug = `account-flow-${suffix}`;
const site = `account-${suffix}`;

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function json(path, options = {}) {
  const response = await fetch(new URL(path, origin), options);
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function registerAndConfirm(email) {
  const registered = await json('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  expect(registered.response.status === 201, `register ${email}: ${registered.response.status}`);
  const mailbox = await json('/api/dev/mailbox');
  const confirmation = mailbox.body.confirmations.find((entry) => entry.email === email && !entry.used);
  expect(confirmation?.confirm_url, `confirmation missing for ${email}`);
  const confirmed = await fetch(confirmation.confirm_url, { redirect: 'manual' });
  expect(confirmed.status === 200, `confirm ${email}: ${confirmed.status}`);
  const cookie = confirmed.headers.get('set-cookie')?.split(';')[0];
  expect(cookie?.startsWith('archura_session='), `session cookie missing for ${email}`);
  return cookie;
}

const accountPage = await fetch(new URL('/account/', origin));
expect(accountPage.status === 200 && (await accountPage.text()).includes('Your Envelopment account'), 'account page missing');

const ownerCookie = await registerAndConfirm(ownerEmail);
let ownerMe = await json('/api/me', { headers: { Cookie: ownerCookie } });
expect(ownerMe.response.status === 200 && ownerMe.body.email_verified_at, 'owner email is not verified');

const createdOrganization = await json('/api/organizations', {
  method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: organizationName, slug: organizationSlug }),
});
expect(createdOrganization.response.status === 201, `create organization: ${createdOrganization.response.status}`);
const organizationID = createdOrganization.body.id;

const claimed = await json('/api/sites', {
  method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ site, organizationId: organizationID }),
});
expect(claimed.response.status === 201, `claim site: ${claimed.response.status}`);

for (const path of ['pages/Landing', 'payments/StripePayment']) {
  const saved = await fetch(new URL(`/api/artifacts/${site}/${path}`, origin), {
    method: 'PUT', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { componentPath: path.split('/') }, snapshot: { html: '<div></div>', css: '' } }),
  });
  expect(saved.status === 204, `save ${path}: ${saved.status}`);
}
const embed = await fetch(new URL(`/api/embeds/${site}/Landing.js`, origin), {
  method: 'PUT', headers: { Cookie: ownerCookie, 'Content-Type': 'text/javascript' }, body: 'export default true;',
});
expect(embed.status === 204, `save embed: ${embed.status}`);

ownerMe = await json('/api/me', { headers: { Cookie: ownerCookie } });
const summary = ownerMe.body.organizations.find((organization) => organization.id === organizationID);
expect(summary?.component_count === 2, `component count = ${summary?.component_count}, want 2`);

const invited = await json(`/api/organizations/${organizationID}/invitations`, {
  method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: memberEmail }),
});
expect(invited.response.status === 201, `invite member: ${invited.response.status}`);
const invitationID = invited.body.id;
const repeatedInvites = await Promise.all([1, 2].map(() => json(`/api/organizations/${organizationID}/invitations`, {
  method: 'POST', headers: { Cookie: ownerCookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: memberEmail }),
})));
expect(
  repeatedInvites.every(({ response, body }) => response.status === 201 && body.id === invitationID),
  `repeated invite did not reuse ${invitationID}: ${repeatedInvites.map(({ response, body }) => `${response.status}:${body?.id}`).join(', ')}`
);
const invitationMailbox = await json('/api/dev/mailbox');
expect(invitationMailbox.body.invitations.some((entry) => entry.invitation_id === invitationID), 'invitation email missing');

const memberCookie = await registerAndConfirm(memberEmail);
let memberMe = await json('/api/me', { headers: { Cookie: memberCookie } });
expect(memberMe.body.invitations.some((invitation) => invitation.id === invitationID), 'recipient invitation missing');
const accepted = await json(`/api/invitations/${invitationID}/accept`, {
  method: 'POST', headers: { Cookie: memberCookie },
});
expect(accepted.response.status === 200, `accept invitation: ${accepted.response.status}`);
memberMe = await json('/api/me', { headers: { Cookie: memberCookie } });
expect(memberMe.body.organizations.some((organization) => organization.id === organizationID && organization.role === 'member'), 'accepted membership missing');
expect(memberMe.body.invitations.every((invitation) => invitation.id !== invitationID), 'accepted invitation still pending');

console.log('account page, verified email, component count, and invitation flow passed on port 8787');
