/**
 * What "the same file" means to local sync.
 *
 * Two copies are the same when their text is, ignoring a byte-order mark and
 * whether lines end in CRLF or LF. Without that, an editor on Windows that
 * saves CRLF would make every file look changed against a workspace that
 * holds LF, and each side would keep writing it back to the other — the
 * endless loop Shopify's theme sync is known for.
 *
 * Text goes up normalized (LF, no BOM). Text written down keeps the line
 * endings the local file already had, so a developer's editor settings
 * survive a sync.
 */

const BOM = "\uFEFF";

export function normalizeSyncText(text: string): string {
  const withoutBom = text.startsWith(BOM) ? text.slice(1) : text;
  return withoutBom.replace(/\r\n/g, "\n");
}

export async function syncContentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizeSyncText(text)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type LineEnding = "lf" | "crlf";

/** The convention a local file uses: CRLF only if every break is CRLF. */
export function detectLineEnding(text: string): LineEnding {
  const breaks = text.match(/\r?\n/g);
  if (!breaks || breaks.length === 0) return "lf";
  return breaks.every((lineBreak) => lineBreak === "\r\n") ? "crlf" : "lf";
}

/** Remote text as it should be written over a local file of this style. */
export function textForLocal(remote: string, ending: LineEnding): string {
  const normalized = normalizeSyncText(remote);
  return ending === "crlf" ? normalized.replace(/\n/g, "\r\n") : normalized;
}

/**
 * Bytes as text, or null when they are not UTF-8. Local sync carries source
 * as text; a file that does not decode is left where it is and reported.
 */
export function decodeSyncText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
