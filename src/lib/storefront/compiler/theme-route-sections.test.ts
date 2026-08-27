import { describe, expect, it } from "vitest";
import {
  addThemeRouteSection,
  deriveThemeRouteSections,
  listThemeRouteSectionOptions,
  mergeDocumentWithRouteSections,
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
  { path: "src/components/Hero.tsx", content: "export default function Hero() {}" },
  { path: "src/components/Promo.tsx", content: "export default function Promo() {}" },
];

describe("route-authored Theme sections", () => {
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
    const option = listThemeRouteSectionOptions(files).find(
      (candidate) => candidate.componentRef === "promo.default",
    )!;
    const result = addThemeRouteSection({
      source: heroOnly,
      files: files.map((file) =>
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
    expect(result.code).toContain('<Promo {...content("promo")} />');
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

  it("omits a component that exists only to render one row", () => {
    // A row component is given its identity and values by the list that
    // renders it, so a standalone section of one could never be supplied what
    // it needs.
    const options = listThemeRouteSectionOptions(listFiles);

    expect(options.map((option) => option.componentName)).toEqual([
      "Principles",
    ]);
  });

  it("still offers a component that only happens to be imported by another", () => {
    const options = listThemeRouteSectionOptions([
      listFiles[0]!,
      {
        path: "src/components/Banner.tsx",
        content: `export const contentFields = { heading: { type: "text" } };
export default function Banner() { return null; }`,
      },
    ]);

    expect(options.map((option) => option.componentName)).toEqual(["Banner"]);
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
        { id: "starter-hero", type: "hero", enabled: true, props: { heading: "Stored" } },
      ],
    };

    expect(mergeDocumentWithRouteSections(stored as never, [])).toEqual(stored);
  });

  it("lets the route own the structure as soon as it declares one slot", () => {
    const stored = {
      version: 1 as const,
      sections: [
        { id: "starter-hero", type: "hero", enabled: true, props: { heading: "Stored" } },
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
    { path: "morph.theme.json", content: JSON.stringify({ components: {}, sections: {} }) },
    { path: "src/components/Hero.tsx", content: "export default function Hero(){return null;}" },
    { path: "src/components/Promo.tsx", content: "export default function Promo(){return null;}" },
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
    const result = reorderThemeRouteSections(route, all, "src/routes/index.tsx", [
      "a",
      "a",
    ]);

    expect(result.changed).toBe(false);
    expect(result.diagnostic).toBeDefined();
    expect(result.code).toBe(route);
  });

  it("reorders siblings without losing either", () => {
    const result = reorderThemeRouteSections(route, all, "src/routes/index.tsx", [
      "b",
      "a",
    ]);

    expect(result.changed).toBe(true);
    expect(
      [...result.code.matchAll(/content\("(\w)"\)/g)].map((m) => m[1]),
    ).toEqual(["b", "a"]);
  });
});

describe("added section formatting", () => {
  const addFiles = [
    { path: "morph.theme.json", content: JSON.stringify({ components: {}, sections: {} }) },
    { path: "src/morph/content.ts", content: "export function content(){return {};}" },
    { path: "src/components/Promo.tsx", content: "export default function Promo(){return null;}" },
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
