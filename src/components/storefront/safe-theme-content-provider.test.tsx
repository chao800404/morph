// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { STARTER_THEME_CONTENT_MODULE_SOURCE } from "@/lib/storefront/starter-theme-v3-files";
import { renderSafeThemeRoute } from "./safe-theme-route-renderer";

/**
 * Root route shaped like the starter's: it reads what `beforeLoad` loaded and
 * passes it down through the platform content provider. Neither mechanism
 * exists in the Design preview, so the preview has to answer both from the
 * Document without the Theme being written differently for it.
 */
const files = [
  {
    path: "src/routes/__root.tsx",
    content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
import { MorphContentProvider, loadContentSlots } from "../morph/content";
export const Route = createRootRoute({
  beforeLoad: async ({ location }) => ({
    morphContent: await loadContentSlots(location.pathname),
  }),
  component: RootComponent,
});
export function RootComponent() {
  const { morphContent } = Route.useRouteContext();
  return (
    <MorphContentProvider value={morphContent}>
      <div data-morph-node="page-root"><Outlet /></div>
    </MorphContentProvider>
  );
}`,
  },
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return <main><Hero {...content("starter-hero")} /></main>;
}`,
  },
  {
    path: "src/components/Hero.tsx",
    content: `export default function Hero({ heading = "Component default" }) {
  return <h1>{heading}</h1>;
}`,
  },
  {
    path: "src/morph/content.ts",
    content: STARTER_THEME_CONTENT_MODULE_SOURCE,
  },
];

function renderHome(sections: unknown[]) {
  return renderSafeThemeRoute({
    files,
    pathname: "/",
    document: { version: 1, sections } as never,
  });
}

describe("root route that provides published content", () => {
  it("renders stored values through a root route that uses the router context", () => {
    const result = renderHome([
      {
        id: "starter-hero",
        type: "hero",
        componentRef: "hero.default",
        enabled: true,
        props: { heading: "Heading from D1" },
      },
    ]);

    expect(result.diagnostics).toEqual([]);
    expect(result.success).toBe(true);
    const html = renderToStaticMarkup(result.node);
    expect(html).toContain('data-morph-node="page-root"');
    expect(html).toContain("Heading from D1");
  });

  it("falls back to component defaults when the route declares no matching section", () => {
    const result = renderHome([]);

    expect(result.diagnostics).toEqual([]);
    expect(renderToStaticMarkup(result.node)).toContain("Component default");
  });

  it("never interprets the platform content module itself", () => {
    // It is platform-generated and uses `createContext` and an isomorphic
    // server branch, neither of which the preview supports. Interpreting it
    // would fail the whole route for a value the preview resolves elsewhere.
    expect(STARTER_THEME_CONTENT_MODULE_SOURCE).toContain("createContext");
    expect(STARTER_THEME_CONTENT_MODULE_SOURCE).toContain("createIsomorphicFn");
    expect(renderHome([]).success).toBe(true);
  });
});
