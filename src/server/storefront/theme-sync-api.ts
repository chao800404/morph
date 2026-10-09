import { isBinaryThemeFile } from "@/lib/storefront/dto/storefront-theme-file.dto";
import type { StorefrontThemeSyncCapabilityDAL } from "@/lib/storefront/dal/storefront-theme-sync-capability.dal";
import { themeSyncPathExclusion } from "@/lib/storefront/local-dev/theme-sync/sync-paths";
import {
  THEME_SYNC_API_PATH,
  THEME_SYNC_LIMITS,
  THEME_SYNC_PROTOCOL_VERSION,
  themeSyncReadRequestSchema,
  themeSyncSaveRequestSchema,
  type ThemeSyncApiError,
  type ThemeSyncList,
  type ThemeSyncReadResponse,
  type ThemeSyncSaveResponse,
  type ThemeSyncWhoami,
} from "@/lib/storefront/local-dev/theme-sync/sync-protocol";
import {
  hashThemeSyncToken,
  themeSyncTokenFromAuthorization,
  verifyThemeSyncCapability,
  type VerifiedThemeSyncCapability,
} from "@/lib/storefront/service/theme-sync/theme-sync-capability";
import type { ThemeSourceStore } from "@/lib/storefront/storage/theme-storage.types";

/**
 * Core's sync API: what `morph-sync` reads and writes a Theme's source with.
 *
 * Plain HTTP with a bearer capability rather than server functions, because
 * the caller is a process on the developer's machine with no session and no
 * browser, and the server-function wire is not a public contract.
 *
 * Nothing here is a second way to write a Theme. Every write goes through
 * `themeSourceStore.saveFilesBatch`, the store every editor save uses, with
 * the client's source generation and file versions as preconditions; that
 * store decides revisions, the source manifest and the index. What this
 * adds is the gate in front: the capability is verified on every request,
 * and only paths local sync carries (`sync-paths.ts`) may be written, checked
 * here rather than trusted from the client.
 */

export type ThemeSyncApiDeps = Readonly<{
  dal: StorefrontThemeSyncCapabilityDAL;
  getSourceGeneration: ThemeSourceStore["getSourceGeneration"];
  getWorkspaceSnapshot: ThemeSourceStore["getWorkspaceSnapshot"];
  saveFilesBatch: ThemeSourceStore["saveFilesBatch"];
  now?: () => Date;
}>;

const THEME_SYNC_API_PREFIX = THEME_SYNC_API_PATH;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });

const refuse = (
  status: number,
  error: ThemeSyncApiError,
  message: string,
  extra: Record<string, unknown> = {},
) => json({ success: false, error, message, ...extra }, status);

class BodyTooLargeError extends Error {}

/** The body as text, refusing as soon as it passes `limit` bytes. */
async function readBoundedText(request: Request, limit: number) {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > limit) {
    throw new BodyTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJson(request: Request, limit: number): Promise<unknown> {
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    throw new SyntaxError("not json");
  }
  return JSON.parse(await readBoundedText(request, limit));
}

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

/** Every listed path the sync rules refuse, with the reason. */
function refusedPaths(paths: readonly string[]) {
  return paths
    .map((path) => ({ path, reason: themeSyncPathExclusion(path) }))
    .filter((entry) => entry.reason !== null);
}

function conflictKind(error: unknown): ThemeSyncApiError | null {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("CONFLICT_SOURCE_GENERATION_MISMATCH")) {
    return "SOURCE_GENERATION_CONFLICT";
  }
  if (message.includes("CONFLICT_VERSION_MISMATCH")) {
    return "FILE_VERSION_CONFLICT";
  }
  return null;
}

async function list(
  capability: VerifiedThemeSyncCapability,
  deps: ThemeSyncApiDeps,
): Promise<ThemeSyncList> {
  const { storefrontId, themeId } = capability;
  // Generation first, then the files: see `themeSyncListSchema`.
  const sourceGeneration =
    (await deps.getSourceGeneration(storefrontId, themeId)) ?? 1;
  const entries = await deps.getWorkspaceSnapshot(storefrontId, themeId);
  return {
    sourceGeneration,
    files: entries
      .filter((entry) => themeSyncPathExclusion(entry.path) === null)
      .map((entry) => ({
        path: entry.path,
        id: entry.id,
        version: entry.version,
        kind: isBinaryThemeFile(entry) ? ("binary" as const) : ("text" as const),
      })),
  };
}

async function read(
  request: Request,
  capability: VerifiedThemeSyncCapability,
  deps: ThemeSyncApiDeps,
): Promise<Response> {
  const parsed = themeSyncReadRequestSchema.safeParse(
    await readJson(request, 64 * 1024),
  );
  if (!parsed.success) {
    return refuse(400, "INVALID_INPUT", "Name between 1 and 200 paths.");
  }
  const wanted = new Set(parsed.data.paths);
  const entries = await deps.getWorkspaceSnapshot(
    capability.storefrontId,
    capability.themeId,
  );
  const body: ThemeSyncReadResponse = { files: [], missing: [] };
  for (const entry of entries) {
    if (!wanted.has(entry.path)) continue;
    if (isBinaryThemeFile(entry) || themeSyncPathExclusion(entry.path)) {
      continue;
    }
    body.files.push({
      path: entry.path,
      id: entry.id,
      version: entry.version,
      content: entry.content,
    });
    wanted.delete(entry.path);
  }
  body.missing = [...wanted];
  return json(body);
}

