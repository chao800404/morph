import { describe, expect, it } from "vitest";
import {
  addThemeRouteSection,
  bindThemeRouteSection,
  deriveThemeRouteSections,
  listThemeRouteSectionOptions,
  mergeDocumentWithRouteSections,
  removeThemeRouteSection,
  replaceThemeRouteSectionComponent,
  reorderThemeRouteSections,
} from "./theme-route-sections";

const manifest = JSON.stringify({
  components: {
    "hero.default": { source: "src/components/Hero.tsx" },
    "promo.default": { source: "src/components/Promo.tsx" },
  },
  // Deliberately stale. Route imports + content slots are authoritative.
  sections: {
    hero: { componentRef: "promo.default" },
  },
});

const route = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
import Promo from "../components/Promo";

export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <Promo {...content("promo-slot")} />
      <Hero {...content("hero-slot")} />
    </main>
  );
}`;

const files = [
  { path: "morph.theme.json", content: manifest },
  { path: "src/routes/index.tsx", content: route },
  { path: "src/morph/content.ts", content: "export function content() {}" },
  {
    path: "src/components/Hero.tsx",
    content: "export default function Hero() {}",
  },
  {
    path: "src/components/Promo.tsx",
    content: "export default function Promo() {}",
  },
];

describe("route-authored Theme sections", () => {
  it("detaches a uniquely used section by changing only its route import", () => {
    const result = replaceThemeRouteSectionComponent({
      source: route,
      files,
      routeSourcePath: "src/routes/index.tsx",
      slotId: "hero-slot",
      componentSourcePath: "src/components/Hero.tsx",
      nextComponentSourcePath: "src/components/Hero-copy.tsx",
    });

    expect(result).toEqual({
      code: route.replace(
        'from "../components/Hero"',
        'from "../components/Hero-copy"',
      ),
      changed: true,
    });
  });

  it("keeps another instance on the shared component when the route reuses it", () => {
    const repeated = route.replace(
      '      <Hero {...content("hero-slot")} />',
      '      <Hero {...content("hero-slot")} />\n      <Hero {...content("hero-second")} />',
    );
    const result = replaceThemeRouteSectionComponent({
      source: repeated,
      files: files.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: repeated }
          : file,
      ),
      routeSourcePath: "src/routes/index.tsx",
      slotId: "hero-slot",
      componentSourcePath: "src/components/Hero.tsx",
      nextComponentSourcePath: "src/components/Hero-copy.tsx",
    });

    expect(result.changed).toBe(true);
    expect(result.code).toContain(
      'import HeroPageCopy from "../components/Hero-copy";',
    );
    expect(result.code).toContain(
      '<HeroPageCopy {...content("hero-slot")} />',
    );
    expect(result.code).toContain('<Hero {...content("hero-second")} />');
  });

  it("fails closed when the selected section no longer maps to that source", () => {
    const result = replaceThemeRouteSectionComponent({
      source: route,
      files,
      routeSourcePath: "src/routes/index.tsx",
      slotId: "hero-slot",
      componentSourcePath: "src/components/Promo.tsx",
      nextComponentSourcePath: "src/components/Hero-copy.tsx",
    });

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toMatch(/changed since it was selected/);
  });

  it("derives identity, mapping and order from content() call sites", () => {
    const result = deriveThemeRouteSections(files, "src/routes/index.tsx");

    expect(result.diagnostics).toEqual([]);
    expect(
      result.sections.map((section) => ({
        id: section.slotId,
        type: section.sectionType,
        ref: section.componentRef,
        source: section.componentSourcePath,
      })),
    ).toEqual([
      {
        id: "promo-slot",
        type: "promo",
        ref: "promo.default",
        source: "src/components/Promo.tsx",
      },
      {
        id: "hero-slot",
        type: "hero",
        ref: "hero.default",
        source: "src/components/Hero.tsx",
      },
    ]);
  });

  it("creates a virtual Document section for a route slot and drops stale ordering", () => {
    const sections = deriveThemeRouteSections(
      files,
      "src/routes/index.tsx",
    ).sections;
    const document = mergeDocumentWithRouteSections(
      {
        version: 1,
        sections: [
          {
            id: "hero-slot",
            type: "legacy-type",
            componentRef: "legacy.default",
            enabled: true,
            props: { heading: "Stored hero" },
          },
          {
            id: "removed-slot",
            type: "removed",
            enabled: true,
            props: {},
          },
        ],
      },
      sections,
    );

    expect(document.sections).toEqual([
      {
        id: "promo-slot",
        type: "promo",
        componentRef: "promo.default",
        enabled: true,
        props: {},
      },
      {
        id: "hero-slot",
        type: "hero",
        componentRef: "hero.default",
        enabled: true,
        props: { heading: "Stored hero" },
      },
    ]);
  });

  it("reports a direct section-folder component that has no content binding", () => {
    const nativeRoute = `import Promo from "../components/sections/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Promo title={product.name} /></main>;
}`;
    const result = deriveThemeRouteSections(
      [
        {
          path: "src/routes/index.tsx",
          content: nativeRoute,
        },
        {
          path: "src/components/sections/Promo.tsx",
          content: "export default function Promo(){return null;}",
        },
      ],
      "src/routes/index.tsx",
    );

    expect(result.sections).toEqual([]);
    expect(result.unboundSections).toHaveLength(1);
    expect(result.unboundSections[0]).toMatchObject({
      componentName: "Promo",
      componentSourcePath: "src/components/sections/Promo.tsx",
      canBind: true,
    });
  });

  it("reports a page-owned copy that lost its content binding", () => {
    const nativeRoute = `import Hero from "../components/page-sections/index/hero/index";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Hero /></main>;
}`;
    const files = [
      { path: "src/routes/index.tsx", content: nativeRoute },
      {
        path: "src/components/page-sections/index/hero/index.tsx",
        content: "export default function Hero(){return null;}",
      },
    ];
    const result = deriveThemeRouteSections(files, "src/routes/index.tsx");

    expect(result.unboundSections).toHaveLength(1);
    expect(result.unboundSections[0]).toMatchObject({
      componentName: "Hero",
      componentSourcePath: "src/components/page-sections/index/hero/index.tsx",
      canBind: true,
    });
    // Bindable, but never something Add section offers.
    expect(listThemeRouteSectionOptions(files)).toEqual([]);
  });

  it("does not offer a repeated section position for automatic binding", () => {
    const nativeRoute = `import Promo from "../components/sections/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main>{items.map((item) => <Promo key={item.id} />)}</main>;
}`;
    const result = deriveThemeRouteSections(
      [
        { path: "src/routes/index.tsx", content: nativeRoute },
        {
          path: "src/components/sections/Promo.tsx",
          content: "export default function Promo(){return null;}",
        },
      ],
      "src/routes/index.tsx",
    );

    expect(result.unboundSections[0]?.canBind).toBe(false);
    expect(result.unboundSections[0]?.diagnostic).toContain(
      "conditional or repeated",
    );
  });

  it("binds before explicit props so source-owned values keep precedence", () => {
    const nativeRoute = `import Promo from "../components/sections/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Promo title={product.name} /></main>;
}`;
    const files = [
      { path: "src/routes/index.tsx", content: nativeRoute },
      {
        path: "src/components/sections/Promo.tsx",
        content: "export default function Promo(){return null;}",
      },
    ];
    const candidate = deriveThemeRouteSections(files, "src/routes/index.tsx")
      .unboundSections[0]!;
    const result = bindThemeRouteSection({
      source: nativeRoute,
      files,
      routeSourcePath: "src/routes/index.tsx",
      candidate,
      slotId: "promo",
    });

    expect(result.changed).toBe(true);
    expect(result.code).toContain(
      '<Promo {...content("promo")} title={product.name} />',
    );
    expect(result.code).toContain(
      'import { content } from "../morph/content";',
    );
  });

  it("refuses a stale binding candidate instead of patching another JSX node", () => {
    const nativeRoute = `import Promo from "../components/sections/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Promo title={product.name} /></main>;
}`;
    const files = [
      { path: "src/routes/index.tsx", content: nativeRoute },
      {
        path: "src/components/sections/Promo.tsx",
        content: "export default function Promo(){return null;}",
      },
    ];
    const candidate = deriveThemeRouteSections(files, "src/routes/index.tsx")
      .unboundSections[0]!;
    const changedRoute = nativeRoute.replace(
      "<Promo title={product.name} />",
      "<Hero title={product.name} />",
    );
    const result = bindThemeRouteSection({
      source: changedRoute,
      files: files.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: changedRoute }
          : file,
      ),
      routeSourcePath: "src/routes/index.tsx",
      candidate,
      slotId: "promo",
    });

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toContain("source changed");
    expect(result.code).toBe(changedRoute);
    expect(result.code).not.toContain('content("promo")');
  });

  it("refuses a same-length rename that leaves every source offset unchanged", () => {
    // The stale case above shortens the element, so every later offset moves
    // and a guard that only compared source positions would reject it too and
    // look correct. Swapping in an equally long name and an equally long import
    // path holds sourceStart and sourceEnd fixed, leaving component identity as
    // the only thing that changed — which is the part this guard exists for.
    //
    // The import binding has to move with the JSX, or the element stops
    // resolving to an imported component and the derivation reports no
    // candidate at all. That version of the test still passes, but it passes
    // because the element became unreachable rather than because the guard
    // compared identities — so it would keep passing with the guard deleted.
    const nativeRoute = `import Promo from "../components/sections/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Promo title={product.name} /></main>;
}`;
    const files = [
      { path: "src/routes/index.tsx", content: nativeRoute },
      {
        path: "src/components/sections/Promo.tsx",
        content: "export default function Promo(){return null;}",
      },
      {
        path: "src/components/sections/Other.tsx",
        content: "export default function Other(){return null;}",
      },
    ];
    const candidate = deriveThemeRouteSections(files, "src/routes/index.tsx")
      .unboundSections[0]!;
    const renamed = nativeRoute
      .replace("import Promo from", "import Other from")
      .replace("sections/Promo", "sections/Other")
      .replace("<Promo ", "<Other ");
    expect(renamed.length).toBe(nativeRoute.length);
    // The rename is only meaningful if it still yields the same position, so
    // prove the candidate survived it before asserting the refusal.
    const renamedCandidate = deriveThemeRouteSections(
      files.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: renamed }
          : file,
      ),
      "src/routes/index.tsx",
    ).unboundSections[0]!;
    expect(renamedCandidate.sourceStart).toBe(candidate.sourceStart);
    expect(renamedCandidate.sourceEnd).toBe(candidate.sourceEnd);
    expect(renamedCandidate.componentName).toBe("Other");

    const result = bindThemeRouteSection({
      source: renamed,
      files: files.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: renamed }
          : file,
      ),
      routeSourcePath: "src/routes/index.tsx",
      candidate,
      slotId: "promo",
    });

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toContain("source changed");
    expect(result.code).toBe(renamed);
    expect(result.code).not.toContain('content("promo")');
  });

  it("refuses to bind the same section twice", () => {
    const nativeRoute = `import Promo from "../components/sections/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return <main><Promo title={product.name} /></main>;
}`;
    const files = [
      { path: "src/routes/index.tsx", content: nativeRoute },
      {
        path: "src/components/sections/Promo.tsx",
        content: "export default function Promo(){return null;}",
      },
    ];
    const candidate = deriveThemeRouteSections(files, "src/routes/index.tsx")
      .unboundSections[0]!;
    const bind = (source: string) =>
      bindThemeRouteSection({
        source,
        files: files.map((file) =>
          file.path === "src/routes/index.tsx"
            ? { ...file, content: source }
            : file,
        ),
        routeSourcePath: "src/routes/index.tsx",
        candidate,
        slotId: "promo",
      });

    const first = bind(nativeRoute);
    expect(first.changed).toBe(true);
    expect(first.code.match(/content\("promo"\)/g)).toHaveLength(1);

    const second = bind(first.code);
    expect(second.changed).toBe(false);
    expect(second.code).toBe(first.code);
  });

  it("reorders the route JSX instead of the Document", () => {
    const result = reorderThemeRouteSections(
      route,
      files,
      "src/routes/index.tsx",
      ["hero-slot", "promo-slot"],
    );

    expect(result.changed).toBe(true);
    expect(result.diagnostic).toBeUndefined();
    expect(result.code.indexOf("hero-slot")).toBeLessThan(
      result.code.indexOf("promo-slot"),
    );
    expect(
      deriveThemeRouteSections(
        files.map((file) =>
          file.path === "src/routes/index.tsx"
            ? { ...file, content: result.code }
            : file,
        ),
        "src/routes/index.tsx",
      ).sections.map((section) => section.slotId),
    ).toEqual(["hero-slot", "promo-slot"]);
  });

  it("adds a selected component as an imported content slot", () => {
    const heroOnly = route.replace(
      '      <Promo {...content("promo-slot")} />\n',
      "",
    );
    const addableFiles = [
      ...files,
      {
        path: "src/components/sections/Banner.tsx",
        content: "export default function Banner() {}",
      },
    ];
    const option = listThemeRouteSectionOptions(addableFiles).find(
      (candidate) =>
        candidate.componentSourcePath ===
        "src/components/sections/Banner.tsx",
    )!;
    const result = addThemeRouteSection({
      source: heroOnly,
      files: addableFiles.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: heroOnly }
          : file,
      ),
      routeSourcePath: "src/routes/index.tsx",
      option,
      slotId: "promo",
    });

    expect(result.changed).toBe(true);
    expect(result.diagnostic).toBeUndefined();
    expect(result.code).toContain('<Banner {...content("promo")} />');
  });

  it("removes one route-owned section without leaving a blank authored row", () => {
    const result = removeThemeRouteSection(
      route,
      files,
      "src/routes/index.tsx",
      "promo-slot",
    );

    expect(result.changed).toBe(true);
    expect(result.diagnostic).toBeUndefined();
    expect(result.code).not.toContain('content("promo-slot")');
    expect(result.code).not.toContain(
      'import Promo from "../components/Promo"',
    );
    expect(result.code).toContain('      <Hero {...content("hero-slot")} />');
    expect(result.code).not.toContain("\n\n      <Hero");

    const empty = removeThemeRouteSection(
      result.code,
      files.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: result.code }
          : file,
      ),
      "src/routes/index.tsx",
      "hero-slot",
    );
    expect(empty.changed).toBe(true);
    expect(empty.code).not.toContain('import Hero from "../components/Hero"');
    expect(empty.code).toContain('import { content } from "../morph/content"');

    const derivedEmpty = deriveThemeRouteSections(
      files.map((file) =>
        file.path === "src/routes/index.tsx"
          ? { ...file, content: empty.code }
          : file,
      ),
      "src/routes/index.tsx",
    );
    expect(derivedEmpty.sections).toEqual([]);
    expect(derivedEmpty.hasContentImport).toBe(true);
    expect(
      mergeDocumentWithRouteSections(
        {
          version: 1,
          sections: [
            { id: "hero-slot", type: "hero", enabled: true, props: {} },
          ],
        },
        derivedEmpty.sections,
        { routeOwnsStructure: derivedEmpty.hasContentImport },
      ).sections,
    ).toEqual([]);
  });
});

describe("addable section options", () => {
  const listFiles = [
    {
      path: "morph.theme.json",
      content: JSON.stringify({ components: {}, sections: {} }),
    },
    {
      path: "src/components/Principles.tsx",
      content: `export const contentFields = {
  items: { type: "array", of: "./PrincipleCard" },
};
export default function Principles() { return null; }`,
    },
    {
      path: "src/components/PrincipleCard.tsx",
      content: `export const contentFields = {
  title: { type: "text" },
};
export default function PrincipleCard() { return null; }`,
    },
  ];

  it("does not offer a manifest-only component", () => {
    const options = listThemeRouteSectionOptions(listFiles);

    expect(options).toEqual([]);
  });

  it("does not offer a contentFields-only component outside the section folder", () => {
    // A row component is given its identity and values by the list that
    // renders it, and a content declaration alone is not an Add section
    // registration. Both cases stay out of the source folder library.
    const options = listThemeRouteSectionOptions([
      listFiles[0]!,
      {
        path: "src/components/Banner.tsx",
        content: `export const contentFields = { heading: { type: "text" } };
