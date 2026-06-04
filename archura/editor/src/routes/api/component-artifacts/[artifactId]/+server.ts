import { json } from '@sveltejs/kit';
import { assertArtifact, type CanonicalArtifact } from '$lib/artifacts/artifact';
import { readArtifact, writeArtifacts } from '$lib/server/artifact-store';
import { writeDerivedComponentArtifacts } from '$lib/server/component-artifacts';

export async function GET({ params }) {
  const artifact = await readArtifact(params.artifactId);
  return json(artifact);
}

export async function PUT({ params, request }) {
  const body = (await request.json()) as { artifacts?: CanonicalArtifact[] };
  const artifacts = body.artifacts ?? [];

  for (const artifact of artifacts) {
    artifact.meta.exportId = params.artifactId;
    assertArtifact(artifact);
  }

  await writeArtifacts(artifacts);
  const result = await writeDerivedComponentArtifacts(artifacts);
  return json({
    ...result,
    artifactIds: artifacts.map((artifact) => artifact.id),
  });
}
