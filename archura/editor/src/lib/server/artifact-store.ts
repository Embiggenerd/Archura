import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertArtifact, type CanonicalArtifact } from '$lib/artifacts/artifact';

export function getArtifactsRoot() {
  const candidates = [
    path.resolve(process.cwd(), 'archura/component-data/canonical'),
    path.resolve(process.cwd(), '../component-data/canonical'),
    path.resolve(process.cwd(), 'component-data/canonical'),
  ];

  const existingCandidate = candidates.find((candidate) => existsSync(path.dirname(candidate)));
  return existingCandidate ?? candidates[0];
}

function sanitizePathSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export function getArtifactDirectory(artifactId: string) {
  return path.join(getArtifactsRoot(), sanitizePathSegment(artifactId));
}

export function getArtifactPath(artifactId: string) {
  return path.join(getArtifactDirectory(artifactId), 'artifact.json');
}

export async function writeArtifact(artifact: CanonicalArtifact) {
  assertArtifact(artifact);
  const artifactDir = getArtifactDirectory(artifact.id);
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = getArtifactPath(artifact.id);
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return { artifactDir, artifactPath };
}

export async function writeArtifacts(artifacts: CanonicalArtifact[]) {
  const results = [];
  for (const artifact of artifacts) {
    results.push(await writeArtifact(artifact));
  }
  return results;
}

export async function readArtifact(artifactId: string) {
  const artifactPath = getArtifactPath(artifactId);
  const source = await readFile(artifactPath, 'utf8');
  const artifact = JSON.parse(source) as unknown;
  assertArtifact(artifact);
  return artifact;
}
