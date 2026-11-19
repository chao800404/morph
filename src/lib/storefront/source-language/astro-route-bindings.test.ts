// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { ASTRO_FIXTURE, astroPage } from "@/lib/test-utils/astro-b1-samples";
import { sourceSectionIdentity } from "../compiler/theme-route-sections";
import {
  astroRouteBindingsView,
  reachableAstroModules,
  readAstroRoute,
  type AstroRouteReading,
} from "./astro-route-bindings";

const INDEX = "src/pages/index.astro";
const page = astroPage(
  'const home = await morph.pages.get("/");\nconst { hero } = home;\n',
  "<Hero {...hero} />",
);
const files = [...ASTRO_FIXTURE, { path: INDEX, content: page }];
const contents = new Map(files.map((file) => [file.path, file.content]));

describe("which .astro modules a page reaches", () => {
  it("follows every import, through script modules too, page first", () => {
    expect(reachableAstroModules(INDEX, contents)).toEqual([
      INDEX,
      "src/components/Hero.astro",
      "src/components/Card.astro",
      "src/components/Layout.astro",
      "src/components/Badge.astro",
    ]);
  });

  it("does not parse a component the page never reaches", () => {
    expect(reachableAstroModules(INDEX, contents)).not.toContain(
      "src/components/Fragment.astro",
    );
  });
});

describe("reading a page refuses before guessing", () => {
  it("refuses a dynamic page as a capability limit without asking the parser", async () => {
    const result = await readAstroRoute({
      binding: {
        fetch: () => {
          throw new Error("the parser must not be asked");
        },
      },
      files,
      route: { path: "/blog/[slug]", sourcePath: INDEX, dynamic: true },
    });
    expect(result).toMatchObject({
      ok: false,
      class: "capability-limit",
      reason: "dynamic-route",
    });
  });

  it("refuses as temporarily unconfirmable where there is no parser", async () => {
    const result = await readAstroRoute({
      binding: null,
      files,
      route: { path: "/", sourcePath: INDEX, dynamic: false },
    });
    expect(result).toMatchObject({
      ok: false,
      class: "temporarily-unconfirmable",
      reason: "parser-binding-missing",
    });
  });

  it("refuses a Markdown, MDX or HTML page as a capability limit without asking the parser", async () => {
    for (const sourcePath of [
      "src/pages/notes.md",
      "src/pages/notes.mdx",
      "src/pages/notes.html",
    ]) {
      const result = await readAstroRoute({
        binding: {
          fetch: () => {
            throw new Error("the parser must not be asked");
          },
        },
        files: [...files, { path: sourcePath, content: "# Notes\n" }],
        route: { path: "/notes", sourcePath, dynamic: false },
      });
      expect(result).toMatchObject({
        ok: false,
        class: "capability-limit",
        reason: "page-language-unsupported",
      });
    }
  });

  it("answers a binding failure by its reason code, never the binding's own message", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await readAstroRoute({
      binding: {
        fetch: async () => {
          throw new Error(
            "connect ECONNREFUSED 10.9.8.7:4431 parser-internal-host",
          );
        },
      },
      files,
      route: { path: "/", sourcePath: INDEX, dynamic: false },
    });
    expect(result).toMatchObject({
      ok: false,
      class: "temporarily-unconfirmable",
      reason: "parser-binding-failed",
    });
    expect(JSON.stringify(result)).not.toMatch(
      /ECONNREFUSED|10\.9\.8\.7|parser-internal-host/,
    );
    warn.mockRestore();
  });

  it("refuses a snapshot that names one file twice", async () => {
    const result = await readAstroRoute({
      binding: null,
      files: [...files, { path: `./${INDEX}`, content: page }],
      route: { path: "/", sourcePath: INDEX, dynamic: false },
    });
    expect(result).toMatchObject({ ok: false, reason: "source-stale" });
  });
});

describe("the stored identity of a section a source instance renders", () => {
  it("is the manifest's one ref for the file, and its type", () => {
    expect(
      sourceSectionIdentity({
        files,
        componentSourcePath: "src/components/Hero.astro",
        componentExport: "default",
        componentName: "Hero",
      }),
    ).toEqual({ componentRef: "hero", sectionType: "hero" });
  });

  it("is the source path when the manifest names no ref for it", () => {
    expect(
      sourceSectionIdentity({
        files: files.filter((file) => file.path !== "morph.theme.json"),
        componentSourcePath: "src/components/HeroBanner.astro",
        componentExport: "default",
        componentName: "HeroBanner",
      }),
    ).toEqual({
      componentRef: "src/components/HeroBanner.astro",
      sectionType: "hero-banner",
    });
  });
});

describe("the binding view of a page whose analysis has diagnostics", () => {
  it("refuses the whole page as controlled by code (D) and offers no instance", async () => {
    const reading = {
      ok: true,
      route: { path: "/", sourcePath: INDEX, dynamic: false },
      identityInput: {
        routeFile: INDEX,
        template: {} as never,
        projection: {} as never,
        analysis: {
          routeFile: INDEX,
          instances: [],
          taints: [],
          loaderOrigin: false,
          diagnostics: ["content is imported more than once"],
        },
      },
    } satisfies AstroRouteReading;
    const view = await astroRouteBindingsView({
      routePath: "/",
      sourceGeneration: 7,
      files,
      reading,
    });
    expect(view).toMatchObject({
      routeFile: INDEX,
      sourceGeneration: 7,
      boundaryRule: 2,
      status: {
        kind: "refused",
        class: "controlled-by-code",
        reason: "analysis-diagnostics",
        detail: "content is imported more than once",
      },
      instances: [],
    });
  });
});