async function save(
  request: Request,
  capability: VerifiedThemeSyncCapability,
  deps: ThemeSyncApiDeps,
): Promise<Response> {
  const parsed = themeSyncSaveRequestSchema.safeParse(
    await readJson(request, THEME_SYNC_LIMITS.maxSaveBodyBytes),
  );
  if (!parsed.success) {
    return refuse(400, "INVALID_INPUT", "The save request is malformed.", {
      issues: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const data = parsed.data;
  if (data.files.length === 0 && data.deletions.length === 0) {
    return refuse(400, "INVALID_INPUT", "Nothing to save.");
  }
  const paths = [
    ...data.files.map((file) => file.path),
    ...data.deletions.map((deletion) => deletion.path),
  ];
  if (new Set(paths).size !== paths.length) {
    return refuse(400, "INVALID_INPUT", "A path is named more than once.");
  }
  const refused = refusedPaths(paths);
  if (refused.length > 0) {
    return refuse(
      422,
      "PATH_REFUSED",
      "Local sync does not write these paths.",
      { refused },
    );
  }
  const tooLarge = data.files
    .filter((file) => byteLength(file.content) > THEME_SYNC_LIMITS.maxFileBytes)
    .map((file) => file.path);
  if (tooLarge.length > 0) {
    return refuse(413, "PAYLOAD_TOO_LARGE", "A file is over the size limit.", {
      paths: tooLarge,
    });
  }
  try {
    const saved = await deps.saveFilesBatch(
      capability.storefrontId,
      capability.themeId,
      data.files.map((file) => ({
        path: file.path,
        content: file.content,
        ...(file.expectMissing
          ? { expectMissing: true }
          : {
              expectedFileId: file.expectedFileId,
              expectedVersion: file.expectedVersion,
            }),
      })),
      {
        expectedSourceGeneration: data.expectedSourceGeneration,
        deletions: data.deletions,
        // Whether this save is recorded is the store's to decide, as for
        // every editor save; deletions always are.
        revisionMessage: "Local sync",
        createdBy: capability.userId,
      },
    );
    const body: ThemeSyncSaveResponse = {
      sourceGeneration: saved.sourceGeneration ?? data.expectedSourceGeneration,
      files: saved.map((file) => ({
        path: file.path,
        id: file.id,
        version: file.version,
      })),
    };
    return json(body);
  } catch (error) {
    const conflict = conflictKind(error);
    if (conflict) {
      return refuse(
        409,
        conflict,
        "The workspace changed since it was read; nothing was written.",
      );
    }
    console.warn(
      JSON.stringify({
        scope: "storefront.theme-sync.save-failed",
        capabilityId: capability.id,
        themeId: capability.themeId,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
    return refuse(422, "SAVE_FAILED", "The workspace refused the save.");
  }
}

/**
 * Answers one request under `/api/storefront/theme-sync/`. The capability is
 * verified before anything is read, for every route, logout included.
 */
export async function handleThemeSyncRequest(
  request: Request,
  deps: ThemeSyncApiDeps,
): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const token = themeSyncTokenFromAuthorization(
    request.headers.get("authorization"),
  );
  if (!token) {
    return refuse(401, "UNAUTHORIZED", "A local sync token is required.");
  }
  const verified = await verifyThemeSyncCapability({
    dal: deps.dal,
    token,
    now,
  });
  if (!verified.ok) {
    return refuse(401, "UNAUTHORIZED", "The local sync token is not valid.", {
      reason: verified.reason,
    });
  }
  const capability = verified.capability;
  const route = new URL(request.url).pathname.slice(
    THEME_SYNC_API_PREFIX.length,
  );
  const key = `${request.method} ${route}`;
  try {
    switch (key) {
      case "GET whoami": {
        const body: ThemeSyncWhoami = {
          protocol: THEME_SYNC_PROTOCOL_VERSION,
          storefrontId: capability.storefrontId,
          themeId: capability.themeId,
          expiresAt: capability.expiresAt,
        };
        return json(body);
      }
      case "GET generation":
        return json({
          sourceGeneration:
            (await deps.getSourceGeneration(
              capability.storefrontId,
              capability.themeId,
            )) ?? 1,
        });
      case "GET files":
        return json(await list(capability, deps));
      case "POST files/read":
        return await read(request, capability, deps);
      case "POST files/save":
        return await save(request, capability, deps);
      case "POST logout":
        await deps.dal.revoke({
          tokenHash: await hashThemeSyncToken(token),
          now: now.toISOString(),
        });
        return json({ revoked: true });
      default:
        return refuse(404, "NOT_FOUND", "No such sync route.");
    }
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return refuse(413, "PAYLOAD_TOO_LARGE", "The request is too large.");
    }
    if (error instanceof SyntaxError) {
      return refuse(400, "INVALID_INPUT", "Send a JSON body.");
    }
    throw error;
  }
}
