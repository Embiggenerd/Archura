import { isEmbedKey } from '../editor/store-keys.js';
import type { ArchuraStore, ArchuraStoreEntry } from '../editor/types.js';

/**
 * HTTP-backed ArchuraStore. The editor addresses objects by opaque string key;
 * this adapter maps that keyspace onto the reference server's routes — an
 * `embed/<name>` key is a per-client embed module (served as JS), any other key
 * is an artifact (its component path, stored as JSON). Routing on the key is the
 * adapter's job precisely so the editor never has to know the difference.
 *
 * `origin` is the server hosting the /api/embeds and /api/sites routes — the
 * Worker in production, the Vite dev server locally — and both expose the same
 * contract, so callers cannot tell the backends apart. A store without a `site`
 * is bare: artifact get/put only, no embeds or listing.
 */
function createHttpStore(options: {
  artifactBase: string;
  origin: string;
  site?: string;
  headers: Record<string, string>;
}): ArchuraStore {
  const { origin, site, headers } = options;
  const artifactBase = options.artifactBase.replace(/\/+$/, '');
  const urlFor = (key: string) =>
    isEmbedKey(key)
      ? `${origin}/api/embeds/${encodeURIComponent(site ?? '')}/${encodeURIComponent(key.slice('embed/'.length))}`
      : `${artifactBase}/${key.split('/').map(encodeURIComponent).join('/')}`;

  const store: ArchuraStore = {
    async get(key: string): Promise<string | null> {
      const url = urlFor(key);
      const response = await fetch(url, { headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Store get failed (${response.status}) for ${key}`);
      return response.text();
    },

    async put(key: string, value: string): Promise<void> {
      const url = urlFor(key);
      const contentType = isEmbedKey(key) ? 'text/javascript' : 'application/json';
      const response = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': contentType },
        body: value,
      });
      if (!response.ok) throw new Error(`Store put failed (${response.status}) for ${key}`);
    },

    async delete(key: string): Promise<void> {
      const response = await fetch(urlFor(key), { method: 'DELETE', headers });
      if (!response.ok && response.status !== 404) throw new Error(`Store delete failed (${response.status}) for ${key}`);
    },
  };

  // Only site-bound stores can enumerate (the list route is namespaced). The
  // server's typed entries collapse to plain keys — an embed entry's path
  // already carries the "embed/" segment. Host-tooling only; the editor core
  // never calls list().
  if (site) {
    store.list = async (prefix: string): Promise<ArchuraStoreEntry[]> => {
      const response = await fetch(`${origin}/api/sites/${encodeURIComponent(site)}/list`, { headers });
      if (!response.ok) throw new Error(`Store list failed (${response.status}) for ${site}`);
      const { entries } = (await response.json()) as {
        entries: Array<{ path: string[]; updatedAt: string | null }>;
      };
      return entries
        .map((entry) => ({ key: entry.path.join('/'), updatedAt: entry.updatedAt }))
        .filter((entry) => entry.key.startsWith(prefix));
    };
  }

  return store;
}

/**
 * Local-testing store backed by the dev server's artifact store
 * (see the `artifact-store` plugin in vite.config.ts). Uses the same
 * namespace layout as production R2 — `artifacts/sites/<site>/...` on disk
 * mirrors `sites/<site>/...` in the bucket — so listing and embeds behave
 * identically. No auth locally: a dev is implicitly admin of local namespaces.
 */
export function createFileSystemAdapter(options: { endpoint?: string; site?: string } = {}): ArchuraStore {
  const site = options.site ?? 'dev';
  return createHttpStore({
    artifactBase: options.endpoint ?? `/api/artifacts/sites/${site}`,
    origin: '',
    site,
    headers: {},
  });
}

/**
 * Store for a Cloudflare Worker fronting an R2 bucket
 * (reference Worker: workers/site-worker.js). Browser code must never
 * hold R2 credentials, so all bucket access goes through the Worker, which
 * owns the R2 binding and checks a bearer token (the site's claim token).
 * Pass `site` to enable the namespace operations (list + embed keys).
 */
export function createR2Adapter(options: { endpoint: string; token?: string; site?: string }): ArchuraStore {
  const headers: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};
  // The namespace routes live on the same server as the artifact endpoint.
  const origin = options.endpoint.replace(/\/api\/artifacts(\/.*)?$/, '');
  return createHttpStore({ artifactBase: options.endpoint, origin, site: options.site, headers });
}

// Re-export so hosts building keys share the one keyspace convention.
export { artifactKey, embedKey, isEmbedKey } from '../editor/store-keys.js';
