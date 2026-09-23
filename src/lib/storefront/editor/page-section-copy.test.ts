import { describe, expect, it } from "vitest";
import {
  choosePageSectionSlotId,
  legacyPageSectionRouteKey,
  listSectionTemplateSourcePaths,
  pageSectionInstanceRoot,
  pageSectionRouteKey,
  planPageSectionCopy,
  planPageSectionRemoval,
} from "./page-section-copy";

const HERO = `import ThemeLink from "../ThemeLink";
export const contentFields = {};
export default function Hero() { return <ThemeLink />; }
`;

describe("pageSectionRouteKey", () => {
  it("names a route by its file in TanStack's flat notation", () => {
    expect(pageSectionRouteKey("src/routes/index.tsx")).toBe("index");
    expect(pageSectionRouteKey("src/routes/about.tsx")).toBe("about");
    expect(pageSectionRouteKey("src/routes/products/$slug.tsx")).toBe(
      "products.$slug",
    );
    expect(pageSectionRouteKey("src/routes/products/index.tsx")).toBe(
      "products.index",
    );
  });

  it("keeps a layout route and its child index apart", () => {
    // Nested mirroring would put `products.tsx`'s slot `index` and the
    // `products/index.tsx` route in the same folder.
    expect(pageSectionInstanceRoot("src/routes/products.tsx", "index")).toBe(
      "src/components/page-sections/products/index",
    );
    expect(
      pageSectionInstanceRoot("src/routes/products/index.tsx", "hero"),
    ).toBe("src/components/page-sections/products.index/hero");
  });

  it("refuses the root route and paths that are not routes", () => {
    expect(pageSectionRouteKey("src/routes/__root.tsx")).toBeNull();
    expect(pageSectionRouteKey("src/components/Hero.tsx")).toBeNull();
    expect(
      pageSectionInstanceRoot("src/routes/index.tsx", "Bad slot"),
    ).toBeNull();
  });
});

describe("choosePageSectionSlotId", () => {
  it("skips slots the route uses and folders already on disk", () => {
    expect(
      choosePageSectionSlotId({
        baseSlotId: "hero",
        usedSlotIds: new Set(["hero"]),
        routeSourcePath: "src/routes/index.tsx",
        existingPaths: ["src/components/page-sections/index/hero-2/index.tsx"],
      }),
    ).toBe("hero-3");
  });
});

