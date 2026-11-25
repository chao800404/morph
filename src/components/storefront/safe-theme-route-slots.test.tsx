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

  it("removes a disabled section instead of rendering its defaults", () => {
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
    expect(html).not.toContain("Component default");
    expect(html).toContain("<main");
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

/**
 * Two instances of one component, each fed by its own slot and guarded by
 * `isSectionHidden()`, as the Starter routes are. The guard skips the hidden
 * slot, so its Document entry is never spent; matching by source path alone
 * would hand that hidden entry to the other instance and drop it too.
 */
const duplicateFiles = [
  files[0],
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return (
    <main>
      {!isSectionHidden("hero-first") && <Hero {...content("hero-first")} />}
      {!isSectionHidden("hero-second") && <Hero {...content("hero-second")} />}
    </main>
  );
}`,
  },
  files[2],
];

function heroSection(id: string, heading: string, enabled: boolean) {
  return {
    id,
    type: "hero",
    componentRef: "src/components/Hero.tsx",
    enabled,
    props: { heading },
  };
}

function renderDuplicate(firstEnabled: boolean, secondEnabled: boolean) {
  const result = renderSafeThemeRoute({
    files: duplicateFiles,
    pathname: "/",
    document: {
      version: 1,
      sections: [
        heroSection("hero-first", "First stored heading", firstEnabled),
        heroSection("hero-second", "Second stored heading", secondEnabled),
      ],
    } as never,
  });
  expect(result.success, result.success ? "" : result.diagnostics.join()).toBe(
    true,
  );
  if (!result.success) return "";
  return renderToStaticMarkup(result.node as never);
}

describe("one component rendered twice, one instance hidden", () => {
  it("keeps the second instance when the first is hidden", () => {
    const html = renderDuplicate(false, true);
    expect(html).not.toContain("First stored heading");
    expect(html).toContain("Second stored heading");
    expect(html).not.toContain("Component default");
    expect(html.match(/<h1/g)?.length ?? 0).toBe(1);
  });

  it("keeps the first instance when the second is hidden", () => {
    const html = renderDuplicate(true, false);
    expect(html).toContain("First stored heading");
    expect(html).not.toContain("Second stored heading");
    expect(html).not.toContain("Component default");
    expect(html.match(/<h1/g)?.length ?? 0).toBe(1);
  });
});

/**
 * A legacy route: no `content()` import, so call sites carry no slot id and
 * each Document section is matched to a call site by component path, in
 * order. The hidden section must take its own call site with it, and only
 * that one.
 */
const legacyFiles = [
  files[0],
  {
    path: "src/routes/index.tsx",
    content: `import { createFileRoute } from "@tanstack/react-router";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
export function HomeRoute() {
  return (
    <main>
      <Hero />
      <Hero />
    </main>
  );
}`,
  },
  files[2],
];

function renderLegacy(firstEnabled: boolean, secondEnabled: boolean) {
  const result = renderSafeThemeRoute({
    files: legacyFiles,
    pathname: "/",
    document: {
      version: 1,
      sections: [
        heroSection("hero-first", "First stored heading", firstEnabled),
        heroSection("hero-second", "Second stored heading", secondEnabled),
      ],
    } as never,
  });
  expect(result.success, result.success ? "" : result.diagnostics.join()).toBe(
    true,
  );
  if (!result.success) return "";
  return renderToStaticMarkup(result.node as never);
}

describe("legacy route without slots, one of two instances hidden", () => {
  it("keeps the second instance when the first is hidden", () => {
    const html = renderLegacy(false, true);
    expect(html).not.toContain("First stored heading");
    expect(html).toContain("Second stored heading");
    expect(html).not.toContain("Component default");
    expect(html.match(/<h1/g)?.length ?? 0).toBe(1);
  });

  it("keeps the first instance when the second is hidden", () => {
    const html = renderLegacy(true, false);
    expect(html).toContain("First stored heading");
    expect(html).not.toContain("Second stored heading");
    expect(html).not.toContain("Component default");
    expect(html.match(/<h1/g)?.length ?? 0).toBe(1);
  });
});
