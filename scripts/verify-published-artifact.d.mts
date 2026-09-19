/**
 * Types for the artifact verifier, which is plain JavaScript because it runs as
 * part of the end-to-end runner rather than through the app's build.
 *
 * Declared so its pure helper can be unit tested with real types instead of
 * `any`: `containedPath` decides which files the verifier is allowed to write,
 * and a guard tested through an untyped import is a guard whose signature
 * nothing checks.
 */
export declare function containedPath(root: string, relative: string): string;

export declare function verifyPublishedArtifact(options: {
  handoffPath: string;
  persistTo: string;
  outDir: string;
}): Promise<{
  marker: string;
  releaseId: string;
  buildId: string;
  artifactPrefix: string;
  sourceRevisionId: string;
  contentPublicationId: string;
  artifactDir: string;
  workerConfig: string;
  fileCount: number;
}>;