export default function Banner() { return null; }`,
      },
    ]);

    expect(options).toEqual([]);
  });

  it("does not offer a component that only happens to be imported by another", () => {
    const options = listThemeRouteSectionOptions([
      listFiles[0]!,
      {
        path: "src/components/Banner.tsx",
        content: `export const contentFields = { heading: { type: "text" } };
export default function Banner() { return null; }`,
      },
    ]);

    expect(options).toEqual([]);
  });

  it("offers a component that only follows the section folder convention", () => {
    // No manifest entry and no `contentFields`: living in the folder is the
    // whole declaration, which is what makes a section registration-free.
    const options = listThemeRouteSectionOptions([
      listFiles[0]!,
      {
        path: "src/components/sections/Testimonials.tsx",
        content: `export default function Testimonials() { return null; }`,
      },
    ]);

    expect(options.map((option) => option.componentName)).toEqual([
      "Testimonials",
    ]);
    expect(options[0]?.componentSourcePath).toBe(
      "src/components/sections/Testimonials.tsx",
    );
  });

  it("names a folder entry after its folder rather than after `index`", () => {
    const options = listThemeRouteSectionOptions([
      listFiles[0]!,
      {
        path: "src/components/sections/featured-collection/index.tsx",
        content: `export default function FeaturedCollection() { return null; }`,
      },
    ]);

    expect(options.map((option) => option.componentName)).toEqual([
      "FeaturedCollection",
    ]);
    expect(options[0]?.sectionType).toBe("featured-collection");
  });

  it("keeps the folder path as identity even when the manifest also mentions it", () => {
    // The manifest can continue describing an existing component for legacy
    // content resolution, but it cannot rename or register an Add section.
    const options = listThemeRouteSectionOptions([
      {
        path: "morph.theme.json",
        content: JSON.stringify({
          components: {
            "testimonials.default": {
              source: "src/components/sections/Testimonials.tsx",
            },
          },
        }),
      },
      {
        path: "src/components/sections/Testimonials.tsx",
        content: `export default function Testimonials() { return null; }`,
      },
    ]);

    expect(options.map((option) => option.componentRef)).toEqual([
      "src/components/sections/Testimonials.tsx",
    ]);
  });

  it("omits a row component that lives in the section folder", () => {
    // The folder decides what is a candidate, not what may stand alone: the
    // row rule still applies, or a list's row would be addable as a section.
    const options = listThemeRouteSectionOptions([
      listFiles[0]!,
      {
        path: "src/components/sections/Principles.tsx",
        content: `export const contentFields = {
  items: { type: "array", of: "./PrincipleCard" },
};
export default function Principles() { return null; }`,
      },
      {
        path: "src/components/sections/PrincipleCard.tsx",
        content: `export const contentFields = {
  title: { type: "text" },
};
export default function PrincipleCard() { return null; }`,
      },
    ]);

    expect(options.map((option) => option.componentName)).toEqual([
      "Principles",
    ]);
  });
});

describe("routes that have not adopted slots", () => {
  it("keeps the stored sections when the route declares none", () => {
    // Adopting route-owned structure is per route. Returning nothing here
    // would strip every editable section from a Theme whose routes render
    // components directly, which is every Theme before it migrates.
    const stored = {
      version: 1 as const,
      sections: [
        {
          id: "starter-hero",
          type: "hero",
          enabled: true,
          props: { heading: "Stored" },
        },
      ],
    };

    expect(mergeDocumentWithRouteSections(stored as never, [])).toEqual(stored);
  });

  it("lets the route own the structure as soon as it declares one slot", () => {
    const stored = {
      version: 1 as const,
      sections: [
        {
          id: "starter-hero",
          type: "hero",
          enabled: true,
          props: { heading: "Stored" },
        },
        { id: "gone", type: "promo", enabled: true, props: {} },
      ],
    };
    const merged: any = mergeDocumentWithRouteSections(stored as never, [
      {
        slotId: "starter-hero",
        sectionType: "hero",
        componentRef: "hero.default",
        componentName: "Hero",
        componentSourcePath: "src/components/Hero.tsx",
        routeSourcePath: "src/routes/index.tsx",
      },
    ]);

    // The stored values survive; the section the route no longer declares does not.
    expect(merged.sections.map((s: any) => s.id)).toEqual(["starter-hero"]);
    expect(merged.sections[0].props).toEqual({ heading: "Stored" });
  });
});

describe("reorder validation", () => {
  const files = [
    {
      path: "morph.theme.json",
      content: JSON.stringify({ components: {}, sections: {} }),
    },
    {
      path: "src/components/Hero.tsx",
      content: "export default function Hero(){return null;}",
    },
    {
      path: "src/components/Promo.tsx",
      content: "export default function Promo(){return null;}",
    },
  ];
  const route = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
import Promo from "../components/Promo";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <Hero {...content("a")} />
      <Promo {...content("b")} />
    </main>
  );
}`;
  const all = [...files, { path: "src/routes/index.tsx", content: route }];

  it("refuses an order that names one section twice", () => {
    // It passes every other check — same length, every id known, no duplicate
    // in the source — and would write the displaced section out of the route.
    const result = reorderThemeRouteSections(
      route,
      all,
      "src/routes/index.tsx",
      ["a", "a"],
    );

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toBeDefined();
    expect(result.code).toBe(route);
  });

  it("reorders siblings without losing either", () => {
    const result = reorderThemeRouteSections(
      route,
      all,
      "src/routes/index.tsx",
      ["b", "a"],
    );

    expect(result.changed).toBe(true);
    expect(
      [...result.code.matchAll(/content\("(\w)"\)/g)].map((m) => m[1]),
    ).toEqual(["b", "a"]);
  });

  it("refuses to remove a section when the route source mapping is invalid", () => {
    const result = removeThemeRouteSection(
      route,
      all,
      "src/routes/index.tsx",
      "missing",
    );

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toBeDefined();
    expect(result.code).toBe(route);
  });
});

