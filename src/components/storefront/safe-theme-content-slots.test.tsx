// @vitest-environment node
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";

const routeSource = `import { content } from "../morph/content";
import Hero from "../components/Hero";

export default function HomeRoute() {
  return (
    <main>
      <Hero {...content("hero")} />
    </main>
  );
}`;

const heroSource = `export default function Hero({ heading = "Default heading" }) {
  return <h1>{heading}</h1>;
}`;

function render(contentSlots?: Record<string, Record<string, unknown>>) {
  return renderSafeThemeComponent({
    files: [
      { path: "src/routes/index.tsx", content: routeSource },
      { path: "src/components/Hero.tsx", content: heroSource },
    ],
    sourcePath: "src/routes/index.tsx",
    componentName: "HomeRoute",
    props: {},
    contentSlots,
  } as never);
}

describe("content() slots in the Live preview", () => {
  it("passes stored slot values into the component", () => {
    const result = render({ hero: { heading: "Authored heading" } });
    expect(result.success, result.success ? "" : result.diagnostics.join()).toBe(
      true,
    );
    if (!result.success) return;
    expect(renderToStaticMarkup(result.node as never)).toContain(
      "Authored heading",
    );
  });

  it("falls back to the component's own defaults when a slot has no content", () => {
    const result = render({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(renderToStaticMarkup(result.node as never)).toContain(
      "Default heading",
    );
  });

  it("refuses a computed slot id", () => {
    // The editor lists and orders slots before the Theme runs, so an id it
    // cannot read statically must fail rather than half-work.
    const result = renderSafeThemeComponent({
      files: [
        {
          path: "src/routes/index.tsx",
          content: `import { content } from "../morph/content";
export default function HomeRoute() {
  return <main {...content(slotId)} />;
}`,
        },
      ],
      sourcePath: "src/routes/index.tsx",
      componentName: "HomeRoute",
      props: {},
      contentSlots: {},
    } as never);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics.join()).toContain("literal slot id");
  });

  it("refuses a slot id that is not identifier-shaped", () => {
    const result = renderSafeThemeComponent({
      files: [
        {
          path: "src/routes/index.tsx",
          content: `import { content } from "../morph/content";
export default function HomeRoute() {
  return <main {...content("__proto__")} />;
}`,
        },
      ],
      sourcePath: "src/routes/index.tsx",
      componentName: "HomeRoute",
      props: {},
      contentSlots: {},
    } as never);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.diagnostics.join()).toContain("Invalid content slot id");
  });
});
