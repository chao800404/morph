import { describe, expect, it } from "vitest";
import {
  readComponentSourcePaths,
  resolveThemeContentCapabilities,
  resolveThemeContentCapabilitiesFromFiles,
} from "./theme-content-capability-resolver";

const manifest = JSON.stringify({
  sections: {
    hero: { componentRef: "hero.default" },
  },
  components: {
    "hero.default": { source: "src/components/Hero.tsx", sectionType: "hero" },
    "promo.default": { source: "src/components/Promo.tsx" },
    "legacy.default": {
      source: "src/components/Legacy.tsx",
      contentFields: { caption: { type: "text", label: "Caption" } },
    },
  },
});

const heroSource = `
export const contentFields = {
  heading: { type: "text", label: "Heading" },
  body: { type: "textarea" },
} as const;
export default function Hero() { return <section />; }
`;

const files = [
  { path: "morph.theme.json", content: manifest },
  { path: "src/components/Hero.tsx", content: heroSource },
  {
    path: "src/components/Legacy.tsx",
    content: "export default function Legacy() { return <div />; }",
  },
];

describe("readComponentSourcePaths", () => {
  it("maps each component to its implementation file", () => {
    const sources = readComponentSourcePaths(manifest);
    expect(sources.get("hero.default")).toBe("src/components/Hero.tsx");
    expect(sources.get("promo.default")).toBe("src/components/Promo.tsx");
  });

  it("tolerates a malformed manifest without throwing", () => {
    expect(readComponentSourcePaths("{oops").size).toBe(0);
    expect(readComponentSourcePaths(null).size).toBe(0);
  });
});

describe("resolveThemeContentCapabilitiesFromFiles", () => {
  it("exposes fields a component declares in its own source", () => {
    const result = resolveThemeContentCapabilitiesFromFiles(files);
    expect(result.capabilities["hero.default"]).toEqual({
      fields: {
        heading: { type: "text", label: "Heading" },
        body: { type: "textarea" },
      },
    });
  });

  it("keeps manifest-declared fields for components that have not migrated", () => {
    const result = resolveThemeContentCapabilitiesFromFiles(files);
    expect(result.capabilities["legacy.default"]).toEqual({
      fields: { caption: { type: "text", label: "Caption" } },
    });
  });

  it("lets a component's own declaration win over the manifest", () => {
    // The manifest can go stale; the declaration beside the component cannot.
    const result = resolveThemeContentCapabilitiesFromFiles([
      {
        path: "morph.theme.json",
        content: JSON.stringify({
          components: {
            "hero.default": {
              source: "src/components/Hero.tsx",
              contentFields: { outdated: { type: "text" } },
            },
          },
        }),
      },
      { path: "src/components/Hero.tsx", content: heroSource },
    ]);

    expect(Object.keys(result.capabilities["hero.default"]!.fields).sort()).toEqual(
      ["body", "heading"],
    );
  });

  it("keeps the section mapping for a component that declares fields in source", () => {
    // The manifest parse drops this mapping because the component has no
    // manifest-declared fields; losing it would leave the section unbindable.
    const result = resolveThemeContentCapabilitiesFromFiles(files);
    expect(result.sectionComponentRefs.hero).toBe("hero.default");
  });

  it("reports which source a diagnostic came from", () => {
    const result = resolveThemeContentCapabilitiesFromFiles([
      { path: "morph.theme.json", content: manifest },
      {
        path: "src/components/Hero.tsx",
        content: "export const contentFields = { a: { type: computed() } };",
      },
    ]);
    expect(result.diagnostics.join()).toContain("src/components/Hero.tsx");
  });

  it("ignores components whose source is absent from the workspace", () => {
    const result = resolveThemeContentCapabilitiesFromFiles(files);
    expect(result.capabilities["promo.default"]).toBeUndefined();
  });
});

describe("resolveThemeContentCapabilities", () => {
  it("reads only the sources the manifest references", async () => {
    const requested: string[] = [];
    const result = await resolveThemeContentCapabilities({
      manifestContent: manifest,
      readSource: async (path) => {
        requested.push(path);
        return path === "src/components/Hero.tsx" ? heroSource : null;
      },
    });

    expect(requested.sort()).toEqual([
      "src/components/Hero.tsx",
      "src/components/Legacy.tsx",
      "src/components/Promo.tsx",
    ]);
    expect(Object.keys(result.capabilities["hero.default"]!.fields)).toContain(
      "heading",
    );
  });
});

