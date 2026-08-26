// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeRoute } from "./safe-theme-route-renderer";

const files = [
  {
    path: "src/routes/__root.tsx",
    content: `import { Outlet, createRootRoute } from "@tanstack/react-router";
export const Route = createRootRoute({ component: RootComponent });
export function RootComponent() {
  return <div><Outlet /></div>;
}`,
  },
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return (
    <main>
      <Hero {...content("starter-hero")} />
    </main>
  );
}`,
  },
  {
    path: "src/components/Hero.tsx",
    content: `export default function Hero({ heading = "Component default" }) {
  return <h1>{heading}</h1>;
}`,
  },
];

function renderHome(sections: unknown[]) {
  return renderSafeThemeRoute({
    files,
    pathname: "/",
    document: { version: 1, sections } as never,
  });
}

describe("content slots from the published document", () => {
  it("feeds a section's props into the slot its route declares", () => {
    const result = renderHome([
      {
        id: "starter-hero",
        type: "hero",
        enabled: true,
        props: { heading: "Authored in the editor" },
      },
    ]);

    expect(result.success, result.success ? "" : result.diagnostics.join()).toBe(
      true,
    );
    if (!result.success) return;
    expect(renderToStaticMarkup(result.node as never)).toContain(
      "Authored in the editor",
    );
  });

  it("keeps the component default when the document has no matching section", () => {
    const result = renderHome([]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(renderToStaticMarkup(result.node as never)).toContain(
      "Component default",
    );
  });

  it("does not supply content for a disabled section", () => {
    const result = renderHome([
      {
        id: "starter-hero",
        type: "hero",
        enabled: false,
        props: { heading: "Should not appear" },
      },
    ]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const html = renderToStaticMarkup(result.node as never);
    expect(html).not.toContain("Should not appear");
    expect(html).toContain("Component default");
  });

  it("ignores a section whose id could not be a slot", () => {
    const result = renderHome([
      { id: "has space", type: "hero", enabled: true, props: { heading: "x" } },
    ]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(renderToStaticMarkup(result.node as never)).toContain(
      "Component default",
    );
  });
});
