/**
 * Names the container that holds one person's Live Preview of one Theme.
 *
 * `getSandbox(binding, id)` returns the same container for the same id, so
 * this derivation *is* the lifecycle: a stable id means reopening the editor
 * reattaches to a warm server instead of paying a cold start, and an id that
 * varies by editor means two people never share a workspace. Nothing else has
 * to be recorded — the container is its own record, and an idle one is
 * reclaimed on its own.
 *
 * One per person per Theme, rather than one per Theme, because a shared
 * container is not collaboration: it is one filesystem two people write into,
 * where the first sign of another editor is your own screen changing under
 * you. Conflicts are already settled where they belong, by the version
 * precondition on every write, and a preview must not invent a second answer
 * to a question that is already answered.
 */

/**
 * Length of the derived id.
 *
 * The id becomes part of a public preview hostname label, so it has to be
 * short enough to leave room beside the port and token inside the 63-character
 * limit on a DNS label. 32 hex characters keep collisions out of reach while
 * staying well inside it.
 */
const PREVIEW_ID_LENGTH = 32;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type ThemePreviewSessionKey = Readonly<{
  storefrontId: string;
  themeId: string;
  /** The signed-in editor. Two editors never share a preview container. */
  userId: string;
}>;

/**
 * Derives the container id for one editor's preview of one Theme.
 *
 * Hashed rather than composed, because the id travels in the preview URL and
 * therefore into browser history, referrers and any logs along the way. A
 * readable id would publish who is editing what; a digest names the same
 * container without saying anything about it.
 *
 * The parts are length-prefixed before hashing so that no two different keys
 * can flatten into the same input — without it, a storefront id ending in a
 * separator and a theme id beginning with one would collide.
 */
export async function deriveThemePreviewSessionId({
  storefrontId,
  themeId,
  userId,
}: ThemePreviewSessionKey): Promise<string> {
  for (const [name, value] of Object.entries({
    storefrontId,
    themeId,
    userId,
  })) {
    if (!value?.trim()) {
      throw new Error(
        `INVALID_PREVIEW_SESSION_KEY: "${name}" is required to name a preview container.`,
      );
    }
  }

  const parts = [storefrontId, themeId, userId];
  const material = `morph-live-preview:v1:${parts
    .map((part) => `${part.length}:${part}`)
    .join("")}`;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(material),
  );
  return toHex(digest).slice(0, PREVIEW_ID_LENGTH);
}
