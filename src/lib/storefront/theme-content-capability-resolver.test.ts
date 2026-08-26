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