describe("added section formatting", () => {
  const addFiles = [
    {
      path: "morph.theme.json",
      content: JSON.stringify({ components: {}, sections: {} }),
    },
    {
      path: "src/morph/content.ts",
      content: "export function content(){return {};}",
    },
    {
      path: "src/components/Promo.tsx",
      content: "export default function Promo(){return null;}",
    },
  ];
  const bare = `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/")({ component: Home });
function Home() {
  return (
    <main>
      <p>existing</p>
    </main>
  );
}`;

  it("writes the new element on its own line, correctly indented", () => {
    // This is source the author reads and edits next; an element sharing a
    // line with the closing tag is a defect, not a cosmetic detail.
    const result = addThemeRouteSection({
      source: bare,
      files: [...addFiles, { path: "src/routes/index.tsx", content: bare }],
      routeSourcePath: "src/routes/index.tsx",
      option: {
        componentRef: "src/components/Promo.tsx",
        sectionType: "promo",
        componentName: "Promo",
        componentSourcePath: "src/components/Promo.tsx",
      },
      slotId: "promo-1",
    });

    expect(result.changed).toBe(true);
    expect(result.code).toContain(
      '      <p>existing</p>\n      <Promo {...content("promo-1")} />\n    </main>',
    );
    // The failure this guards against is the element and the closing tag
    // ending up on one line, not whitespace between them.
    expect(result.code).not.toMatch(/\/>[ \t]*<\/main>/);
  });

  it("produces a route the derivation can read back", () => {
    const result = addThemeRouteSection({
      source: bare,
      files: [...addFiles, { path: "src/routes/index.tsx", content: bare }],
      routeSourcePath: "src/routes/index.tsx",
      option: {
        componentRef: "src/components/Promo.tsx",
        sectionType: "promo",
        componentName: "Promo",
        componentSourcePath: "src/components/Promo.tsx",
      },
      slotId: "promo-1",
    });
    const derived = deriveThemeRouteSections(
      [...addFiles, { path: "src/routes/index.tsx", content: result.code }],
      "src/routes/index.tsx",
    );

    expect(derived.diagnostics).toEqual([]);
    expect(derived.sections.map((section) => section.slotId)).toEqual([
      "promo-1",
    ]);
  });
});
