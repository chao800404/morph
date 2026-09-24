import {
  applyPreviewMediaUrls,
  collectPreviewMediaAssetIds,
} from "@/lib/storefront/preview-media-references";

/**
 * Signed preview addresses the editor already holds, for live edits.
 *
 * An edit is posted to the preview as soon as it is made; waiting on the
 * server would make every keystroke in a section with an image lag. So an
 * edit is resolved against what is already held and posted at once, and an
 * asset not yet held is signed in the background and the edit posted again.
 *
 * An asset the server would not sign — deleted, or not an image or video — is
 * remembered for a short while too, so each further edit to that section does
 * not ask again.
 */

export type PreviewMediaSigner = (
  assetIds: string[],
) => Promise<{ urls: Record<string, string>; expiresAt: number } | null>;

/** Asked again this long before an address runs out. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
const UNSIGNABLE_RETRY_MS = 5 * 60 * 1000;
const MAX_SIGN_BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Entry = { url: string | null; usableUntil: number };

export type PreviewMediaCache = {
  /** The content with every held address applied, and what is not held. */
  resolve<T>(content: T): { content: T; missing: string[] };
  /** Signs whatever of `assetIds` is not held; never rejects. */
  ensure(assetIds: readonly string[]): Promise<void>;
};

export function createPreviewMediaCache(options: {
  sign: PreviewMediaSigner;
  now?: () => number;
}): PreviewMediaCache {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const inflight = new Map<string, Promise<void>>();

  const held = (id: string): Entry | null => {
    const entry = entries.get(id);
    return entry && entry.usableUntil > now() ? entry : null;
  };

  return {
    resolve(content) {
      const urls = new Map<string, string>();
      const missing: string[] = [];
      for (const id of collectPreviewMediaAssetIds(content)) {
        // Anything that is not a library id cannot be signed; leave it be.
        if (!UUID.test(id)) continue;
        const entry = held(id);
        if (!entry) missing.push(id);
        else if (entry.url) urls.set(id, entry.url);
      }
      return {
        content: urls.size > 0 ? applyPreviewMediaUrls(content, urls) : content,
        missing,
      };
    },

    async ensure(assetIds) {
      const needed = [
        ...new Set(assetIds.filter((id) => UUID.test(id))),
      ].filter((id) => !held(id) && !inflight.has(id));
      for (let index = 0; index < needed.length; index += MAX_SIGN_BATCH) {
        const batch = needed.slice(index, index + MAX_SIGN_BATCH);
        const request = options
          .sign(batch)
          .then((result) => {
            if (!result) return;
            const at = now();
            for (const id of batch) {
              const url = result.urls[id];
              entries.set(
                id,
                url
                  ? { url, usableUntil: result.expiresAt - REFRESH_MARGIN_MS }
                  : { url: null, usableUntil: at + UNSIGNABLE_RETRY_MS },
              );
            }
          })
          .catch(() => {})
          .finally(() => {
            for (const id of batch) inflight.delete(id);
          });
        for (const id of batch) inflight.set(id, request);
      }
      await Promise.all(
        assetIds.flatMap((id) => {
          const pending = inflight.get(id);
          return pending ? [pending] : [];
        }),
      );
    },
  };
}
