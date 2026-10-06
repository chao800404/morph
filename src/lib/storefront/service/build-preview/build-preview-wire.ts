import type { BuildPreviewArtifact } from "./build-preview-artifact";
import type { BuildPreviewInstanceStart } from "./build-preview-server.types";

/**
 * How a Build Preview start and request cross from the Worker to the local
 * helper process: JSON, with bytes as base64. Pure, because both runtimes
 * import it; nothing here may need `Buffer` or `node:*`.
 */

export const BUILD_PREVIEW_EXECUTOR_HEADER = "x-morph-build-preview-executor";
/** The executor answered with the instance's own response. */
export const BUILD_PREVIEW_EXECUTOR_ANSWERED = "answered";
/** The executor has no running instance for that id. */
export const BUILD_PREVIEW_EXECUTOR_NOT_RUNNING = "not-running";

/**
 * Headers that describe one connection or one encoding of a body, not the
 * message: dropped at every hop that re-sends a request or a response,
 * because the next hop frames and encodes the body itself — and `fetch` has
 * already decoded the one it read.
 */
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "host",
  "content-length",
  "content-encoding",
]);

export function isHopHeader(name: string): boolean {
  return HOP_HEADERS.has(name.toLowerCase());
}

type WireFile = Readonly<{ path: string; base64: string }>;

export type BuildPreviewStartWire = Readonly<{
  instanceId: string;
  contentOrigin: string;
  contentUpstream?: string;
  artifact: Readonly<
    Omit<BuildPreviewArtifact, "modules" | "assets"> & {
      modules: readonly WireFile[];
      assets: readonly WireFile[];
    }
  >;
}>;

export type BuildPreviewFetchWire = Readonly<{
  instanceId: string;
  method: string;
  path: string;
  headers: readonly (readonly [string, string])[];
  body: string | null;
}>;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function encodeBuildPreviewStart(
  input: BuildPreviewInstanceStart,
): BuildPreviewStartWire {
  const toWire = (file: { path: string; bytes: Uint8Array }) => ({
    path: file.path,
    base64: bytesToBase64(file.bytes),
  });
  return {
    instanceId: input.instanceId,
    contentOrigin: input.contentOrigin,
    ...(input.contentUpstream
      ? { contentUpstream: input.contentUpstream }
      : {}),
    artifact: {
      ...input.artifact,
      modules: input.artifact.modules.map(toWire),
      assets: input.artifact.assets.map(toWire),
    },
  };
}

export function decodeBuildPreviewStart(
  wire: BuildPreviewStartWire,
): BuildPreviewInstanceStart {
  const fromWire = (file: WireFile) => ({
    path: file.path,
    bytes: base64ToBytes(file.base64),
  });
  return {
    instanceId: wire.instanceId,
    contentOrigin: wire.contentOrigin,
    ...(wire.contentUpstream ? { contentUpstream: wire.contentUpstream } : {}),
    artifact: {
      ...wire.artifact,
      modules: wire.artifact.modules.map(fromWire),
      assets: wire.artifact.assets.map(fromWire),
    },
  };
}
