# Morph SDK v0 (read core)

One framework-agnostic core for reading published Morph content and public products. It imports nothing outside this folder: no React, TanStack Start, Astro or Morph server code. It talks to Morph over HTTP only.

The contract is `docs/morph-sdk-read-contract.md` (#245). It is **not published to npm**. The app's own code does not import it; the platform copies it into every TanStack Start Theme workspace (see "How a Theme gets the SDK"). `start/` is the platform's thin entry for a hosted Start Theme (`@morph/sdk/start`, spike M1b/M1c). The Starter migration comes later.

```ts
import { createMorph, MorphError } from "@morph/sdk";

const morph = createMorph({ baseUrl: "https://shop.example.com" });

const home = await morph.pages.get("/"); // server side only
const list = await morph.products.list({ q: "linen", page: 1, limit: 12 });
const one = await morph.products.get("linen-shirt"); // null if not found
```

## What v0 does (wraps Morph's current API)

- **`createMorph({ baseUrl, fetch? })`**
  - Keeps only the origin and the fetch.
  - Nothing about a request (store, preview, credential) is kept between calls.
  - `baseUrl` must be an `http(s)` origin, optionally with one trailing `/` (dropped). Any other path, a query or credentials are refused.
- **Every read**
  - Does not follow redirects (`redirect: "manual"`). A 3xx or an opaque redirect throws `redirect_refused`, and its body is not read.
  - Reads at most 2 MB (the local development proxy's cap). A larger declared `content-length` is refused before reading; otherwise the body is counted as it streams and reading stops once the cap is passed.
- **`pages.get(path)`**
  - Reads `GET <baseUrl>/_morph/content?path=`, which serves the active release's published content only.
  - Returns the Starter's `MorphPage` shape: slots spread onto one object, hidden slot ids in `_hidden`.
  - Refused in a browser (`window` and `document` both present), because the endpoint sends no CORS headers. This throws `invalid_content_origin` before anything is sent; v0 keeps the code set the same as the Starter's and #245's rather than adding one.
- **`products.list({ q, page, limit, order })`**
  - Accepts only the parameters the Store API has, and checks them the way the API does before sending.
  - Returns `{ products, pagination, context }`.
- **`products.get(handle)`**
  - Returns `{ product, context }`.
  - Returns `null` only for the Store API's own JSON `404 { error: "NOT_FOUND" }`.
- **No key is sent.** On the merchant host both reads are scoped by host.
- **Morph paths are made absolute** against `baseUrl`. Only paths with these prefixes are rewritten:
  - `/_storefront-media/…` (page media);
  - `/api/store/assets/…` (product images).

## Errors

Every failure throws a `MorphError` with a `code`, a `resource` (`"page"`, `"product"`, or `null` for configuration), and the HTTP `status` when there was one.

- **Fixed messages.** Messages are written in the SDK. They never carry the response body, the address, the query or the underlying error.
- **No silent fallback.** No failure falls back to `{}`, an empty page or an empty list.

| Code                     | When                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `invalid_content_origin` | Bad `baseUrl`; or `pages.get` called in a browser                                                     |
| `invalid_path`           | Page path not starting with `/`, or longer than 500 characters                                        |
| `invalid_request`        | Unsupported list parameter or bad handle (checked before sending); or the API's `400 INVALID_REQUEST` |
| `invalid_store_context`  | The API's `401 INVALID_STORE_CONTEXT`                                                                 |
| `content_not_found`      | A plain 404 from the host lookup: the address has no published store. Any 404 on a page read.         |
| `store_unreachable`      | Network failure, timeout (15 s), or a body that breaks off                                            |
| `redirect_refused`       | A 3xx, or an opaque redirect (status 0); the body is not read                                         |
| `response_too_large`     | A body, or a declared `content-length`, over 2 MB                                                     |
| `store_error`            | Any other non-2xx                                                                                     |
| `invalid_response`       | Not JSON, or not the expected shape                                                                   |
| `reserved_slot`          | A slot named `_hidden`                                                                                |

`no_content_source` is in the type for parity with the Starter. The core never produces it, because there is always a `baseUrl`. `@morph/sdk/start` produces it when the request carries no `x-morph-content-origin` header and no development fallback applies.

## How a Theme gets the SDK

A Theme does not install the SDK or own its files. The platform puts a copy in each build workspace, so the code a Theme runs is the code these tests ran.

1. **Sources.** `packages/morph-sdk/src/*.ts` and `packages/morph-sdk/start/*.ts`. Test files are left out.
2. **Generator.** `scripts/generate-morph-sdk-sources.mjs` is the only way the generated module is produced. Run `pnpm generate:morph-sdk` after any SDK change and commit the result.
   - It refuses an import that would not resolve in a workspace. Only the copy itself and `@tanstack/react-start` (and `/server`) are allowed.
   - `--check` (`pnpm check:morph-sdk-sources`) writes nothing. It exits 1 when the committed module is stale.
   - It is not a pre-step of `typecheck`, `test` or `build`, because a pre-step would repair a stale copy before anyone saw it. `src/lib/storefront/compiler/morph-sdk-sources-freshness.test.ts` runs `--check` in `pnpm test`, so a stale copy fails CI.
3. **Generated module.** `src/lib/storefront/compiler/morph-sdk-sources.generated.ts` (do not edit) exports:
   - `GENERATED_MORPH_SDK_SOURCES`: the files, at `.morph/sdk/src/*` and `.morph/sdk/start/*`;
   - `MORPH_SDK_SOURCE_HASH`: SHA-256 of the UTF-8 JSON `[[path, content], …]`, in path order.
4. **Workspace.** `theme-morph-sdk.ts` hands the files to every TanStack Start workspace under `.morph/sdk/`:
   - the platform preview and build (`theme-sandbox-workspace.ts`, Themes with a route registry);
   - the native Start build (`tanstack-start-native-build.ts`).
   A Theme file at the same path is replaced, never used.
5. **Aliases.** The generated Vite config (`theme-sandbox-workspace.ts`) and the native wrapper (`tanstack-start-native-wrapper.ts`) map the exact names `@morph/sdk` → `.morph/sdk/src/index.ts` and `@morph/sdk/start` → `.morph/sdk/start/index.ts`. They come before the Theme's own aliases. Any other `@morph/…` name is an unapproved package.

### Build identity

Every TanStack Start build records the SDK it was built with, in the build record's existing `compiler_version`. The value is `<toolchain>+morph-sdk.<first 16 hex of MORPH_SDK_SOURCE_HASH>`, for example `4.1.17+morph-sdk.6f5a78dc83d628d8`. A native build uses the pinned `@tanstack/react-start` version in place of `4.1.17`.

- The compiler version feeds `inputHash`, the reuse match (`findSucceededBuildByIdentity`), the runners' identity check and the artifact store's check. So an SDK change gives the same revision a new identity, and an old artifact is never reused for it.
- The value is frozen on the record when the build starts. A recorded build keeps naming its own SDK, and its hash still verifies after the SDK changes.
- A preview's workspace fingerprint covers every planned file, the copy included. So after an SDK change, the old workspace is not reused as current.

To compare a build with a checkout, take `MORPH_SDK_SOURCE_HASH` from the generated module. Its first 16 hex digits must match the suffix of the build's `compilerVersion`.

## Compatibility contract

This section covers `@morph/sdk` and `@morph/sdk/start`. `start/api-surface.test.ts` enforces it:

- runtime names and error codes, in `pnpm test`;
- type names and signatures, in `pnpm typecheck`.

### Public surface

`@morph/sdk`:

- Values:
  - `createMorph(options: MorphOptions): Morph`;
  - `class MorphError extends Error { code: MorphErrorCode; resource: "page" | "product" | null; status: number | null }`;
  - `isMorphError(value: unknown): value is MorphError`.
- Types: `Morph`, `MorphFetch`, `MorphOptions` (`{ baseUrl: string; fetch?: MorphFetch }`), `MorphPage`, `MorphPagination`, `MorphProduct`, `MorphProductAsset`, `MorphProductList`, `MorphProductListItem`, `MorphProductListParams`, `MorphProductResult`, `MorphStoreContext`, `MorphErrorCode`, `MorphErrorResource`.
- `Morph` methods:
  - `pages.get(path: string): Promise<MorphPage>`;
  - `pages.isHidden(page: MorphPage, slotId: string): boolean`;
  - `products.list(params?: MorphProductListParams): Promise<MorphProductList>`;
  - `products.get(handle: string): Promise<MorphProductResult | null>`.

`@morph/sdk/start` re-exports everything above, the same values rather than copies. It adds:

- `morph: Morph`. Each call reads the current request's `x-morph-content-origin` through Start's `getRequest()`. Nothing is kept at module scope.
- `morphForRequest(): Morph`. A server-only function that returns a reader for the request being served.
- `contentOriginFor(request: Request, development?: boolean): string`.
- `MORPH_CONTENT_ORIGIN_HEADER = "x-morph-content-origin"`.

### `pages.get` is server only

- In the core, `pages.get` called where `window` and `document` both exist throws `invalid_content_origin` before anything is sent. The content endpoint sends no CORS headers.
- In `@morph/sdk/start`, the reads run through `createServerOnlyFn`. Start removes them from the client bundle, so call them from a loader's server function, a server route or `createServerFn`.

### Error codes

The codes are stable. The list is in the order of `src/errors.ts`:

`no_content_source`, `invalid_content_origin`, `invalid_path`, `store_unreachable`, `content_not_found`, `store_error`, `redirect_refused`, `invalid_response`, `response_too_large`, `reserved_slot`, `invalid_request`, `invalid_store_context`.

D5 is undecided: whether a browser call to `pages.get` should get its own code instead of `invalid_content_origin`. Until it is decided, the code stays as it is, and any change goes through the rule below.

### Open: media URL absolutization (not a guarantee)

The core makes `/_storefront-media/…` and `/api/store/assets/…` absolute against the content origin (`src/urls.ts`, applied in `src/client.ts`). The Starter's `content.ts` keeps them relative.

Through `@morph/sdk/start` on a hosted Theme, the content origin is not the public site:

- in a full-Start preview it is `http://morph-preview-content.invalid`, so media URLs would break there;
- during a build's prerender it is a loopback address, which could end up in published HTML.

This behaviour is **not part of the contract** and may change for the hosted thin entry. It waits on a user decision between two options:

- keep these paths relative for hosted Themes, as the Starter does today;
- make them absolute against a separate public origin.

Until then, a Theme must not rely on these URLs being absolute. The rule for changes below does not apply to this item.

### What a Theme gets, and when

- **Every preview and every new build** gets the SDK the running Morph injects at that moment. An existing Theme picks up an SDK change on its next build, with no change of its own.
- **A built release keeps the SDK it was built with.** The SDK is resolved through the aliases at build time and bundled into the build's artifact, like any other module. The build's `compilerVersion` records which SDK that was.
- **Rollback restores that build's SDK.** Activating an earlier release (`activateStorefrontRelease` → `activateReleaseWithDeployment` in `storefront-release-reconciler.ts`) redeploys that release's stored build artifact from R2 (`build.artifactPrefix`). It does not rebuild. So the rolled-back site runs exactly the SDK bundled when that build ran. A source rollback (`rollbackStorefrontThemeRevision`) is different: it creates a new revision, and that revision's next build gets the current SDK.

### Rule for changes

Because every next build picks up the current SDK, a change here reaches every hosted Theme without its author doing anything.

- Only backward-compatible, additive changes go into these two entry points, for example a new optional parameter, a new method or a new export.
- Nothing is removed or renamed, and the meaning of an existing method, parameter or error code does not change. That includes when a code is thrown.
- A breaking change needs a new entry path (for example `@morph/sdk/v2` or `@morph/sdk/start/v2`), a migration plan for existing Themes, and the user's approval before it starts.
- An addition updates the lists in `start/api-surface.test.ts` and this section in the same change.

## Limits (current behaviour, not the target)

- **Empty vs. missing pages.** A path without a document of its own answers with only the layout's slots, the same as a page whose document is empty. The SDK cannot tell them apart because the service does not say. Telling them apart is a target that needs an API and Starter change (#245 §6.2).
- **`content_not_found` names a missing store, not a missing page.** Renaming it is a target in the same change.
- **A published Theme is required.** `baseUrl` must be a merchant domain with a published Theme release. A content backend without a Theme is a target (#245 §4).
- **Server only for pages.** Browser reads across origins are deferred.
- **Other relative strings stay as sent.** Content values carry no field types, so a stored relative media URL (for example `/images/a.png`) or a link is not rewritten.
- **Not implemented:**
  - `If-None-Match` / 304;
  - `pages.list`, filters, other sorting, field selection;
  - draft reads (#214);
  - the platform's publishable-key path;
  - GraphQL.
