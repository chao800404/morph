/**
 * The preview host's credential cookies, read with fixed bounds
 * (handoff/2026-10-28/preview-access-design-addendum-p2-p4.md, A3, A4, A4.1).
 *
 * Each authorization flow sets its own grant cookie,
 * `__Host-morph-pv-<flowId>`, so a second tab's flow never overwrites the
 * first tab's credential. A request may therefore carry several. Every one
 * of them is a full credential for this host on its own, so the request is
 * served by any one that verifies; which one is the server's choice, never
 * the order the browser sent them in.
 *
 * The bounds are the request's, not the browser's: more than 16 KiB of
 * preview-prefixed cookies, more than 32 preview-prefixed names, or more than
 * 8 distinct well-formed values is refused as an overflow. Only the preview's
 * own cookies count: another site's or a Theme's cookies, however large, can
 * never push a request over, so no Theme can lock every preview out. Nothing is picked out of an
 * over-full set — any choice of "which 8" would let forged values push a
 * valid one out — and the overflow is answered explicitly, never served.
 */

/** A grant cookie's name: this prefix, then the flow id. */
export const PREVIEW_ACCESS_GRANT_COOKIE_PREFIX = "__Host-morph-pv-";
/** A binder cookie's name: this prefix, then the flow id. */
export const PREVIEW_ACCESS_BINDER_COOKIE_PREFIX = "__Host-morph-pvb-";

export const MAX_PREVIEW_ACCESS_COOKIE_HEADER_BYTES = 16 * 1024;
export const MAX_PREVIEW_ACCESS_CANDIDATES = 8;
export const MAX_PREVIEW_ACCESS_PREFIXED_NAMES = 32;

const FLOW_ID = /^[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{64}$/;

export type PreviewAccessCandidates =
  | Readonly<{
      kind: "candidates";
      /** Distinct well-formed grant tokens, in no meaningful order. */
      tokens: readonly string[];
      /** Prefixed names whose flow id or value has the wrong shape. */
      malformedNames: readonly string[];
    }>
  | Readonly<{
      kind: "overflow";
      reason: "header-too-large" | "too-many-names" | "too-many-values";
    }>;

/** Whether a cookie name is one of the preview host's own credentials. */
export function isPreviewAccessCookieName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    lower.startsWith(PREVIEW_ACCESS_GRANT_COOKIE_PREFIX.toLowerCase()) ||
    lower.startsWith(PREVIEW_ACCESS_BINDER_COOKIE_PREFIX.toLowerCase())
  );
}

/**
 * The grant tokens one request carries, deduplicated by value. Binder
 * cookies share the `__Host-morph-pv` stem but are not grants, and are never
 * candidates.
 */
export function readPreviewAccessCandidates(
  cookieHeader: string | null,
): PreviewAccessCandidates {
  if (!cookieHeader)
    return { kind: "candidates", tokens: [], malformedNames: [] };
  const tokens = new Set<string>();
  const malformedNames: string[] = [];
  let prefixed = 0;
  let prefixedBytes = 0;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (!name.startsWith(PREVIEW_ACCESS_GRANT_COOKIE_PREFIX)) continue;
    if (name.startsWith(PREVIEW_ACCESS_BINDER_COOKIE_PREFIX)) continue;
    prefixedBytes += new TextEncoder().encode(part).byteLength;
    if (prefixedBytes > MAX_PREVIEW_ACCESS_COOKIE_HEADER_BYTES) {
      return { kind: "overflow", reason: "header-too-large" };
    }
    prefixed += 1;
    if (prefixed > MAX_PREVIEW_ACCESS_PREFIXED_NAMES) {
      return { kind: "overflow", reason: "too-many-names" };
    }
    const flowId = name.slice(PREVIEW_ACCESS_GRANT_COOKIE_PREFIX.length);
    const value = part.slice(separator + 1).trim();
    if (!FLOW_ID.test(flowId) || !TOKEN.test(value)) {
      malformedNames.push(name);
      continue;
    }
    tokens.add(value);
  }
  if (tokens.size > MAX_PREVIEW_ACCESS_CANDIDATES) {
    return { kind: "overflow", reason: "too-many-values" };
  }
  return { kind: "candidates", tokens: [...tokens], malformedNames };
}
