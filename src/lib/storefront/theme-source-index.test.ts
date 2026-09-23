import { describe, expect, it } from "vitest";
import { STARTER_THEME_FILES } from "./starter-theme-files";
import {
  deriveThemeSourceIndex,
  THEME_SOURCE_INDEX_DERIVATION_VERSION,
} from "./theme-source-index";

describe("theme source index", () => {
  it("derives a source-only workspace index without a manifest", () => {
    const files = STARTER_THEME_FILES
      .filter((file) => file.path !== "morph.theme.json")
      .map((file) => ({
        path: file.path,
        content: file.content,
        isEntry: file.isEntry,
      }));

    const index = deriveThemeSourceIndex({
      files,
      scope: "workspace",
      sourceGeneration: 12,
    });

    expect(index.derivationVersion).toBe(
      THEME_SOURCE_INDEX_DERIVATION_VERSION,
    );
    expect(index.key).toEqual({
      scope: "workspace",
      sourceGeneration: 12,
      derivationVersion: THEME_SOURCE_INDEX_DERIVATION_VERSION,
    });
    expect(index.status).toBe("complete");
    expect(index.capabilities["src/components/Hero.tsx"]).toBeTruthy();
  });

  it("does not claim a complete index when the scan is bounded", () => {
    const files = Array.from({ length: 201 }, (_, index) => ({
      path: `src/components/Component${index}.tsx`,
      content: `export default function Component${index}() { return null; }`,
    }));
    const index = deriveThemeSourceIndex({
      files,
      scope: "workspace",
      sourceGeneration: 1,
    });

    expect(index.status).toBe("incomplete");
    expect(index.sourceScan.completeness).toBe("incomplete");
    expect(index.sourceScan.scannedSourceCount).toBe(200);
  });
});