describe("planPageSectionCopy", () => {
  it("copies a single-file section into the slot's folder", () => {
    const plan = planPageSectionCopy({
      entryPath: "src/components/sections/Hero.tsx",
      routeSourcePath: "src/routes/index.tsx",
      slotId: "hero",
      files: [
        { path: "src/components/sections/Hero.tsx", content: HERO },
        {
          path: "src/components/ThemeLink.tsx",
          content: "export default () => null;",
        },
      ],
    });

    expect(plan).toMatchObject({
      ok: true,
      root: "src/components/page-sections/index/hero",
      entryPath: "src/components/page-sections/index/hero/index.tsx",
    });
    if (!plan.ok) return;
    expect(plan.files).toHaveLength(1);
    // Shared code stays shared: the copy imports the one ThemeLink.
    expect(plan.files[0]!.content).toContain('from "../../../ThemeLink"');
  });

  it("copies what a re-export entry points at, not the re-export", () => {
    const plan = planPageSectionCopy({
      entryPath: "src/components/sections/Hero.tsx",
      routeSourcePath: "src/routes/about.tsx",
      slotId: "hero",
      files: [
        {
          path: "src/components/sections/Hero.tsx",
          content: 'export { contentFields, default } from "../Hero";\n',
        },
        {
          path: "src/components/Hero.tsx",
          content: HERO.replace("../ThemeLink", "./ThemeLink"),
        },
        {
          path: "src/components/ThemeLink.tsx",
          content: "export default () => null;",
        },
      ],
    });

    expect(plan).toMatchObject({
      ok: true,
      implementationPath: "src/components/Hero.tsx",
      entryPath: "src/components/page-sections/about/hero/index.tsx",
    });
    if (!plan.ok) return;
    expect(plan.files[0]!.content).toContain("export default function Hero");
    expect(plan.files[0]!.content).toContain('from "../../../ThemeLink"');
  });

  it("copies a folder section whole and points its parts at the copy", () => {
    const plan = planPageSectionCopy({
      entryPath: "src/components/sections/featured/index.tsx",
      routeSourcePath: "src/routes/index.tsx",
      slotId: "featured",
      files: [
        {
          path: "src/components/sections/featured/index.tsx",
          content:
            'import Card from "./Card";\nexport default function F() { return <Card />; }\n',
        },
        {
          path: "src/components/sections/featured/Card.tsx",
          content: "export default () => null;",
        },
        { path: "src/components/sections/featured/Card.test.tsx", content: "" },
      ],
    });

    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.files.map((file) => file.path)).toEqual([
      "src/components/page-sections/index/featured/Card.tsx",
      "src/components/page-sections/index/featured/index.tsx",
    ]);
    expect(plan.files[1]!.content).toContain('from "./Card"');
  });

  it("copies JSX sections and their JavaScript helpers", () => {
    const plan = planPageSectionCopy({
      entryPath: "src/components/sections/featured/index.jsx",
      routeSourcePath: "src/routes/index.tsx",
      slotId: "featured",
      files: [
        {
          path: "src/components/sections/featured/index.jsx",
          content:
            'import Card from "./Card.jsx";\nexport default function Featured() { return <Card />; }\n',
        },
        {
          path: "src/components/sections/featured/Card.jsx",
          content: "export default function Card() { return <img />; }",
        },
        {
          path: "src/components/sections/featured/format.js",
          content: "export const label = 'Featured';",
        },
      ],
    });

    expect(plan).toMatchObject({
      ok: true,
      entryPath: "src/components/page-sections/index/featured/index.jsx",
    });
    if (!plan.ok) return;
    expect(plan.files.map((file) => file.path)).toEqual([
      "src/components/page-sections/index/featured/Card.jsx",
      "src/components/page-sections/index/featured/format.js",
      "src/components/page-sections/index/featured/index.jsx",
    ]);
    expect(
      plan.files.every((file) => file.mimeType === "text/javascript"),
    ).toBe(true);
    expect(plan.files[2]!.content).toContain('from "./Card.jsx"');
  });

  it("refuses a section that imports another section", () => {
    const plan = planPageSectionCopy({
      entryPath: "src/components/sections/Promo.tsx",
      routeSourcePath: "src/routes/index.tsx",
      slotId: "promo",
      files: [
        {
          path: "src/components/sections/Promo.tsx",
          content:
            'import Hero from "./Hero";\nexport default function P() { return <Hero />; }\n',
        },
        { path: "src/components/sections/Hero.tsx", content: HERO },
      ],
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.message).toContain("another section");
  });

  it("refuses to write into a folder that already has files", () => {
    const plan = planPageSectionCopy({
      entryPath: "src/components/sections/Hero.tsx",
      routeSourcePath: "src/routes/index.tsx",
      slotId: "hero",
      files: [
        { path: "src/components/sections/Hero.tsx", content: HERO },
        {
          path: "src/components/page-sections/index/hero/index.tsx",
          content: "",
        },
      ],
    });

    expect(plan.ok).toBe(false);
  });
});

