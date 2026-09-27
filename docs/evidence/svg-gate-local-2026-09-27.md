# SVG gate: local evidence (2026-09-27)

Recorded on the local branch `test/svg-gate-local-evidence` (never pushed, never merged). The tests were then cleaned up into `e2e/public-svg.spec.ts`, and the gate was opened in its own PR.
- It is main `af06ba5` with `themePublicSvgGate()` returning `"open"`, plus `e2e/svg-gate-evidence.spec.ts`.
- It ran on an idle machine through `scripts/run-editor-e2e.mjs` with `MORPH_E2E_TRANSPORT=cloudflare-sandbox`: a real Sandbox container and the real preview proxy.
- Run 3 passed: 4 tests (setup, transport precondition, both claims) in 3.1 min.

## 1. A clean SVG through the ordinary upload works

- **Entry:** `POST /api/storefront/theme-binary-file`, the one the editor and Site public/ use.
- **Stored:** `public/icons/evidence.svg`, 158 bytes, `image/svg+xml`, digest `29c2f8df…78baa5` (the SHA-256 of the bytes sent).
- **The same entry refused a script-carrying SVG:** 422 `THEME_PUBLIC_FILE_REFUSED`, "Event handler attributes are not allowed (line 1): <svg> onload".
- **Real Sandbox preview,** read from inside the preview frame:
  - `/__morph-theme-preview__/icons/evidence.svg`: 200, the same SHA-256, `image/svg+xml`, `content-security-policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`, `x-content-type-options: nosniff`.
  - `<img>` at that URL: decoded 40×20. Drawn onto a canvas, the rectangle pixel is `0,170,119,255` (`#0a7`) and the circle centre is `255,255,255,255`, as authored.

## 2. A script-carrying SVG does not run when opened directly through the proxy

- **How it got there:** written by the harness straight into this run's own disposable container (`/workspace/public/icons/evil.svg`), never through a product entry. No bypass was added to any upload path.
- **Payload:** an `onload` handler on `<svg>` and a `<script>`, each marking the document if it runs.
- **Opened directly** at `/__morph-theme-preview__/icons/evil.svg` through the real proxy, in Chromium, Firefox and WebKit:
  - 200, the planted bytes exactly, `image/svg+xml`, the sandbox CSP and `nosniff`;
  - **no script ran in any browser**.
- **Control, same browser and same origin:** the same bytes served without the headers (Playwright `route.fulfill`). The `onload` handler ran in all three browsers, so the detection works.

Not separated: whether the headers were added by the preview's Vite middleware or by the proxy's `finishPreviewResponse`. Both are meant to add them, and this checks the path a browser takes end to end.

## Found on the way (not SVG): root-path public/ files 404 in the Live Preview (fixed in PR #61)

- Both the SVG and a PNG control return 404 (`text/plain`) at `/icons/…`, the URL a Theme author writes. They return 200 with identical bytes under `/__morph-theme-preview__/`.
- The Live Preview's Vite `base` is `/__morph-theme-preview__/`, and nothing maps root-path requests to `public/`.
- So a Theme's `<img src="/images/hero.png">` does not show in the Live Preview, while the published storefront serves it at that path.
- Earlier public/ evidence read bytes through the admin endpoint and the published storefront, not this path.
- A separate item.

## Still required before production use

- Deploy gate: confirm the production isolation headers on a benign SVG (published from a controlled upload), then do the direct-open check.
- If the headers are missing:
  1. revert the gate commit;
  2. republish a release without SVG, or roll back the release, because a deployed release keeps serving its SVG files.
  3. After the revert, the pre-publish check (PR #60) refuses any revision that still holds an SVG.

## Rerun after the root-path fix (PR #61), 2026-09-28

- **Setup:** the branch was rebased onto main `8e1e5b1`, which includes #61. Run 6 was on an idle machine: 5 passed in 5.2 min.
- **Discarded run:** run 5 was started under load (another session's tests; load average up to 8.5). Its transport precondition timed out at 60 s, and none of the evidence tests ran. It counts for nothing.
- **A component referencing the SVG by its root URL:**
  - Through a Code-mode save, the hero component was given `<img src="/icons/component.svg">`, uploaded through the ordinary entry.
  - On the canvas, that element loaded 40×20 from `/icons/component.svg`.
  - Drawn to a canvas, its pixels are `0,170,119,255` (the rectangle) and `255,255,255,255` (the circle's centre), as authored.
  - Its response: 200, `image/svg+xml`, the sandbox CSP, and a SHA-256 equal to the upload's.
- **The root path now serves too:** `/icons/evidence.svg` and the PNG control load as `<img>` at the root URL.
- **The planted script-carrying SVG:**
  - Opened directly at the root path `/icons/evil.svg` (now served) and under the base, in Chromium, Firefox and WebKit: 200, the planted bytes, the sandbox CSP and `nosniff`. No script ran at either URL in any browser.
  - The header-less control ran in all three.

Both local gate conditions hold, with the author's root-path reference included.
