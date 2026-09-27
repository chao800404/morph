/**
 * Whether a Theme's `public/` serves SVG.
 *
 * Closed. Everything an open gate needs is wired — every write checks an SVG's
 * bytes with `validateSvg`, publish re-checks the frozen revision's, and every
 * response carries the isolation headers — but opening it waits on evidence
 * no local test can give:
 * - a real Sandbox preview of an SVG uploaded the ordinary way;
 * - a browser opening that SVG directly and running none of its script;
 * - the deployed storefront's response for it.
 *
 * A function in its own module, not a flag: nothing at runtime — no request,
 * no environment variable — can open it. Tests that exercise the open path
 * replace this module with `vi.mock`, and lifting the gate is changing this
 * one line in a reviewed commit.
 */
export function themePublicSvgGate(): "closed" | "open" {
  return "closed";
}
