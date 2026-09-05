/**
 * Public delivery for CMS media that a release actually published.
 *
 * Asset-backed media is stored with the CMS delivery URL (`/assets/…`), and
 * that route requires a signed-in admin or user. Inside the editor that is
 * invisible, because the editor is signed in. On a merchant hostname the same
 * URL is a relative path into the Theme Worker, where it is a 404 — and
 * rewriting it to the platform origin only turns the 404 into a 401. So an
 * image chosen from the Asset library renders for its author and for nobody
 * else.
 *
 * Opening `/assets` is not the answer: it would expose every asset in the
 * library, published or not. What a visitor may read is exactly what the
 * active release published, so authorisation is a question about the
 * publication rather than about the session.
 */

/** Path prefix the storefront serves published media from. */
export const PUBLISHED_MEDIA_PATH_PREFIX = "/_storefront-media/";

/**
 * Where a published asset is readable from on the storefront's own origin.
 *
 * Same-origin by construction: a relative path cannot be pointed at another
 * host by a stored value, and it keeps the bytes behind the storefront's cache
 * rather than the CMS's.
 */
export function publishedMediaPath(
  assetId: string,
  storageKey?: string,
): string {
  const path = `${PUBLISHED_MEDIA_PATH_PREFIX}${encodeURIComponent(assetId)}`;
  return storageKey
    ? `${path}?version=${encodeURIComponent(storageKey)}`
    : path;
}

/**
 * The asset a request is asking for, or `null` when the path is not ours.
 *
 * Rejects anything with a further path segment: the id is the whole remainder,
 * so a traversal cannot be smuggled through it.
 */
export function parsePublishedMediaPath(pathname: string): string | null {
  if (!pathname.startsWith(PUBLISHED_MEDIA_PATH_PREFIX)) return null;

  const raw = pathname.slice(PUBLISHED_MEDIA_PATH_PREFIX.length);
  if (raw === "" || raw.includes("/")) return null;

  let assetId: string;
  try {
    assetId = decodeURIComponent(raw);
  } catch {
    return null;
  }

  // The stored identity is a UUID. Constraining it here keeps a decoded value
  // from reaching a storage lookup as anything else.
  return /^[0-9a-fA-F-]{36}$/.test(assetId) ? assetId : null;
}

export type PublishedMediaPorts = Readonly<{
  /**
   * The storage key each asset had *when the release was published*.
   *
   * Keyed by asset id, but the value is the published snapshot rather than the
   * asset's current state. Resolving the live asset instead meant editing an
   * image in the library changed what a published storefront served, with no
   * publish and no way back: a rollback restores the document, and the document
   * pointed at whatever the asset had become.
   */
  listPublishedAssetKeys(
    publicationId: string,
  ): Promise<ReadonlyMap<string, ReadonlySet<string>>>;
}>;

export type PublishedMediaLookup =
  | { status: "not-published" }
  | { status: "missing" }
  | { status: "found"; storageKey: string; contentType: string | null };

/**
 * Resolves a request for published media to the bytes it may read.
 *
 * Membership of the publication is checked before the asset is looked up, so
 * an id that was never published cannot be used to probe which assets exist.
 */
export async function lookupPublishedMedia({
  assetId,
  storageKey: requestedKey,
  publicationId,
  ports,
}: {
  assetId: string;
  storageKey?: string | null;
  publicationId: string | null | undefined;
  ports: PublishedMediaPorts;
}): Promise<PublishedMediaLookup> {
  if (!publicationId) return { status: "not-published" };

  const published = await ports.listPublishedAssetKeys(publicationId);
  const versions = published.get(assetId);
  // Legacy URLs may resolve only when the publication names exactly one version.
  const storageKey = requestedKey
    ? versions?.has(requestedKey)
      ? requestedKey
      : undefined
    : versions?.size === 1
      ? versions.values().next().value
      : undefined;
  // Membership and bytes come from the same snapshot, so an id that was never
  // published cannot be used to probe what exists, and one that was always
  // resolves to the version that was published.
  if (!storageKey) return { status: "not-published" };

  return {
    status: "found",
    storageKey,
    contentType: null, // Immutable R2 object metadata, never the mutable asset row.
  };
}
