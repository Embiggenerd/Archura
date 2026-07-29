// Pull a customer's component out of R2 into the local artifact store, where
// the dev editor serves it (docs/PLAN_FILE_ON_DEMAND.md step 2). One-way by
// design: there is no push — changes go back through fork-apply or a proposal.
//
//   node scripts/pull-artifact.mjs --list
//   node scripts/pull-artifact.mjs sites/<site> [--as <name>] [--drafts]
//   node scripts/pull-artifact.mjs orgs/<orgId>/designs/<designId> --as <name> [--drafts]
//
// --list needs no arguments: it enumerates every pullable site and design in
// the bucket and prints the exact command for each.
//
// Auth: a READ-ONLY R2 API token scoped to the bucket.
//   R2_PULL_ACCOUNT_ID, R2_PULL_ACCESS_KEY_ID, R2_PULL_SECRET,
//   R2_PULL_BUCKET (default: archura-artifacts)
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AwsClient } from 'aws4fetch';

// The R2_PULL_* vars usually live in the repo-root .env; already-exported
// shell variables take precedence over file values.
for (const envFile of ['../../.env', '../.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(envFile, import.meta.url)));
  } catch {
    // no file there — fine
  }
}

const ARTIFACTS_DIR = fileURLToPath(new URL('../artifacts/', import.meta.url));
const USAGE =
  'Usage: pull-artifact.mjs --list | sites/<site> [--as <name>] [--drafts] | orgs/<orgId>/designs/<designId> --as <name> [--drafts]';

const args = process.argv.slice(2);
const listMode = args.includes('--list');
const prefix = args.find((arg) => !arg.startsWith('--'));
const alias = args.includes('--as') ? args[args.indexOf('--as') + 1] : null;
const includeDrafts = args.includes('--drafts');

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    console.error(`Set ${name} (a read-only R2 API token scoped to the bucket).`);
    process.exit(1);
  }
  return value;
};
const account = required('R2_PULL_ACCOUNT_ID');
const bucket = process.env.R2_PULL_BUCKET ?? 'archura-artifacts';
const client = new AwsClient({
  accessKeyId: required('R2_PULL_ACCESS_KEY_ID'),
  secretAccessKey: required('R2_PULL_SECRET'),
  service: 's3',
  region: 'auto',
});
const endpoint = `https://${account}.r2.cloudflarestorage.com/${bucket}`;

const isDraftKey = (key) => key.endsWith('.draft.json') || key.split('/').includes('draft');

// One ListObjectsV2 page walk. With a delimiter, returns { prefixes };
// without, returns { objects } carrying key/lastModified/etag.
async function listPage(listPrefix, delimiter = null) {
  const objects = [];
  const prefixes = [];
  let token = null;
  do {
    const url = new URL(endpoint);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('prefix', listPrefix);
    if (delimiter) url.searchParams.set('delimiter', delimiter);
    if (token) url.searchParams.set('continuation-token', token);
    const response = await client.fetch(url);
    if (!response.ok) throw new Error(`List failed: ${response.status} ${await response.text()}`);
    const xml = await response.text();
    for (const entry of xml.matchAll(/<Contents>.*?<\/Contents>/gs)) {
      objects.push({
        key: entry[0].match(/<Key>(.*?)<\/Key>/)[1],
        lastModified: entry[0].match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? '',
        etag: entry[0].match(/<ETag>(.*?)<\/ETag>/)?.[1]?.replaceAll('&quot;', '"') ?? '',
      });
    }
    for (const entry of xml.matchAll(/<CommonPrefixes><Prefix>(.*?)<\/Prefix><\/CommonPrefixes>/gs)) {
      prefixes.push(entry[1]);
    }
    token = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1] ?? null;
  } while (token);
  return { objects, prefixes };
}

