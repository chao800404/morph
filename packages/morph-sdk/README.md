# Morph SDK v0 (read core)

One framework-agnostic core for reading published Morph content and public products. It imports nothing outside this folder: no React, TanStack Start, Astro or Morph server code. It talks to Morph over HTTP only.

The contract is proposed in [draft PR #245](https://github.com/chao800404/morph/pull/245). It is **not published to npm**. The app's own code does not import it; the platform copies it into every TanStack Start and Astro Theme workspace (see "How a Theme gets the SDK"). `start/` is the platform's thin entry for a hosted Start Theme (`@morph/sdk/start`); `astro/` is the one for a hosted Astro Theme (`@morph/sdk/astro`, see "Astro"). The Starter migration comes later.

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
- **Morph paths follow the entry's media URL mode** (see "Media URL mode"). From `createMorph` they are made absolute against `baseUrl`; from `@morph/sdk/start` they stay as Morph sent them. Only paths with these prefixes are ever rewritten:
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

## Astro

`@morph/sdk/astro` is the hosted Astro entry. An Astro page reads in its frontmatter exactly as ROADMAP 1.2 writes it:

```astro
---
import { morph } from "@morph/sdk/astro";
import Hero from "../components/Hero.astro";
const home = await morph.pages.get("/");
const { hero } = home;
---
<Hero {...hero} />
```

- **The request.** Astro has no `getRequest()`, and a module a page imports does not see `Astro.request`. So the platform's middleware runs every render inside an AsyncLocalStorage that holds that render's request, and hands that storage to this entry (`useMorphRenders`). Each read takes the request from there. The middleware and its storage are the platform's (`src/lib/storefront/compiler/theme-morph-sdk.ts`), not this package's: the package names no Node built-in, so it still passes `pnpm check:sdk-package`.
- **Wiring.** Morph's own Astro integrations add the middleware with `addMiddleware({ order: "pre" })`: the Live Preview's (`astro-preview-workspace.ts`) and the build's (`astro-native-prerender.ts`). It runs before any middleware of the author's. The author writes no middleware and no reader, and their `astro.config.*` is not changed.
- **Source.** The source is the platform's `x-morph-content-origin` header only. On the public site Core sets it; in the Live Preview the preview Worker sets it, for the draft snapshot; when prerendering, the build's wrapper sets it, for the sealed snapshot.
- **Failures.**
  - A read outside a wired render, or a request without the header, fails with `no_content_source`. It never falls back to default content.
  - Reading published content on the author's own machine is deferred, but must stay possible (docs/content-read-core-design.md §4.7).
- **AsyncLocalStorage on Workers.** The official `@astrojs/cloudflare` adapter already adds `nodejs_als` to the Worker config it writes, when no ALS-capable flag is set. Morph adds nothing.
- **Build identity.** An Astro build names the SDK it carries in its compiler version, as a Start build does: `<astro>+morph-sdk.<16 hex>`.

## How a Theme gets the SDK

A Theme does not install the SDK or own its files. The platform puts a copy in each build workspace, so the code a Theme runs is the code these tests ran.

1. **Sources.** `packages/morph-sdk/src/*.ts`, `packages/morph-sdk/start/*.ts` and `packages/morph-sdk/astro/*.ts`. Test files are left out.
2. **Generator.** `scripts/generate-morph-sdk-sources.mjs` is the only way the generated module is produced. Run `pnpm generate:morph-sdk` after any SDK change and commit the result.
   - It refuses an import that would not resolve in a workspace. Only the copy itself and `@tanstack/react-start` (and `/server`) are allowed.
   - `--check` (`pnpm check:morph-sdk-sources`) writes nothing. It exits 1 when the committed module is stale.
   - It is not a pre-step of `typecheck`, `test` or `build`, because a pre-step would repair a stale copy before anyone saw it. `src/lib/storefront/compiler/morph-sdk-sources-freshness.test.ts` runs `--check` in `pnpm test`, so a stale copy fails CI.
3. **Generated module.** `src/lib/storefront/compiler/morph-sdk-sources.generated.ts` (do not edit) exports:
   - `GENERATED_MORPH_SDK_SOURCES`: the files, at `.morph/sdk/src/*` and `.morph/sdk/start/*`;
   - `MORPH_SDK_SOURCE_HASH`: SHA-256 of the UTF-8 JSON `[[path, content], …]`, in path order.
4. **Workspace.** `theme-morph-sdk.ts` hands the files to every TanStack Start workspace, and every Astro preview and build workspace (`astro-preview-workspace.ts`, `astro-native-prerender.ts`), under `.morph/sdk/`:
   - the platform preview and build (`theme-sandbox-workspace.ts`, Themes with a route registry);
   - the local platform build runner (`local-vite-theme-build-runner.ts`), which writes the same files and aliases into its own configs;
   - the native Start build (`tanstack-start-native-build.ts`).
   A Theme file at the same path is replaced, never used.
5. **Aliases.** The generated Vite config (`theme-sandbox-workspace.ts`), the local runner's in-process configs (`themeMorphSdkAliases`) and the native wrapper (`tanstack-start-native-wrapper.ts`) map the exact names `@morph/sdk` → `.morph/sdk/src/index.ts`, `@morph/sdk/start` → `.morph/sdk/start/index.ts` and `@morph/sdk/astro` → `.morph/sdk/astro/index.ts`. They come before the Theme's own aliases. Any other `@morph/…` name is an unapproved package.

### Build identity

Every TanStack Start build records the SDK it was built with, in the build record's existing `compiler_version`. The value is `<toolchain>+morph-sdk.<first 16 hex of MORPH_SDK_SOURCE_HASH>`, for example `4.1.17+morph-sdk.0123456789abcdef`. A native build uses the pinned `@tanstack/react-start` version in place of `4.1.17`.

- The compiler version feeds `inputHash`, the reuse match (`findSucceededBuildByIdentity`), the runners' identity check and the artifact store's check. So an SDK change gives the same revision a new identity, and an old artifact is never reused for it.
- The value is frozen on the record when the build starts. A recorded build keeps naming its own SDK, and its hash still verifies after the SDK changes.
- A preview's workspace fingerprint covers every planned file, the copy included. So after an SDK change, the old workspace is not reused as current.

To compare a build with a checkout, take `MORPH_SDK_SOURCE_HASH` from the generated module. Its first 16 hex digits must match the suffix of the build's `compilerVersion`.

### Identity coverage of platform-injected files

Three kinds of file reach a Theme's workspace from the platform rather than from the Theme's revision. The table shows what notices a change to each. Paths are under `src/lib/storefront/`. Line numbers are as of this change.

- **Preview identity:** `themeWorkspaceFingerprint` (`compiler/theme-sandbox-workspace.ts:330`, computed over every planned file at `:1128`; Astro at `theme-framework/astro-preview-workspace.ts:397`).
- **Build identity:** the tuple `(sourceRevisionId, inputHash, compilerId, compilerVersion)` used by the reuse match (`service/theme-build.service.ts:118-171` → `dal/storefront-theme-build.dal.ts:394-419`), the runners' identity check and the artifact store (`compiler/cloudflare-r2-theme-build-artifact-store.ts:230`). `inputHash` (`compiler/theme-compiler-hasher.ts:62-115`) covers the revision's files and binary digests, the entry, the dependencies, the content snapshot, the framework, `toolchainId` and the compiler id and version. `toolchainId` is the SHA-256 of the Sandbox image's toolchain manifest (`theme-framework/theme-toolchains.ts:13-17`), so it names the installed packages, not anything Morph writes.

| Part | Written by | Preview identity | Build identity | In builds? |
| --- | --- | --- | --- | --- |
| (a) SDK copy, `.morph/sdk/*` | Start Themes, preview and build: `compiler/theme-sandbox-workspace.ts:609`; local platform build runner: `compiler/local-vite-theme-build-runner.ts:419-432`; native Start: `theme-framework/tanstack-start-native-build.ts:155` | **Covered.** A planned file like any other. Test: `compiler/theme-build-sdk-identity.test.ts:170` | **Covered** through `compilerVersion` = `<toolchain>+morph-sdk.<16 hex>` (`compiler/theme-morph-sdk.ts:68`). Set by the materializer default (`compiler/theme-build-materializer.ts:469`), both runners (`compiler/local-vite-theme-build-runner.ts:127`, `compiler/cloudflare-sandbox-vite-theme-build-runner.ts:247`) and native Start (`theme-framework/tanstack-start.framework.ts:89`). It feeds `inputHash` (`theme-compiler-hasher.ts:71`) and every check above. Tests: `theme-build-sdk-identity.test.ts:88-139` | Yes. Bundled into the artifact. |
| (b) Preview bridge: `compiler/preview-bridge-sources.generated.ts` → `src/morph/preview/` in the workspace, with the bridge entry and the preview content modules | Only when `mode === "preview-server"` (`compiler/theme-sandbox-workspace.ts:660-685`); Astro preview: `theme-framework/astro-preview-workspace.ts:358` | **Covered.** Planned files, fingerprinted with the rest | **Not applicable.** Never written into a build: not in mode `"build"`, not in the native Start plan (`tanstack-start-native-build.ts:137-161`), not in the Astro native build. The `index.html` script tag is preview-only too (`theme-sandbox-workspace.ts:650`). | **No.** Preview only. |
| (c) Platform wrappers: generated `vite.config.ts` with the SDK aliases and the prerender content plugin (`compiler/theme-sandbox-workspace.ts:745`, `:1015`, `:1119`); `wrangler.json` (`:583`); the full-Start preview Worker and client (`:616`, preview only); the local runner's in-process Vite configs (`compiler/local-vite-theme-build-runner.ts`, build only); native `.morph/vite.config.ts`, `.morph/native-build-hooks.mjs`, `.morph/native-build-loader.mjs`, `.morph/wrangler.json` (`theme-framework/tanstack-start-native-build.ts:137-153`); Astro native `.morph/` wrapper (`theme-framework/astro-native-build.ts:40-55`); Astro preview `.morph/astro.preview.config.mjs`, integration and `wrangler.preview.json` (`theme-framework/astro-preview-workspace.ts:66-71`) | As listed | **Covered.** Planned files, fingerprinted with the rest | **GAP.** Not covered. The wrapper text comes from the running Morph's code. It is in none of the inputs to `inputHash`, and it is not in `compilerVersion` (a fixed toolchain version, plus the SDK hash for Start) or `toolchainId` (the image manifest). After a Morph change that alters a wrapper, the same revision keeps the same identity tuple. | Yes |

**Gap (c), current exposure.** Reuse by identity is opt-in. `reuseExisting` defaults to `false` (`service/theme-build.service.ts:101`), and no product code path sets it. So today no artifact is handed back across a wrapper change. The gap matters once reuse is enabled, and for provenance: a build record does not say which wrapper built it. It is not fixed here.

**Proposal for (c), not implemented.** Name the wrappers in the same build-metadata slot as the SDK, with no schema change:

- A generator (or the existing SDK one) renders each wrapper with fixed canonical inputs: the native wrapper config, hooks and loader; the platform `vite.config.ts` and `wrangler.json` of a canonical Start fixture in mode `"build"`; the Astro wrapper. Build-specific values are left out: build id, workspace roots and content. The generator emits `MORPH_WRAPPER_HASH`, and its `--check` freshness test fails when a wrapper changes without regeneration.
- `compilerVersion` becomes `<toolchain>+morph-sdk.<12 hex>.wrap.<8 hex>`. Astro gets `<astro>+wrap.<8 hex>`.
- The column's 50-character input limit holds: `1.168.32+morph-sdk.<12>.wrap.<8>` is 45 characters.
- Existing records keep their frozen value and still verify. A new build gets a new tuple, so a reuse match can no longer cross a wrapper change.

One side effect of (a): a platform build of a legacy Theme with no route registry also records the SDK suffix, though its workspace carries no SDK. This only makes an identity change more often than needed. It never makes one too rarely.

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

### Media URL mode

Each entry point has one media URL mode. The mode is part of that entry's stable contract: changing an entry's mode is a breaking change, under the rule for changes below.

| Entry                         | Mode         | `/_storefront-media/…`, `/api/store/assets/…`                   | Why                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createMorph({ baseUrl })`    | `"absolute"` | Made absolute against `baseUrl`                                 | An external site is on another origin and would resolve them against itself.                                                                                                                                                                                         |
| `@morph/sdk/start` (`morph`, `morphForRequest()`) | `"relative"` | Left exactly as Morph sent them, as the Starter's `content.ts` does | A hosted Theme's pages are served on the origin these paths belong to. Its content origin is a platform address that must never reach a page: `http://morph-preview-content.invalid` in a full-Start preview, a loopback address during a build's prerender. |

- **One implementation.** Both entries build on the same reader (`createMorphReader` in `src/client.ts`). The mode is an explicit argument, and the entry fixes it. Every other step of a read is shared: validation, size cap, refusals and errors. Only the URL step differs (`resolveMorphPaths` in `src/urls.ts`).
- **Not a caller option.** `createMorphReader` is not exported from either entry, and `MorphOptions` has no mode field. A site or Theme gets its entry's mode; it cannot choose another.
- `createMorph`, re-exported from `@morph/sdk/start`, is still the external entry. It stays absolute when called from a hosted Theme.
- Other strings are never rewritten in either mode (see "Limits").
- Tests: `src/media-urls.test.ts` (both modes, pages and products, nested arrays and objects), `start/index.test.ts` (the hosted entry against the preview, IPv4 and IPv6 loopback origins), `start/api-surface.test.ts` (each entry's mode). Integration: `local-vite-preview-server.start.test.ts` (full-Start preview), `native-prerender.test.ts` (prerendered HTML), `native-start-build.test.ts` (a native build served per request).

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

## As its own package

- **A workspace member.** It is listed in `pnpm-workspace.yaml` and stays `private`. The app does not depend on it or import it; that is stage 2 (#245 §7).
- **`pnpm check:sdk-package`** (CI: "Architecture guards") fails unless all of these hold:
  - it compiles from `tsconfig.json` in this folder alone: no app `paths`, no `baseUrl`, no `extends`, no ambient types;
  - every module a shipped file names is in this folder, or a dependency `package.json` declares;
  - Vite bundles the entry for a browser, a worker and Node with nothing loaded from outside this folder, and the Node bundle imports.

  This proves the package is self-contained and bundles for those targets. It does not prove that a Start or Astro app builds with it, or that it runs in a browser or a Worker.
- **Two entries.** `.` (the core) and `./start` (the hosted thin entry). `./start` imports `@tanstack/react-start` and `@tanstack/react-start/server`. That is declared as an optional peer dependency, pinned to the Start toolchain's version. The core needs it not at all.
  - The import scan above covers both entries.
  - The package's own `tsconfig.json` and the bundles cover only `.`.
  - `./start` is type-checked by the app's `pnpm typecheck` and tested in `pnpm test`, including real preview and Start builds (see "Media URL mode").
