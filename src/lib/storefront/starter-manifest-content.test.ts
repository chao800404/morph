import { describe, expect, it } from "vitest";
import {
  STARTER_THEME_FILES,
  createStarterThemeWorkspaceUpgrade,
} from "./starter-theme-files";
import { parseColocatedContentFields } from "./ast/theme-content-fields-source";
import { resolveThemeContentCapabilitiesFromFiles } from "./theme-content-capability-resolver";

const manifestFile = STARTER_THEME_FILES.find(
  (file) => file.path === "morph.theme.json",
)!;
const manifest = JSON.parse(manifestFile.content);

describe("starter content declarations", () => {
  it("keeps source declarations authoritative without duplicate manifest fields", () => {
    const { capabilities } =
      resolveThemeContentCapabilitiesFromFiles(STARTER_THEME_FILES);
    for (const [ref, config] of Object.entries(manifest.components) as [
      string,
      { source: string; contentFields?: unknown },
    ][]) {
      const source = STARTER_THEME_FILES.find(
        (file) => file.path === config.source,
      );
      if (!source) continue;
      const parsed = parseColocatedContentFields(source.content);
      if (parsed.declaration !== "valid") continue;
      expect(config.contentFields, ref).toBeUndefined();
      expect(capabilities[config.source]?.fields, ref).toEqual(parsed.fields);
    }
    expect(capabilities["hero.default"].fields.action.type).toBe("link");
    expect(capabilities["hero.default"].fields.actionHref).toBeUndefined();
  });

  it("cleans stale fallback fields with OCC metadata, preserves authored source, and is idempotent", () => {
    const old = structuredClone(manifest);
    old.components["hero.default"].contentFields = {
      actionHref: { type: "url" },
    };
    old.components["hero.default"].description = "Keep metadata";
    const existing = STARTER_THEME_FILES.map((file) => ({
      ...file,
      id: file.path,
      version: 7,
      content:
        file.path === "morph.theme.json" ? JSON.stringify(old) : file.content,
    }));
    const patch = createStarterThemeWorkspaceUpgrade(existing).find(
      (file) => file.path === "morph.theme.json",
    )!;
    expect(patch.expectedVersion).toBe(7);
    expect(patch.expectedFileId).toBe("morph.theme.json");
    const next = JSON.parse(patch.content);
    expect(next.components["hero.default"].contentFields).toBeUndefined();
    expect(next.components["hero.default"].description).toBe("Keep metadata");
    const updated = existing.map((file) =>
      file.path === patch.path ? { ...file, content: patch.content } : file,
    );
    expect(
      createStarterThemeWorkspaceUpgrade(updated).find(
        (file) => file.path === patch.path,
      ),
    ).toBeUndefined();
    const authored = existing.map((file) =>
      file.path === "src/components/Hero.tsx"
        ? { ...file, content: file.content + "\n// Authored" }
        : file,
    );
    expect(
      createStarterThemeWorkspaceUpgrade(authored).find(
        (file) => file.path === patch.path,
      ),
    ).toBeUndefined();
  });
});
