import { randomBytes, timingSafeEqual } from "node:crypto";
import type {
  StartPreviewServerInput,
  StartPreviewServerResult,
} from "@/lib/storefront/compiler/theme-preview-server.types";

/**
 * The wire between the Worker and the local preview sidecar.
 *
 * The sidecar is a Node process that lays a Theme workspace out on disk and
 * runs a real Vite dev server over it, because a Worker cannot: `node:fs` there
 * is an in-memory file system scoped to one request, so there is nowhere for a
 * workspace to live and nothing for a dev server to watch.
 *
 * Every path below is one member of `ThemePreviewServer`, named after it, plus
 * the one capability the contract does not carry. That last part is worth
 * stating rather than hiding: the sandbox path writes edited files by reaching
 * into the container from the server function that already holds the binding,
 * so file application never had to be part of the transport. A sidecar's
 * filesystem is in another process, so here it does. Binary files are the
 * same capability in a second form: their bytes cannot travel inside a JSON
 * start, so they are staged ahead of it (`stageBinary`). If this protocol ever
 * needs an endpoint for anything else, the contract is what is missing — not
 * this file.
 *
 * This module is deliberately pure: both the Worker and the Node sidecar import
 * it, so it may not reach for anything either runtime lacks.
 */

export const LOCAL_PREVIEW_SIDECAR_PATHS = {
  /** `ThemePreviewServer.start` */
  start: "/start",
  /** `ThemePreviewServer.isServing` */
  isServing: "/isServing",
  /** `ThemePreviewServer.stop` */
  stop: "/stop",
  /** The one thing a container let its caller do without a transport. */
  applyFiles: "/applyFiles",
  /**
   * One binary file's bytes, raw, ahead of the start that names them. Kept
   * outside the workspace, by digest; the start then lays them out.
   */
  stageBinary: "/stageBinary",
} as const;

/** Which preview a staged file is for. */
export const LOCAL_PREVIEW_SIDECAR_PREVIEW_ID_HEADER = "x-morph-preview-id";
/** The SHA-256 the staged bytes must hash to. */
export const LOCAL_PREVIEW_SIDECAR_DIGEST_HEADER = "x-morph-binary-digest";
/** The byte length the staged bytes must have. */
export const LOCAL_PREVIEW_SIDECAR_SIZE_HEADER = "x-morph-binary-size";

/**
 * The largest file `stageBinary` takes: the per-file quota of `public/`. One
 * file per request, so neither side ever holds more than one file's bytes for
 * a transfer, whatever the directory holds in all.
 */
export const LOCAL_PREVIEW_SIDECAR_MAX_BINARY_BYTES = 5 * 1024 * 1024;

export const LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER = "x-morph-local-preview-token";

/**
 * The largest body the sidecar will read.
 *
 * A whole Theme travels in a `start`, and the editor's own file-application
 * limit is 200 files of up to 2 MB, so this is sized for a Theme with room to
 * spare rather than for the smallest case. It exists so that a request cannot
 * make the sidecar buffer without bound.
 */
export const LOCAL_PREVIEW_SIDECAR_MAX_BODY_BYTES = 64 * 1024 * 1024;

export type LocalPreviewSidecarApplyFilesRequest = Readonly<{
  previewId: string;
  /** Each with the version it is, or was edited from; see `preview-write-fence`. */
  files: readonly { path: string; content: string; fence: number }[];
}>;

export type LocalPreviewSidecarApplyFilesResult = Readonly<{
  changed: readonly string[];
  unchanged: readonly string[];
  /** Files the preview had already taken a newer version of; none written. */
  refused?: readonly string[];
}>;

/**
 * Every operation, its request and its response, in one place.
 *
 * Both sides index this by the same key and read the same path out of
 * `LOCAL_PREVIEW_SIDECAR_PATHS`, so a body and the endpoint it belongs to
 * cannot drift apart. The keys *are* the contract's member names, plus the one
 * capability argued for above.
 */
export type LocalPreviewSidecarOperations = Readonly<{
  start: Readonly<{
    request: StartPreviewServerInput;
    response: StartPreviewServerResult;
  }>;
  isServing: Readonly<{
    request: {
      previewId: string;
      previewHostname: string;
      expectedOrigin?: string | null;
    };
    response: { serving: boolean };
  }>;
  stop: Readonly<{
    request: { previewId: string; processId?: string };
    response: Record<string, never>;
  }>;
  applyFiles: Readonly<{
    request: LocalPreviewSidecarApplyFilesRequest;
    response: LocalPreviewSidecarApplyFilesResult;
  }>;
  /** Raw bytes in the body; which file they are is in the headers above. */
  stageBinary: Readonly<{
    request: Uint8Array;
    response: { staged: true };
  }>;
}>;

export type LocalPreviewSidecarOperation = keyof LocalPreviewSidecarOperations;

/** The endpoint an operation is sent to, so neither side spells it twice. */
export function localPreviewSidecarPath(
  operation: LocalPreviewSidecarOperation,
): string {
  return LOCAL_PREVIEW_SIDECAR_PATHS[operation];
}

/**
 * Whether a presented token is the one this process was started with.
 *
 * Constant-time, and length-checked first because `timingSafeEqual` throws on
 * unequal lengths. A short or absent token is never accepted: the caller
 * generates one, and a sidecar that would run without one is refused at
 * startup rather than guarded per request.
 */
export function localPreviewTokenMatches(
  expected: string,
  presented: string | null | undefined,
): boolean {
  if (!presented) return false;
  const expectedBytes = Buffer.from(expected, "utf8");
  const presentedBytes = Buffer.from(presented, "utf8");
  if (expectedBytes.length !== presentedBytes.length) return false;
  return timingSafeEqual(expectedBytes, presentedBytes);
}

/**
 * The token a sidecar should run with, or the reason it has none.
 *
 * Refusing a short token is not ceremony: this token is the only thing between
 * a loopback HTTP endpoint that executes Theme code and anything else that can
 * reach the loopback interface.
 */
export function readLocalPreviewSidecarToken(
  value: string | undefined | null,
): { ok: true; token: string } | { ok: false; reason: string } {
  const token = value?.trim();
  if (!token) {
    return {
      ok: false,
      reason:
        "MISSING_LOCAL_PREVIEW_TOKEN: The local preview sidecar needs MORPH_LOCAL_THEME_PREVIEW_TOKEN set to the same value the Worker reads.",
    };
  }
  if (token.length < 32) {
    return {
      ok: false,
      reason: `WEAK_LOCAL_PREVIEW_TOKEN: The local preview token must be at least 32 characters; this one is ${token.length}.`,
    };
  }
  return { ok: true, token };
}

/**
 * A new token, for a developer who did not set one.
 *
 * It is only ever printed to the terminal the sidecar was started from. The
 * worker has to be told the same value, which is the point: nothing that can
 * reach the port can use it without having been handed the secret out of band.
 */
export function generateLocalPreviewSidecarToken(): string {
  return randomBytes(32).toString("hex");
}