describe("planPageSectionRemoval", () => {
  const owned = "src/components/page-sections/index/hero/index.tsx";

  it("removes the folder the slot owns once nothing imports it", () => {
    expect(
      planPageSectionRemoval({
        componentSourcePath: owned,
        routeSourcePath: "src/routes/index.tsx",
        slotId: "hero",
        files: [
          { path: owned, content: HERO },
          {
            path: "src/components/page-sections/index/hero/Part.tsx",
            content: "",
          },
          {
            path: "src/components/page-sections/index/hero-2/index.tsx",
            content: HERO,
          },
          {
            path: "src/routes/index.tsx",
            content: "export default () => null;",
          },
        ],
      }),
    ).toEqual({
      paths: ["src/components/page-sections/index/hero/Part.tsx", owned],
    });
  });

  it("keeps the folder while another file still imports from it", () => {
    const plan = planPageSectionRemoval({
      componentSourcePath: owned,
      routeSourcePath: "src/routes/index.tsx",
      slotId: "hero",
      files: [
        { path: owned, content: HERO },
        {
          path: "src/routes/about.tsx",
          content:
            'import Hero from "../components/page-sections/index/hero/index";\n',
        },
      ],
    });

    expect(plan.paths).toEqual([]);
    expect(plan.keptReason).toContain("src/routes/about.tsx");
  });

  it("matches an alias import on the whole folder name", () => {
    const files = [
      { path: owned, content: HERO },
      {
        path: "src/routes/about.tsx",
        content:
          'import Hero from "@/components/page-sections/index/hero-2";\n',
      },
    ];
    expect(
      planPageSectionRemoval({
        componentSourcePath: owned,
        routeSourcePath: "src/routes/index.tsx",
        slotId: "hero",
        files,
      }).paths,
    ).toEqual([owned]);
  });

  it("leaves a section rendered from shared source alone", () => {
    expect(
      planPageSectionRemoval({
        componentSourcePath: "src/components/sections/Hero.tsx",
        routeSourcePath: "src/routes/index.tsx",
        slotId: "hero",
        files: [{ path: "src/components/sections/Hero.tsx", content: HERO }],
      }),
    ).toEqual({ paths: [] });
  });
});

describe("planPageSectionRemoval with copies from the first detach", () => {
  const legacy = "src/components/page-sections/products-slug/Hero.tsx";

  it("names routes the way that detach did", () => {
    expect(legacyPageSectionRouteKey("/")).toBe("home");
    expect(legacyPageSectionRouteKey("/products/$slug")).toBe("products-slug");
  });

  it("removes a single-file copy kept under this route's URL key", () => {
    expect(
      planPageSectionRemoval({
        componentSourcePath: legacy,
        routeSourcePath: "src/routes/products/$slug.tsx",
        routePath: "/products/$slug",
        slotId: "hero",
        files: [
          { path: legacy, content: HERO },
          {
            path: "src/routes/products/$slug.tsx",
            content: "export default () => null;",
          },
        ],
      }),
    ).toEqual({ paths: [legacy] });
  });

  it("leaves a copy under another route's key alone", () => {
    expect(
      planPageSectionRemoval({
        componentSourcePath: legacy,
        routeSourcePath: "src/routes/index.tsx",
        routePath: "/",
        slotId: "hero",
        files: [{ path: legacy, content: HERO }],
      }),
    ).toEqual({ paths: [] });
  });

  it("keeps it while an alias import still names it", () => {
    const plan = planPageSectionRemoval({
      componentSourcePath: legacy,
      routeSourcePath: "src/routes/products/$slug.tsx",
      routePath: "/products/$slug",
      slotId: "hero",
      files: [
        { path: legacy, content: HERO },
        {
          path: "src/routes/about.tsx",
          content:
            'import Hero from "@/components/page-sections/products-slug/Hero";\n',
        },
      ],
    });
    expect(plan.paths).toEqual([]);
    expect(plan.keptReason).toContain("src/routes/about.tsx");
  });
});

describe("listSectionTemplateSourcePaths", () => {
  it("includes what a template entry re-exports", () => {
    const paths = listSectionTemplateSourcePaths([
      {
        path: "src/components/sections/Hero.tsx",
        content: 'export { contentFields, default } from "../Hero";\n',
      },
      { path: "src/components/Hero.tsx", content: HERO },
      {
        path: "src/components/ThemeLink.tsx",
        content: "export default () => null;",
      },
    ]);
    expect([...paths].sort()).toEqual([
      "src/components/Hero.tsx",
      "src/components/sections/Hero.tsx",
    ]);
  });

  it("includes every file of a folder template", () => {
    const paths = listSectionTemplateSourcePaths([
      { path: "src/components/sections/featured/index.tsx", content: HERO },
      { path: "src/components/sections/featured/Card.tsx", content: "" },
    ]);
    expect(paths.has("src/components/sections/featured/Card.tsx")).toBe(true);
  });
});
