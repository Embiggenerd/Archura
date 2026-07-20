import { publishedComponentCount } from '../workers/site-worker.js';

const keys = [
  'sites/acme/meta.json',
  'sites/acme/pages/Landing.json',
  'sites/acme/payments/StripePayment.json',
  'sites/acme/embed/Landing.js',
  'sites/acme/draft/cards/Card.json',
  'sites/acme/assets/logo.png',
  'sites/store/pages/Home.json',
];

const bucket = {
  async list({ prefix, cursor }) {
    const matches = keys.filter((key) => key.startsWith(prefix));
    const start = cursor ? Number(cursor) : 0;
    const objects = matches.slice(start, start + 1).map((key) => ({ key }));
    const next = start + objects.length;
    return { objects, truncated: next < matches.length, cursor: String(next) };
  },
};

const count = await publishedComponentCount({ ARTIFACTS: bucket }, ['acme', 'store']);
if (count !== 3) throw new Error(`component count = ${count}, want 3`);
console.log('account summary counts only published component artifacts');
