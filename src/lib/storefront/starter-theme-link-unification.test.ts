// @vitest-environment node
/**
 * What a store gets, whether it is created today or was created before links
 * were unified.
 *
 * A starter that drifts is worse than one that is merely old: every new store
 * is born needing the migration that was just finished, and the byte-exact
 * upgrade catalog is the only route by which an existing workspace can ever be
 * corrected — a generation missing from it is stranded for good.
 */
import { describe, expect, it } from "vitest";
import {
  createStarterThemeWorkspaceUpgrade,
  STARTER_THEME_FILES,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_URL_FIELD_SOURCE,
  LEGACY_STARTER_THEME_FOOTER_MARKED_LINK_SOURCE,
  LEGACY_STARTER_THEME_IMAGE_WITH_TEXT_URL_FIELD_SOURCE,
  LEGACY_STARTER_THEME_LINK_MODULE_SOURCE,
} from "./starter-theme-v3-files";
import { LEGACY_STARTER_THEME_HERO_URL_FIELD_SOURCE } from "./starter-theme-files";

const componentFiles = STARTER_THEME_FILES.filter((file) =>
  file.path.startsWith("src/components/"),
);

describe("the starter a new store is created from", () => {
  it("declares every destination as one link field", () => {
    expect(componentFiles.length).toBeGreaterThan(0);
    for (const file of componentFiles) {
      expect(
        file.content,
        `${file.path} still carries actionHref`,
      ).not.toContain("actionHref");
      // A `url` field holds an address and nothing else, so a repeated row
      // using one cannot carry its own target or rel.
      expect(
        file.content,
        `${file.path} still declares a url destination`,
      ).not.toMatch(/(href|link|action):\s*\{\s*type:\s*"url"/);
    }
  });

  it("renders every destination through the shared link component", () => {
    for (const file of componentFiles) {
      if (!file.content.includes('type: "link"')) continue;
      expect(
        file.content,
        `${file.path} declares a link it does not render`,
      ).toContain("ThemeLink");
    }
  });
});

describe("a workspace created before links were unified", () => {
  const upgradeFor = (path: string, content: string) => {
    const upgrades = createStarterThemeWorkspaceUpgrade([
      { path, content, version: 1 },
    ] as never);
    return upgrades.find((file) => file.path === path);
  };

  const strandedCases: ReadonlyArray<readonly [string, string]> = [
    ["src/components/Hero.tsx", LEGACY_STARTER_THEME_HERO_URL_FIELD_SOURCE],
    [
      "src/components/CategoryShowcase.tsx",
      LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_URL_FIELD_SOURCE,
    ],
    [
      "src/components/ImageWithText.tsx",
      LEGACY_STARTER_THEME_IMAGE_WITH_TEXT_URL_FIELD_SOURCE,
    ],
    [
      "src/components/Footer.tsx",
      LEGACY_STARTER_THEME_FOOTER_MARKED_LINK_SOURCE,
    ],
    ["src/morph/link.tsx", LEGACY_STARTER_THEME_LINK_MODULE_SOURCE],
  ];

  for (const [path, legacy] of strandedCases) {
    it(`is offered the current ${path.split("/").pop()}`, () => {
      const upgrade = upgradeFor(path, legacy);
      expect(upgrade, `${path} has no route to the current file`).toBeDefined();
      expect(upgrade!.content).not.toBe(legacy);
      expect(upgrade!.content).not.toContain("actionHref");
    });
  }

  it("leaves a file the store has edited alone", () => {
    // Matching is byte-exact precisely so an authored change is never
    // overwritten by an upgrade the author did not ask for.
    const edited = LEGACY_STARTER_THEME_HERO_URL_FIELD_SOURCE.replace(
      "Explore the collection",
      "Shop the drop",
    );
    expect(upgradeFor("src/components/Hero.tsx", edited)).toBeUndefined();
  });
});
