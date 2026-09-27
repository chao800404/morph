/**
 * Whether a Theme's `public/` serves SVG.
 *
 * Open since 2026-09-28. Behind it: every write checks an SVG's bytes with
 * `validateSvg`, publish re-checks the frozen revision's, and every response
 * carries the isolation headers. It was opened on local evidence — a clean
 * SVG uploaded the ordinary way and referenced by a component is painted in
 * the real Sandbox preview, and a script-carrying one runs in no browser when
 * opened directly through the proxy (docs/evidence/svg-gate-local-2026-09-27.md,
 * e2e/public-svg.spec.ts).
 *
 * The deployed storefront is checked at deploy, not before (DEPLOY.md): a
 * benign SVG is uploaded and published, its response headers and a direct
 * open are checked, and if the headers are missing SVG is withdrawn — this
 * line back to "closed", and a release without SVG republished or rolled
 * back to, since a deployed release keeps serving its files. Once closed,
 * publish refuses any revision that still holds an SVG.
 *
 * A function in its own module, not a flag: nothing at runtime — no request,
 * no environment variable — can change it. Tests that need the other state
 * replace this module with `vi.mock`.
 */
export function themePublicSvgGate(): "closed" | "open" {
  return "open";
}
