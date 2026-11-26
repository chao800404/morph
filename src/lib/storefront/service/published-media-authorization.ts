/**
 * Which published media a visitor may read: exactly the media the
 * storefront's content slots emit.
 *
 * The answer is derived from `buildStorefrontContent`, the function the
 * public content endpoint renders with, rather than from a second reading of
 * its rules. Whatever that function leaves out — a hidden section, a slot the
 * shared layout hides, a row a later row overwrote, an id that cannot be a
 * slot, a row past the slot cap — emits nothing, and so authorises nothing.
 */
import {
  buildStorefrontContent,
  type PublishedDocument,
} from "./storefront-content-runtime";
import {
  assetReferenceKey,
  parsePublishedMediaUrl,
} from "./storefront-media-delivery";

type MediaKeys = Map<string, Set<string>>;

function add(into: MediaKeys, assetId: string, storageKey: string): void {
  const versions = into.get(assetId) ?? new Set<string>();
  versions.add(storageKey);
  into.set(assetId, versions);
}

/**
 * Asset id to the storage keys a visitor may read.
 *
 * `documents` are every route document of one publication and
 * `layoutDocument` its shell. Each route renders the shell with its own
 * document; a path with no document of its own renders the shell alone.
 *
 * `known` is every asset reference the publication holds, hidden sections
 * included. A slot emits asset references as published media paths, which
 * name both the asset and the version. A path pasted into a visible field is
 * emitted as it is, and it authorises only a reference the publication
 * already holds: with a version, that version; without one, the versions the
 * publication holds for that asset (the media route still requires exactly
 * one). A pasted path can therefore never open a version, or another
 * storefront's asset, that the content does not itself reference.
 */
export function collectVisitorMediaKeys(data: {
  layoutDocument: PublishedDocument | null;
  documents: readonly PublishedDocument[];
  known: ReadonlyMap<string, ReadonlySet<string>>;
}): MediaKeys {
  const authorised: MediaKeys = new Map();
  const visit = (node: unknown, seen: Set<unknown>): void => {
    if (typeof node === "string") {
      const named = parsePublishedMediaUrl(node);
      const versions = named && data.known.get(named.assetId);
      if (!named || !versions) return;
      if (named.storageKey === null) {
        for (const key of versions) add(authorised, named.assetId, key);
      } else if (versions.has(named.storageKey)) {
        add(authorised, named.assetId, named.storageKey);
      }
      return;
    }
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    // A reference the slot resolver did not turn into a URL still reaches
    // the visitor as an object, as it did before slots were checked here.
    const reference = assetReferenceKey(node);
    if (reference) add(authorised, reference.assetId, reference.storageKey);
    for (const value of Array.isArray(node) ? node : Object.values(node))
      visit(value, seen);
  };

  const routes = [
    buildStorefrontContent(data.layoutDocument, null),
    ...data.documents.map((document) =>
      buildStorefrontContent(data.layoutDocument, document),
    ),
  ];
  for (const route of routes) visit(route.slots, new Set());
  return authorised;
}
