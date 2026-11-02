/**
 * `@morph/sdk/start`: the platform's thin entry for a TanStack Start Theme
 * that Morph hosts.
 *
 * The core (`../src`) knows nothing about frameworks or requests. This entry
 * is the one place a hosted Start Theme learns which content source the
 * request it is serving may read:
 *
 * - The platform names it on every request in `x-morph-content-origin`. Core
 *   sets that header with `set` on the public site (the published release of
 *   the host's storefront), and the full-Start preview Worker sets it to an
 *   origin only that Worker answers (the draft snapshot). A Theme never picks
 *   the source.
 * - It is read from Start's request-scoped `getRequest()` at each call, and a
 *   client is created for that call. Nothing about a request is kept at
 *   module scope, so two requests served at once cannot see each other's
 *   source.
 * - With no header, and only while developing (`import.meta.env.DEV`), the
 *   shell's `MORPH_CONTENT_ORIGIN` names the store, as the Starter's
 *   `content.ts` does. Otherwise a missing source fails with
 *   `no_content_source`; it never falls back to default content. A header
 *   that is present but unusable fails too, rather than falling through to
 *   the local address.
 * - Morph's media paths (`/_storefront-media/…`, `/api/store/assets/…`) come
 *   back exactly as Morph sent them, relative, as the Starter's `content.ts`
 *   keeps them. A hosted Theme's pages are served on the origin those paths
 *   belong to; the content origin above is a platform address (the preview's
 *   `.invalid` origin, a build's loopback prerender server) and must never
 *   be written into a page. This mode is part of this entry's contract
 *   (README.md, "Media URL mode"). `createMorph`, re-exported below, is the
 *   external entry and keeps its own absolute mode.
 *
 * Server only. The reads go through `createServerOnlyFn`, so Start removes
 * the request access from the client bundle; call them from a loader's server
 * function, a server route or `createServerFn`.
 *
 * Theme code imports this as `@morph/sdk/start`. The platform resolves that
 * name to its own copy written into the build workspace (`.morph/sdk/`); the
 * Theme does not carry or own these files.
 */
import { createServerOnlyFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import {
  createMorphReader,
  MORPH_RENDER_CONTEXT_HEADER,
} from "../src/client";
import { MorphError } from "../src/index";
import type {
  Morph,
  MorphPage,
  MorphProductList,
  MorphProductListParams,
  MorphProductResult,
} from "../src/index";

export * from "../src/index";

/** The header the platform names a request's content source in. */
export const MORPH_CONTENT_ORIGIN_HEADER = "x-morph-content-origin";

/**
 * The store address from the local environment. Only while developing: a
 * build that reaches here without the platform's header must fail, not read
 * whichever store the shell names.
 */
function localContentOrigin(): string | null {
  const env = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env;
  const value = env?.MORPH_CONTENT_ORIGIN?.trim();
  return value ? value : null;
}

/** Whether this is a development server. A build replaces it with `false`. */
function developing(): boolean {
  // Written as `import.meta.env` so a build can replace it with a constant.
  return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
}

/**
 * The content origin a request may read. The platform's header wins; the
 * local fallback is consulted only when the header is absent, and only while
 * developing.
 */
export function contentOriginFor(
  request: Request,
  development: boolean = developing(),
): string {
  const forwarded = request.headers.get(MORPH_CONTENT_ORIGIN_HEADER);
  if (forwarded !== null) return forwarded;
  const local = development ? localContentOrigin() : null;
  if (local !== null) return local;
  throw new MorphError("no_content_source", null);
}

/**
 * A reader for the request being served now. Created per call and never
 * kept: the next call, from this request or another, reads the header again.
 */
export const morphForRequest = createServerOnlyFn((): Morph => {
  const request = getRequest();
  return createMorphReader(
    { baseUrl: contentOriginFor(request) },
    // The hosted entry's mode, fixed here: see the comment at the top.
    // The render context keeps this request's page reads on its release.
    {
      mediaUrls: "relative",
      renderContext: request.headers.get(MORPH_RENDER_CONTEXT_HEADER),
    },
  );
});

/**
 * The reads a Theme calls, each resolving the request's source when called.
 * Holds no state: every method asks `morphForRequest()` again.
 */
export const morph: Morph = {
  pages: {
    async get(path: string): Promise<MorphPage> {
      return morphForRequest().pages.get(path);
    },
    isHidden(page: MorphPage, slotId: string): boolean {
      return page._hidden.includes(slotId);
    },
  },
  products: {
    async list(params?: MorphProductListParams): Promise<MorphProductList> {
      return morphForRequest().products.list(params);
    },
    async get(handle: string): Promise<MorphProductResult | null> {
      return morphForRequest().products.get(handle);
    },
  },
};
