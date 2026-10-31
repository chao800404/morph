/**
 * `@morph/sdk/astro`: the platform's thin entry for an Astro Theme that
 * Morph hosts.
 *
 * The core (`../src`) knows nothing about frameworks or requests. This entry
 * is the one place a hosted Astro Theme learns which content source the
 * request it is serving may read, the way `@morph/sdk/start` does for Start:
 *
 * - The platform names it on every request in `x-morph-content-origin`: Core
 *   on the public site, the preview Worker for the draft snapshot, the build's
 *   prerender wrapper for the sealed snapshot. A Theme never picks the source.
 * - Astro has no `getRequest()`, and a module a page imports does not see
 *   `Astro.request`. So the platform's middleware (`./middleware`, added by
 *   Morph's integration with `addMiddleware`, never by the author) runs each
 *   render inside `runWithMorphRequest`, and the reads take the request from
 *   that render's AsyncLocalStorage. Nothing about a request is kept at module
 *   scope, so two renders at once cannot see each other's source.
 * - A read outside a render the platform wired, or a request without the
 *   header, fails with `no_content_source`; it never falls back to default
 *   content. (Reading published content on the author's own machine is
 *   deferred; it must stay possible: docs/content-read-core-design.md §4.7.)
 * - Morph's media paths come back as Morph sent them, relative, as from
 *   `@morph/sdk/start` (README.md, "Media URL mode").
 *
 * Server only: frontmatter, endpoints and middleware.
 *
 * Theme code imports this as `@morph/sdk/astro`. The platform resolves that
 * name to its own copy written into the workspace (`.morph/sdk/`); the Theme
 * does not carry or own these files.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { createMorphReader } from "../src/client";
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

const renders = new AsyncLocalStorage<Request>();

/** Runs `next` as the render of `request`; see the platform's middleware. */
export function runWithMorphRequest<T>(request: Request, next: () => T): T {
  return renders.run(request, next);
}

/** The content origin a request may read: the platform's header only. */
export function contentOriginFor(request: Request): string {
  const forwarded = request.headers.get(MORPH_CONTENT_ORIGIN_HEADER);
  if (forwarded !== null) return forwarded;
  throw new MorphError("no_content_source", null);
}

/**
 * A reader for the render running now. Created per call and never kept: the
 * next call, from this render or another, asks again.
 */
export function morphForRequest(): Morph {
  const request = renders.getStore();
  if (!request) throw new MorphError("no_content_source", null);
  return createMorphReader(
    { baseUrl: contentOriginFor(request) },
    // The hosted entry's mode, as `@morph/sdk/start`'s: see the comment above.
    { mediaUrls: "relative" },
  );
}

/**
 * The reads a Theme calls, each resolving the render's source when called.
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