async function getObject(key) {
  const response = await client.fetch(`${endpoint}/${key}`);
  if (!response.ok) throw new Error(`Get ${key} failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

if (listMode) {
  const { prefixes: sitePrefixes } = await listPage('sites/', '/');
  console.log(`sites (${sitePrefixes.length}):`);
  for (const sitePrefix of sitePrefixes) {
    const site = sitePrefix.split('/')[1];
    console.log(`  node scripts/pull-artifact.mjs sites/${site}`);
  }

  const { prefixes: orgPrefixes } = await listPage('orgs/', '/');
  const designs = [];
  for (const orgPrefix of orgPrefixes) {
    const { prefixes: designPrefixes } = await listPage(`${orgPrefix}designs/`, '/');
    designs.push(...designPrefixes.map((p) => p.replace(/\/$/, '')));
  }
  console.log(`designs (${designs.length}):`);
  for (const design of designs) {
    const suggested = design.split('/').at(-1).replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'pulled-design';
    console.log(`  node scripts/pull-artifact.mjs ${design} --as ${suggested}`);
  }
  process.exit(0);
}

const siteMatch = prefix?.match(/^sites\/([a-z0-9-]+)$/);
const designMatch = prefix?.match(/^orgs\/([^/]+)\/designs\/([^/]+)$/);
if (!siteMatch && !designMatch) {
  console.error(USAGE);
  process.exit(1);
}
if (designMatch && !alias) {
  console.error('Design pulls need --as <local-site-name>: designs have no site namespace locally.');
  process.exit(1);
}
const localName = alias ?? siteMatch[1];
if (!/^[a-z0-9-]+$/.test(localName)) {
  console.error(`Invalid local name "${localName}" — lowercase letters, digits, dashes.`);
  process.exit(1);
}

const componentPathOf = (artifact) => {
  const value = artifact?.config?.componentPath;
  return Array.isArray(value) ? value.join('/') : typeof value === 'string' && value ? value : null;
};

// Maps a bucket key to its local path under artifacts/sites/<localName>/.
// Sites mirror R2 verbatim; design keys are reshaped into the site layout the
// dev adapter expects (artifact.json -> <componentPath>.json).
function localPath(key, componentPath) {
  const rest = key.slice(prefix.length + 1);
  if (siteMatch) return rest;
  if (rest === 'artifact.json') return `${componentPath}.json`;
  if (rest === 'artifact.draft.json') return `${componentPath}.draft.json`;
  if (rest.startsWith('embed/')) return rest;
  return null; // unknown design key shapes are skipped, not guessed at
}

const { objects } = await listPage(`${prefix}/`);
if (objects.length === 0) {
  console.error(`Nothing under ${prefix}/ — run with --list to see what exists.`);
  process.exit(1);
}

let componentPath = null;
if (designMatch) {
  const artifactBytes = await getObject(`${prefix}/artifact.json`).catch(() => null);
  if (!artifactBytes) {
    console.error(`${prefix}/artifact.json missing — the design has never been published.`);
    process.exit(1);
  }
  componentPath = componentPathOf(JSON.parse(artifactBytes.toString()));
  if (!componentPath) {
    console.error('Artifact has no config.componentPath — cannot place it in the local layout.');
    process.exit(1);
  }
}

// Replace the whole target directory: a stale draft or removed embed left
// behind would shadow what was just pulled.
const targetDir = path.join(ARTIFACTS_DIR, 'sites', localName);
await fs.rm(targetDir, { recursive: true, force: true });

let pulled = 0;
for (const object of objects) {
  if (!includeDrafts && isDraftKey(object.key)) continue;
  const relative = localPath(object.key, componentPath);
  if (relative === null) {
    console.log(`skip ${object.key} (no local mapping)`);
    continue;
  }
  const destination = path.join(targetDir, relative);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, await getObject(object.key));
  console.log(`${object.key} -> artifacts/sites/${localName}/${relative}  ${object.lastModified} ${object.etag}`);
  pulled += 1;
}

const editorUrl = `/edit/?localSite=${localName}${componentPath ? `&component=${encodeURIComponent(componentPath)}` : ''}`;
console.log(`\npulled ${pulled} object(s) from ${prefix}/`);
console.log(`open: ${editorUrl}  (on the Vite dev server: npm run dev:editor — NOT the built app on :8787)`);
