import type { CanonicalComponentData } from '../component-data/canonical.js';
import type { ArchuraEditTarget, ArchuraPersistenceAdapter } from '../editor/types.js';

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
 * Local-testing adapter backed by the dev server's artifact store
 * (see the `artifact-store` plugin in vite.config.ts), which persists
 * artifacts as JSON files under `artifacts/<componentPath>.json`.
 */
export function createFileSystemAdapter(options: { endpoint?: string } = {}): ArchuraPersistenceAdapter {
  return createHttpJsonAdapter(options.endpoint ?? '/api/artifacts', {});
}

/**
 * Adapter for a Cloudflare Worker fronting an R2 bucket
 * (reference Worker: workers/r2-artifact-worker.js). Browser code must never
 * hold R2 credentials, so all bucket access goes through the Worker, which
 * owns the R2 binding and checks a bearer token.
 */
export function createR2Adapter(options: { endpoint: string; token?: string }): ArchuraPersistenceAdapter {
  return createHttpJsonAdapter(
    options.endpoint,
    options.token ? { Authorization: `Bearer ${options.token}` } : {}
  );
}
