// Unit test for history erasure ordering (in-memory bucket, no core).
// Invariants: history/ is purged before live keys, meta.json strictly last,
// and a failed history purge leaves the whole site intact and discoverable.
// Run: node scripts/verify-history-erasure.mjs
import assert from 'node:assert/strict';

import { releaseSiteObjects } from '../workers/site-worker.js';

const SITE = 'erasure-test';

function seededBucket() {
  const objects = new Map([
    [`sites/${SITE}/meta.json`, '{"status":"published"}'],
    [`sites/${SITE}/artifact.json`, '{}'],
    [`sites/${SITE}/embed/Landing.js`, 'export {};'],
    [`history/sites/${SITE}/artifact.json/2026-07-29T00:00:00.000Z-x`, '{}'],
  ]);
  const deletions = [];
  return {
    objects,
    deletions,
    failHistoryDeletes: false,
    async get(key) {
      const value = this.objects.get(key);
      if (value == null) return null;
      return { async json() { return JSON.parse(value); } };
    },
    async put(key, value) { this.objects.set(key, String(value)); },
    async delete(key) {
      if (this.failHistoryDeletes && key.startsWith('history/')) throw new Error('injected R2 failure');
      this.deletions.push(key);
      this.objects.delete(key);
    },
    async list({ prefix }) {
      return {
        objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
        truncated: false,
      };
    },
  };
}

// --- injected history-purge failure: nothing else is touched ---
const failing = seededBucket();
failing.failHistoryDeletes = true;
await assert.rejects(() => releaseSiteObjects({ ARTIFACTS: failing }, SITE), /injected R2 failure/);
assert.ok(failing.objects.has(`sites/${SITE}/meta.json`), 'failed purge keeps the site discoverable via meta');
assert.ok(failing.objects.has(`sites/${SITE}/artifact.json`), 'failed history purge leaves live keys untouched');

// --- clean run: history first, meta.json strictly last, everything gone ---
const bucket = seededBucket();
await releaseSiteObjects({ ARTIFACTS: bucket }, SITE);
assert.equal(bucket.objects.size, 0, 'full purge removes every key');
const historyIndex = bucket.deletions.findIndex((key) => key.startsWith('history/'));
const liveIndex = bucket.deletions.findIndex((key) => key.startsWith(`sites/${SITE}/`) && !key.endsWith('meta.json'));
assert.ok(historyIndex !== -1 && historyIndex < liveIndex, 'history purged before live keys');
assert.equal(bucket.deletions.at(-1), `sites/${SITE}/meta.json`, 'meta.json deleted last');

console.log('worker: erasure purges history before live keys, meta last; failed history purge leaves the site intact');
