import type { CanonicalComponentData } from '../component-data/canonical.js';
import type {
  ArchuraEditTarget,
  ArchuraNamespaceEntry,
  ArchuraPersistenceAdapter,
} from '../editor/types.js';

function createHttpJsonAdapter(endpoint: string, headers: Record<string, string>): ArchuraPersistenceAdapter {
  const urlFor = (path: string[]) => `${endpoint.replace(/\/+$/, '')}/${path.map(encodeURIComponent).join('/')}`;

  return {
    async load(target: ArchuraEditTarget): Promise<CanonicalComponentData | null> {
      const response = await fetch(urlFor(target.path), { headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Failed to load artifact (${response.status}) from ${urlFor(target.path)}`);
      return response.json();
    },

    async publish(artifact: CanonicalComponentData): Promise<void> {
      const response = await fetch(urlFor(artifact.config.componentPath), {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(artifact),
      });
      if (!response.ok) throw new Error(`Failed to publish artifact (${response.status}) to ${urlFor(artifact.config.componentPath)}`);
    },
  };
}

/**
 * Adds the namespace operations (list + embed publishing) to a base artifact
 * adapter. `origin` is the server hosting the /api/sites and /api/embeds
 * routes — the Worker in production, the Vite dev server locally — and both
 * expose the same contract, so callers cannot tell the backends apart.
 */
function withNamespace(
  adapter: ArchuraPersistenceAdapter,
  options: { site: string; origin: string; headers: Record<string, string> }
): ArchuraPersistenceAdapter {
  const { site, origin, headers } = options;
  return {
    ...adapter,

    async list(): Promise<ArchuraNamespaceEntry[]> {
      const response = await fetch(`${origin}/api/sites/${encodeURIComponent(site)}/list`, { headers });
      if (!response.ok) throw new Error(`Failed to list namespace (${response.status}) for ${site}`);
      return (await response.json()).entries;
    },

    async publishEmbed(name: string, source: string): Promise<void> {
      const response = await fetch(`${origin}/api/embeds/${encodeURIComponent(site)}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'text/javascript' },
        body: source,
      });
      if (!response.ok) throw new Error(`Failed to publish embed (${response.status}) for ${site}/${name}`);
    },
  };
}

/**
 * Local-testing adapter backed by the dev server's artifact store
 * (see the `artifact-store` plugin in vite.config.ts). Uses the same
 * namespace layout as production R2 — `artifacts/sites/<site>/...` on disk
 * mirrors `sites/<site>/...` in the bucket — so listing and embeds behave
 * identically. No auth locally: a dev is implicitly admin of local namespaces.
 */
export function createFileSystemAdapter(options: { endpoint?: string; site?: string } = {}): ArchuraPersistenceAdapter {
  const site = options.site ?? 'dev';
  const base = createHttpJsonAdapter(options.endpoint ?? `/api/artifacts/sites/${site}`, {});
  return withNamespace(base, { site, origin: '', headers: {} });
}

/**
 * Adapter for a Cloudflare Worker fronting an R2 bucket
 * (reference Worker: workers/site-worker.js). Browser code must never
 * hold R2 credentials, so all bucket access goes through the Worker, which
 * owns the R2 binding and checks a bearer token (the site's claim token).
 * Pass `site` to enable the namespace operations (list + embed publishing).
 */
export function createR2Adapter(options: { endpoint: string; token?: string; site?: string }): ArchuraPersistenceAdapter {
  const headers: Record<string, string> = options.token ? { Authorization: `Bearer ${options.token}` } : {};
  const base = createHttpJsonAdapter(options.endpoint, headers);
  if (!options.site) return base;
  // The namespace routes live on the same server as the artifact endpoint.
  const origin = options.endpoint.replace(/\/api\/artifacts(\/.*)?$/, '');
  return withNamespace(base, { site: options.site, origin, headers });
}
