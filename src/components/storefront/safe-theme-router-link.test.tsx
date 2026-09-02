// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

/**
 * `<Link>` is not route-only.
 *
 * Themes import it in ordinary components — headers, footers, hero sections —
 * and those render through `renderSafeThemeComponent` on their own, without the
 * route renderer supplying router builtins. Before this was handled the
 * interpreter refused the whole component with "not a local Theme Workspace
 * component", so a header with navigation showed a diagnostic instead of the
 * store's own markup.
 */
function render(content: string, files: { path: string; content: string }[] = []) {
  const result = renderSafeThemeComponent({
    files: [{ path: "src/components/Nav.tsx", content }, ...files],
    sourcePath: "src/components/Nav.tsx",
    props: {},
  } as never);
  expect(result.success, result.success ? "" : result.diagnostics.join("; ")).toBe(
    true,
  );
  if (!result.success) throw new Error("render failed");
  return renderToStaticMarkup(result.node as never);
}

describe("Link inside a standalone component", () => {
  it("renders as an anchor instead of being refused", () => {
    const html = render(`import { Link } from "@tanstack/react-router";

export default function Nav() {
  return (
    <nav>
      <Link to="/collections/all" className="nav-link">Shop</Link>
    </nav>
  );
}`);

    expect(html).toContain('href="/collections/all"');
    expect(html).toContain('class="nav-link"');
    expect(html).toContain(">Shop</a>");
  });

  it("interpolates params, search and hash the same way the route renderer does", () => {
    const html = render(`import { Link } from "@tanstack/react-router";

export default function Nav() {
  return (
    <Link
      to="/products/$id"
      params={{ id: "cast-iron" }}
      search={{ sort: "new" }}
      hash="reviews"
    >
      Detail
    </Link>
  );
}`);

    expect(html).toContain('href="/products/cast-iron?sort=new#reviews"');
  });

  it("drops router-only props rather than leaking them into the DOM", () => {
    const html = render(`import { Link } from "@tanstack/react-router";

export default function Nav() {
  return <Link to="/a" preload="intent" replace resetScroll>Go</Link>;
}`);

    expect(html).not.toContain("preload");
    expect(html).not.toContain("resetScroll");
  });

  it("refuses a javascript: destination", () => {
    const html = render(`import { Link } from "@tanstack/react-router";

export default function Nav() {
  return <Link to="javascript:alert(1)">Bad</Link>;
}`);

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("href=");
  });
});
