# Full TanStack Start Live Preview — prototype status, 2026-10-02

PROTOTYPE branch `feat/full-start-preview`, opt-in with the Worker var `MORPH_THEME_PREVIEW_RUNTIME=start`. Not for main. This records what was measured locally on the CI transport (local sidecar) after merging main up to #83 (`0dca741`); #84 (the Retry Preview fix) landed on main afterwards and is not in these runs. Each run's results are kept under `/tmp/audit/pw-runs/fp-<runtime>-<time>/`.

## What runs

With the Start runtime the preview workspace runs TanStack Start in workerd (Cloudflare Vite plugin + `tanstackStart()`), as the published Theme does.

`e2e/native-compat-preview.spec.ts`, Start runtime, CI transport: **14 passed, 3 skipped** (the 3 are the client-only `KNOWN GAP` cases, which do not apply). Covered:

- SSR loaders that call server functions through function middleware;
- server functions from the client: GET, POST, a thrown error;
- HttpOnly cookies on the preview's own page (`setResponseHeader`, `getCookie`/`setCookie`);
- server routes: JSON GET and POST, a redirect, `robots.txt`;
- client `Link` navigation keeping the document, and the editor channel surviving the Theme's own navigation;
- a Code-mode save applied by HMR, keeping the document;
- a preview's root paths not answered with Morph's own files.

Earlier the same suite had passed only on the Sandbox transport.

## Fixed on the branch: the editor's overlays fed back as structure

A Start Theme owns the whole document, so the bridge's structure root is `<body>`, and the editor's own selection and hover overlays live there. Every overlay update was reported as a change of the page's structure; the editor answered, the overlays updated again, and the reports never stopped. A probe counted more than 25 structure reports in 3 s after one tree click, against none on the client-only preview.

The visible effects:

- the Code tab switched to the route file, so a Code-mode save wrote `src/routes/index.tsx` instead of the component being edited;
- canvas selection lost elements mid-scan.

Fix (`d1181ea`, then `1ea09af`): the structure observer leaves out a mutation only when it is inside one of the editor's two overlays, or adds or removes nothing but them. The overlays are recognised by identity (`owns`), so a Theme cannot hide its own structure by imitating a marker; the first version used a `data-morph-editor-ui` attribute and was replaced for that reason. Unit tests with a real `MutationObserver` show a Theme node added or removed, a Theme element's attribute, class and text changes, and a Theme node added together with an overlay all still reported. After it, the same probe saw no structure reports in that window, and the canvas style edit and the `public/` root-URL Code save pass under Start. The stale-measurement editor test also read the preview channel from the frame's own address, which a Start preview drops on its first navigation; it now reads the iframe `src` and passes on both runtimes.

## Editor suites under the Start runtime

`native-compat-preview`, `editor`, `editor-writes-paused`, `auth-failure`, `preview-frame-load`, `public-root-url`, `text-promotion` and `responsive`:

- after the overlay fix: **49 passed, 3 skipped, 1 failed** (`fp-start-20261002-041800`); the failure was the test race described under gap 1;
- after the helper fix as well: **50 passed, 3 skipped, 0 failed** (`fp-start-20261002-055426`). The 3 skipped are the client-only `KNOWN GAP` cases.

## Open gaps

1. ~~A Code save can stall while a Start preview applies it~~ — **not a stall; a test race, now fixed.** The first reading of `text-promotion`'s trace marked the save as never answered, but the trace simply ended 1.8 s after the save went out. The shared helper `saveEditedSource` waited for any POST carrying the file path, and under Start the preview's own file sync (which goes out first, while the save waits on its formatter) matched it. The test then switched to Design, which correctly waited for the save, and probed the canvas while still in Code. The helper now waits for the `saveStorefrontThemeFile` call itself and requires its body to say the file was saved. After that, `text-promotion` and `public-root-url` pass on both runtimes (`fp-start-20261002-053012`, `fp-client-20261002-053531`). The same helper is on main and is corrected there separately.
2. **A Theme's default (Lax) cookie is not kept inside the editor canvas.** The preview is framed cross-site, which the preview's security boundary requires: a registrable domain of its own. Opened as its own page the same cookie round-trips. This is asserted as a `KNOWN GAP` and follows from the isolation requirement; it is not a bug to remove.
3. **Measured locally only.** Not in Cloudflare, not with the Sandbox container's real startup, network or resource limits.

## Startup, editor open to Theme rendered (local, preliminary)

Two fresh runs per runtime; "cold" is the first open of a fresh e2e run, "warm" three reloads after it. No containers were touched.

| runtime | run | cold | warm |
|---|---|---|---|
| client-only | 1 | 6.1 s | 5.5 / 5.7 / 4.8 s |
| Start | 1 | 5.9 s | 5.4 / 4.5 / 4.4 s |
| client-only | 2 | 8.3 s | 7.9 / 8.2 / 7.0 s |
| Start | 2 | 5.7 s | 4.6 / 4.5 / 4.7 s |

Client run 2 was slower in everything, page load included (2.2–2.4 s against about 0.8 s otherwise), which points at machine load rather than the runtime. Locally the Start preview is not slower than the client-only one. That says nothing yet about Cloudflare.

## Before this could replace the client-only preview

- Measure in an isolated Cloudflare environment: cold and warm start, time to interactive.
- The preconditions in ROADMAP "TanStack Start 原生相容" for opening a full Start preview to users: outbound allow-list, resource budgets, cross-preview cookie isolation, control-service authorization. None of them is addressed here.