describe("row shapes declared by reference resolve the same on both paths", () => {
  // The editor renders the row controls from one resolver and the server
  // validates the write with the other. When only the file-scanning one
  // expanded `of`, the panel offered controls the server then rejected with
  // "row shape not declared", and no content in that list could be saved.
  const MANIFEST = JSON.stringify({
    components: {
      "principles.default": {
        name: "Principles",
        source: "src/components/Principles.tsx",
        sectionType: "principles",
      },
    },
  });
  const PRINCIPLES = `export const contentFields = {
    label: { type: "text", label: "Section label" },
    items: { type: "array", label: "Principles", of: "./PrincipleCard" },
  } as const;
  export default function Principles() { return <section />; }`;
  const CARD = `export const contentFields = {
    number: { type: "text", label: "Number" },
    title: { type: "text", label: "Title" },
  } as const;
  export default function PrincipleCard() { return <article />; }`;

  const files = [
    { path: "morph.theme.json", content: MANIFEST },
    { path: "src/components/Principles.tsx", content: PRINCIPLES },
    { path: "src/components/PrincipleCard.tsx", content: CARD },
  ];

  const expectedRowFields = {
    number: { type: "text", label: "Number" },
    title: { type: "text", label: "Title" },
  };

  it("expands the reference when scanning the workspace", () => {
    const result = resolveThemeContentCapabilitiesFromFiles(files);
    const items = result.capabilities["principles.default"]?.fields?.items;
    expect(items).toMatchObject({ type: "array", fields: expectedRowFields });
  });

  it("expands the reference when reading sources on demand", async () => {
    const result = await resolveThemeContentCapabilities({
      manifestContent: MANIFEST,
      additionalSourcePaths: [],
      readSource: async (path) =>
        files.find((file) => file.path === path)?.content ?? null,
    });
    const items = result.capabilities["principles.default"]?.fields?.items;
    // The row component is named by the declaration, not the manifest, so this
    // only works if the on-demand path follows the reference.
    expect(items).toMatchObject({ type: "array", fields: expectedRowFields });
  });

  it("reports a reference that resolves to nothing, on both paths", async () => {
    const broken = [
      { path: "morph.theme.json", content: MANIFEST },
      {
        path: "src/components/Principles.tsx",
        content: PRINCIPLES.replace("./PrincipleCard", "./Missing"),
      },
    ];

    const scanned = resolveThemeContentCapabilitiesFromFiles(broken);
    const onDemand = await resolveThemeContentCapabilities({
      manifestContent: MANIFEST,
      additionalSourcePaths: [],
      readSource: async (path) =>
        broken.find((file) => file.path === path)?.content ?? null,
    });

    for (const result of [scanned, onDemand]) {
      expect(result.capabilities["principles.default"]?.fields?.items).toBeUndefined();
      expect(result.diagnostics.join(" ")).toContain("./Missing");
    }
  });
});

describe("a source declaration decides for itself (EDIT-03)", () => {
  const MANIFEST = JSON.stringify({
    components: {
      "promo.default": {
        name: "Promo",
        source: "src/components/Promo.tsx",
        sectionType: "promo",
        contentFields: { outdated: { type: "text", label: "Outdated" } },
      },
    },
  });
  const promo = (body: string) => [
    { path: "morph.theme.json", content: MANIFEST },
    { path: "src/components/Promo.tsx", content: body },
  ];
  const fieldsOf = (files: { path: string; content: string }[]) =>
    Object.keys(
      resolveThemeContentCapabilitiesFromFiles(files).capabilities[
        "promo.default"
      ]?.fields ?? {},
    );

  // Only a module that says nothing lets the manifest answer for it.
  it("falls back to the manifest when nothing is declared", () => {
    expect(fieldsOf(promo("export default function P(){return null}"))).toEqual(
      ["outdated"],
    );
  });

  // The point of the fix: an empty declaration is a statement, not a silence.
  it("lets an empty declaration withdraw a stale manifest field", () => {
    expect(
      fieldsOf(
        promo(
          `export const contentFields = {} as const;
           export default function P(){return null}`,
        ),
      ),
    ).toEqual([]);
  });

  it("replaces the manifest fields rather than merging with them", () => {
    expect(
      fieldsOf(
        promo(
          `export const contentFields = { fresh: { type: "text" } } as const;
           export default function P(){return null}`,
        ),
      ),
    ).toEqual(["fresh"]);
  });

  // A declaration that cannot be read must not leave the manifest in charge:
  // that is fail open, and it is what this used to do.
  it("exposes nothing, with a diagnostic, when a declaration cannot be read", () => {
    const files = promo(
      `export const contentFields = makeFields();
       export default function P(){return null}`,
    );
    const result = resolveThemeContentCapabilitiesFromFiles(files);

    expect(
      Object.keys(result.capabilities["promo.default"]?.fields ?? {}),
    ).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("applies the same rules when sources are read on demand", async () => {
    const source = `export const contentFields = {} as const;
      export default function P(){return null}`;
    const result = await resolveThemeContentCapabilities({
      manifestContent: MANIFEST,
      additionalSourcePaths: [],
      readSource: async (path) =>
        path === "src/components/Promo.tsx" ? source : null,
    });

    // Server-side validation has to reach the same answer as the editor, or a
    // withdrawn field stays writable through the mutation path.
    expect(
      Object.keys(result.capabilities["promo.default"]?.fields ?? {}),
    ).toEqual([]);
  });
});
