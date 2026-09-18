/**
 * Where a locally-run Live Preview may live.
 *
 * One rule, three callers: the transport that binds the dev server, the sidecar
 * that binds its control port, and the Worker that decides whether the address
 * it was handed may be framed. They have to agree, and a second copy of "is
 * this address this machine" is how a preview ends up reachable from somewhere
 * it should not be.
 *
 * This module is deliberately pure — no Vite, no Node builtins — because the
 * Worker imports it. `local-vite-preview-server` needs Vite, which must never
 * reach a Worker bundle.
 */

/** Address a local preview binds, and the only interface it answers on. */
export const LOCAL_PREVIEW_HOST = "127.0.0.1";

/**
 * Hostnames that are the local machine by definition.
 *
 * `localhost` and the loopback literals are obvious. `*.localhost` is not a
 * convenience: RFC 6761 reserves the whole name for loopback, which is why it
 * is what a developer reaches a preview on without editing a hosts file.
 */
export function isLoopbackPreviewHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (normalized === "127.0.0.1") return true;
  return normalized.endsWith(".localhost");
}

export type LocalPreviewOrigin =
  | Readonly<{ ok: true; hostname: string; port: number }>
  | Readonly<{ ok: false; reason: string }>;

/**
 * Reads an address a local preview is configured on, or refuses it.
 *
 * Three requirements, and each of them is a fence rather than a formality:
 * plain http, because a loopback preview has no certificate to offer and a
 * `https:` value would only be a claim; a loopback name, because this process
 * executes Theme code; and an explicit port, because the Worker and the sidecar
 * have to arrive at the same address from one shared setting without either of
 * them guessing.
 */
export function readLocalPreviewOrigin(origin: string): LocalPreviewOrigin {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return {
      ok: false,
      reason: `INVALID_LOCAL_PREVIEW_ORIGIN: "${origin}" is not a URL.`,
    };
  }
  if (parsed.protocol !== "http:") {
    return {
      ok: false,
      reason: `INVALID_LOCAL_PREVIEW_ORIGIN: A local preview listens over http on loopback; "${origin}" is ${parsed.protocol}.`,
    };
  }
  if (!isLoopbackPreviewHostname(parsed.hostname)) {
    return {
      ok: false,
      reason: `LOCAL_PREVIEW_SIDECAR_NOT_LOOPBACK: A local preview executes Theme code, so it may only listen on this machine; "${parsed.hostname}" is not a loopback name.`,
    };
  }
  const port = Number(parsed.port || "0");
  if (!Number.isInteger(port) || port <= 0) {
    return {
      ok: false,
      reason: `INVALID_LOCAL_PREVIEW_ORIGIN: "${origin}" must name an explicit port, so the Worker and the sidecar cannot disagree about where it is.`,
    };
  }
  return { ok: true, hostname: parsed.hostname, port };
}
