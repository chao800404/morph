# Morph SDK v0 (read core)

One framework-agnostic core for reading published Morph content and public products. It imports nothing outside this folder: no React, TanStack Start, Astro or Morph server code. It talks to Morph over HTTP only.

The contract is `docs/morph-sdk-read-contract.md` (#245). v0 is the core alone. It is **not published to npm**, and nothing in the app uses it yet: the platform's thin entry and the Starter migration come later.

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

`no_content_source` is in the type for parity with the Starter but is not produced in v0: there is always a `baseUrl`.

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

## As its own package

- **A workspace member.** It is listed in `pnpm-workspace.yaml` and stays `private`. The app does not depend on it or import it; that is stage 2 (#245 §7).
- **`pnpm check:sdk-package`** (CI: "Architecture guards") fails unless all of these hold:
  - it compiles from `tsconfig.json` in this folder alone: no app `paths`, no `baseUrl`, no `extends`, no ambient types;
  - every module a shipped file names is in this folder, or a dependency `package.json` declares;
  - Vite bundles the entry for a browser, a worker and Node with nothing loaded from outside this folder, and the Node bundle imports.

  This proves the package is self-contained and bundles for those targets. It does not prove that a Start or Astro app builds with it, or that it runs in a browser or a Worker.
