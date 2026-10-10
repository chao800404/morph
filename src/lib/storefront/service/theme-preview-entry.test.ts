// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { StorefrontThemeWorkspaceEntryDTO } from "@/lib/storefront/dto/storefront-theme-file.dto";
import { resolveThemeFramework } from "../theme-framework";
import { astroThemeFiles } from "../theme-framework/astro-native-prerender.fixtures";
import {
  themePreviewEntry,
  themePreviewWorkspaceInput,
} from "./theme-preview-workspace-files";

/**
 * Whether a Live Preview needs the Theme's entry file is its framework's to
 * say. A Start Theme is started from it and refused without one; an Astro
 * site is started from its config, and marks no file as an entry at all.
 */

const source = (
  path: string,
  content: string,
  isEntry = false,
): StorefrontThemeWorkspaceEntryDTO => ({
  id: path,
  storefrontId: "s",
  themeId: "t",
  path,
  content,
  mimeType: "text/plain",
  isEntry,
  version: 1,
  createdAt: "now",
  updatedAt: "now",
});

const noRead = async (): Promise<Uint8Array> => {
  throw new Error("no binary file is read here");
};

/** An Astro project as it is saved: no file is its entry. */
const astroSite = () =>
  themePreviewWorkspaceInput(
    astroThemeFiles().map((file) => source(file.path, file.content)),
    noRead,
  );

describe("the entry a Live Preview starts from", () => {
  it("is not needed by an Astro site, which is planned without one", () => {
    const workspace = astroSite();
    expect(workspace.entry).toBeNull();
    const astro = resolveThemeFramework("astro", { astroThemes: true });

    expect(themePreviewEntry(workspace.entry, astro)).toEqual({
      ok: true,
      entry: null,
    });
    // The step after the check: the workspace the dev server runs in.
    if (!astro.ok) throw new Error(astro.message);
    const plan = astro.framework.planWorkspace({
      files: workspace.files,
      entry: null,
      buildId: "preview-1",
      approvedDependencies: new Set(),
      mode: "preview-server",
    });
    expect(plan.ok, plan.ok ? "" : plan.errorMessage).toBe(true);
  });

  it("is still required of a Start Theme, and refused when it has none", () => {
    const workspace = themePreviewWorkspaceInput(
      [source("src/routes/index.tsx", "export default 1;")],
      noRead,
    );
    const start = resolveThemeFramework(null, { astroThemes: true });

    expect(themePreviewEntry(workspace.entry, start)).toEqual({ ok: false });
    // Nor does Start's planner start without one, whoever asks it.
    if (!start.ok) throw new Error(start.message);
    expect(
      start.framework.planWorkspace({
        files: workspace.files,
        entry: null,
        buildId: "preview-1",
        approvedDependencies: new Set(),
        mode: "preview-server",
      }),
    ).toMatchObject({
      ok: false,
      errorMessage: expect.stringContaining("THEME_ENTRY_MISSING"),
    });
  });

  it("is passed through where the Theme has one", () => {
    const workspace = themePreviewWorkspaceInput(
      [source("src/routes/index.tsx", "export default 1;", true)],
      noRead,
    );
    expect(
      themePreviewEntry(
        workspace.entry,
        resolveThemeFramework("tanstack-start", { astroThemes: true }),
      ),
    ).toEqual({ ok: true, entry: "src/routes/index.tsx" });
  });

  it("keeps the requirement for a framework this server cannot serve", () => {
    const workspace = astroSite();
    // Astro where the server has not turned it on, and a value that names
    // no framework: neither decides that the check does not apply.
    expect(
      themePreviewEntry(
        workspace.entry,
        resolveThemeFramework("astro", { astroThemes: false }),
      ),
    ).toEqual({ ok: false });
    expect(
      themePreviewEntry(
        workspace.entry,
        resolveThemeFramework("not-a-framework", { astroThemes: true }),
      ),
    ).toEqual({ ok: false });
  });
});
