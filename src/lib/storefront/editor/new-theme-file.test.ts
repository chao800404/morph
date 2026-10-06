import { describe, expect, it } from "vitest";
import { resolveThemeContentCapabilitiesFromFiles } from "@/lib/storefront/theme-content-capability-resolver";
import {
  prepareNewThemeFile,
  scaffoldThemeFile,
  themeFileMimeType,
} from "./new-theme-file";

const existing = ["src/components/Hero.tsx", "morph.theme.json"];

describe("prepareNewThemeFile", () => {
  it("accepts a component path and scaffolds an editable component", () => {
    const result = prepareNewThemeFile("src/components/Promo.tsx", existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe("src/components/Promo.tsx");
    expect(result.mimeType).toBe("text/typescript");
    // The fields live in the sibling created with it, so only one file
    // declares them and the two can never differ.
    expect(result.content).not.toContain("contentFields");
    expect(result.content).toContain("export default function Promo");
    // Live Preview supplies source-location identity and infers the heading
    // field from the component props, so new files stay free of hand-written
    // editor markers.
    expect(result.content).not.toContain("data-morph-section");
    expect(result.content).not.toContain("data-morph-node");
    expect(result.content).not.toContain("data-morph-element");
  });

  it("creates a component and its <Name>.fields.ts together", () => {
    const result = prepareNewThemeFile("src/components/Promo.tsx", existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.companions).toEqual([
      {
        path: "src/components/Promo.fields.ts",
        content: expect.stringContaining("export const contentFields"),
        mimeType: "text/typescript",
      },
    ]);
  });

  it("refuses rather than overwrites an existing <Name>.fields.ts", () => {
    const result = prepareNewThemeFile("src/components/Promo.tsx", [
      ...existing,
      "src/components/Promo.fields.ts",
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("src/components/Promo.fields.ts");
    expect(result.message).toContain("already exists");
  });

  it("exposes the scaffolded field through the sibling declaration", () => {
    const result = prepareNewThemeFile("src/components/Promo.tsx", existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { capabilities, diagnostics } =
      resolveThemeContentCapabilitiesFromFiles(
        [result, ...result.companions].map(({ path, content }) => ({
          path,
          content,
        })),
        { includeManifestFallback: false },
      );
    expect(capabilities["src/components/Promo.tsx"]).toEqual({
      fields: { heading: { type: "text", label: "Heading" } },
    });
    expect(diagnostics).toEqual([]);
  });

  it("scaffolds TanStack file routes instead of generic components", () => {
    const result = prepareNewThemeFile("src/routes/about.tsx", existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain(
      'import { createFileRoute } from "@tanstack/react-router";',
    );
    expect(result.content).toContain('createFileRoute("/about")');
    expect(result.content).toContain("function AboutRoute");
    expect(result.content).not.toContain("contentFields");
    expect(result.companions).toEqual([]);
  });

  it("creates routes and non-component files without a sibling", () => {
    for (const path of [
      "src/routes/about.tsx",
      "src/routes/blog/index.tsx",
      "src/routes/__root.tsx",
      "src/routes/api/health.ts",
      "src/util.ts",
      "src/styles/extra.css",
      "data.json",
    ]) {
      const result = prepareNewThemeFile(path, existing);
      expect(result.ok, path).toBe(true);
      if (!result.ok) return;
      expect(result.companions, path).toEqual([]);
      expect(result.content, path).toBe(scaffoldThemeFile(path));
    }
    // A route is never refused because of a same-named file beside it.
    expect(
      prepareNewThemeFile("src/routes/about.tsx", [
        ...existing,
        "src/routes/about.fields.ts",
      ]).ok,
    ).toBe(true);
  });

  it("uses the file-route index convention for nested and root routes", () => {
    const nested = prepareNewThemeFile("src/routes/blog/index.tsx", existing);
    expect(nested.ok).toBe(true);
    if (!nested.ok) return;
    expect(nested.content).toContain('createFileRoute("/blog/")');

    const root = prepareNewThemeFile("src/routes/__root.tsx", existing);
    expect(root.ok).toBe(true);
    if (!root.ok) return;
    expect(root.content).toContain(
      'import { Outlet, createRootRoute } from "@tanstack/react-router";',
    );
    expect(root.content).toContain("function RootRoute");
  });

  it("scaffolds TanStack flat-file and pathless routes with their derived ids", () => {
    const dynamic = prepareNewThemeFile(
      "src/routes/posts.$postId.tsx",
      existing,
    );
    expect(dynamic.ok).toBe(true);
    if (!dynamic.ok) return;
    expect(dynamic.content).toContain('createFileRoute("/posts/$postId")');

    const pathless = prepareNewThemeFile(
      "src/routes/_marketing.about.tsx",
      existing,
    );
    expect(pathless.ok).toBe(true);
    if (!pathless.ok) return;
    expect(pathless.content).toContain('createFileRoute("/_marketing/about")');

    const lazy = prepareNewThemeFile("src/routes/about.lazy.tsx", existing);
    expect(lazy.ok).toBe(true);
    if (!lazy.ok) return;
    expect(lazy.content).toContain("createLazyFileRoute");
    expect(lazy.content).toContain('createLazyFileRoute("/about")');
  });

  it("creates a server-compatible .ts route seed without JSX", () => {
    const result = prepareNewThemeFile("src/routes/api/health.ts", existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toContain('createFileRoute("/api/health")');
    expect(result.content).not.toContain("<main");
  });

  it("normalizes a leading slash and backslashes", () => {
    const result = prepareNewThemeFile("/src\\components\\Promo.tsx", existing);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.path).toBe("src/components/Promo.tsx");
  });

  it("refuses a path that already exists", () => {
    const result = prepareNewThemeFile("src/components/Hero.tsx", existing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("already exists");
  });

  it("creates a project's own build configuration, kept in source", () => {
    for (const [path, content] of [
      ["vite.config.ts", "export {};\n"],
      ["wrangler.jsonc", "{}\n"],
      ["wrangler.json", "{}\n"],
      ["src/routeTree.gen.ts", "export {};\n"],
    ] as const) {
      expect(prepareNewThemeFile(path, existing), path).toMatchObject({
        ok: true,
        path,
        content,
      });
    }
  });

  it("refuses platform-generated build files", () => {
    for (const path of [
      "__entry.tsx",
      "__morph_preview_worker.ts",
      "__morph_preview_client.ts",
    ]) {
      const result = prepareNewThemeFile(path, existing);
      expect(result.ok, path).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain("generated by the build");
    }
  });

  it("refuses replacing the platform-provided content module", () => {
    const result = prepareNewThemeFile("src/morph/content.ts", existing);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("provided by Morph");
  });

  it("refuses traversal and unsafe paths", () => {
    for (const path of [
      "../secret.tsx",
      "src/../../etc/passwd.tsx",
      "src/node_modules/x.tsx",
      "src/comp onent.tsx",
    ]) {
      expect(prepareNewThemeFile(path, existing).ok, path).toBe(false);
    }
  });

  it("refuses extensions the build toolchain would ignore", () => {
    for (const path of ["src/notes.md", "src/image.png", "src/script.js"]) {
      const result = prepareNewThemeFile(path, existing);
      expect(result.ok, path).toBe(false);
      if (result.ok) return;
      expect(result.message).toContain("can be created");
    }
  });

  it("refuses an empty path or a folder", () => {
    expect(prepareNewThemeFile("", existing).ok).toBe(false);
    expect(prepareNewThemeFile("   ", existing).ok).toBe(false);
    expect(prepareNewThemeFile("src/components/", existing).ok).toBe(false);
  });
});

describe("scaffoldThemeFile", () => {
  it("derives a valid component name from the filename", () => {
    expect(scaffoldThemeFile("src/components/promo-banner.tsx")).toContain(
      "function PromoBanner",
    );
  });

  it("does not require editor markers for any filename style", () => {
    for (const path of [
      "src/components/PromoBanner.tsx",
      "src/components/promo-banner.tsx",
    ]) {
      const content = scaffoldThemeFile(path);
      expect(content).not.toContain("data-morph-section");
      expect(content).not.toContain("data-morph-node");
      expect(content).not.toContain("data-morph-element");
    }
  });

  it("keeps the declaration in a component no sibling would be read for", () => {
    expect(scaffoldThemeFile("Widget.tsx")).toContain(
      "export const contentFields",
    );
  });

  it("produces empty or minimal seeds for non-component files", () => {
    expect(scaffoldThemeFile("src/styles/extra.css")).toBe("");
    expect(scaffoldThemeFile("data.json")).toBe("{}\n");
    expect(scaffoldThemeFile("src/util.ts")).toBe("export {};\n");
  });
});

describe("themeFileMimeType", () => {
  it("maps each creatable extension", () => {
    expect(themeFileMimeType("a.tsx")).toBe("text/typescript");
    expect(themeFileMimeType("a.ts")).toBe("text/typescript");
    expect(themeFileMimeType("a.css")).toBe("text/css");
    expect(themeFileMimeType("a.json")).toBe("application/json");
  });
});
