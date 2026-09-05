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
export function publishedMediaPath(assetId: string): string {
  return `${PUBLISHED_MEDIA_PATH_PREFIX}${encodeURIComponent(assetId)}`;
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
  /** Asset ids the given publication's content refers to. */
  listPublishedAssetIds(publicationId: string): Promise<ReadonlySet<string>>;
  /** Storage key and type for an asset, or `null` if it is gone. */
  getAssetDelivery(assetId: string): Promise<{
    storageKey: string;
    contentType: string | null;
  } | null>;
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
  publicationId,
  ports,
}: {
  assetId: string;
  publicationId: string | null | undefined;
  ports: PublishedMediaPorts;
}): Promise<PublishedMediaLookup> {
  if (!publicationId) return { status: "not-published" };

  const published = await ports.listPublishedAssetIds(publicationId);
  if (!published.has(assetId)) return { status: "not-published" };

  const asset = await ports.getAssetDelivery(assetId);
  if (!asset) return { status: "missing" };

  return {
    status: "found",
    storageKey: asset.storageKey,
    contentType: asset.contentType,
  };
}
