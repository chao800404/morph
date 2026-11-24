import { describe, expect, it } from "vitest";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "./default-storefront-document";
import { starterThemeWorkspaceFiles } from "./starter-theme-files";
import {
  STARTER_UPGRADE_START_PREVIEW_REQUIRED_MESSAGE,
  sourceRequiresStartPreview,
  starterPlanFilesRequiringStartPreview,
  starterStartPreviewRequirement,
} from "./starter-upgrade-start-preview";
import { defaultPreviewRuntimeForNewTheme } from "./theme-preview-runtime";

const ROUTE = "src/routes/index.tsx";

describe("which source needs the full Start preview", () => {
  it("is a module that imports the hosted SDK entry", () => {
    expect(
      sourceRequiresStartPreview(
        ROUTE,
        'import { morph } from "@morph/sdk/start";\nexport const x = morph;\n',
      ),
    ).toBe(true);
    expect(
      sourceRequiresStartPreview(ROUTE, 'import "@morph/sdk/start";\n'),
    ).toBe(true);
  });

  it("is a module that imports createServerFn as a value", () => {
    expect(
      sourceRequiresStartPreview(
        ROUTE,
        'import { createServerFn } from "@tanstack/react-start";\n',
      ),
    ).toBe(true);
    expect(
      sourceRequiresStartPreview(
        ROUTE,
        'import { createServerFn as fn } from "@tanstack/react-start";\n',
      ),
    ).toBe(true);
    expect(
      sourceRequiresStartPreview(
        ROUTE,
        'import * as start from "@tanstack/react-start";\n',
      ),
    ).toBe(true);
  });

  it("is not the Starter's isomorphic content module, nor a type-only import", () => {
    expect(
      sourceRequiresStartPreview(
        "src/morph/content.ts",
        'import { createIsomorphicFn } from "@tanstack/react-start";\nimport { getRequest } from "@tanstack/react-start/server";\n',
      ),
    ).toBe(false);
    expect(
      sourceRequiresStartPreview(
        ROUTE,
        'import type { MorphPage } from "@morph/sdk/start";\nimport { type createServerFn } from "@tanstack/react-start";\n',
      ),
    ).toBe(false);
  });

  it("ignores files that are not scripts and refuses to guess about one it cannot parse", () => {
    expect(
      sourceRequiresStartPreview(
        "src/styles/global.css",
        '@import "@morph/sdk/start";',
      ),
    ).toBe(false);
    expect(sourceRequiresStartPreview(ROUTE, "export const = ;")).toBe(true);
  });

  it("lists each planned path once, in path order", () => {
    const serverFn = 'import { createServerFn } from "@tanstack/react-start";\n';
    expect(
      starterPlanFilesRequiringStartPreview([
        { path: "src/routes/b.tsx", content: serverFn },
        { path: "src/components/Hero.tsx", content: "export default 1;\n" },
        { path: "src/routes/a.tsx", content: serverFn },
      ]),
    ).toEqual(["src/routes/a.tsx", "src/routes/b.tsx"]);
  });
});

describe("whether a Theme may take Start-only Starter files", () => {
  it("is refused without a recorded start, a deployment default included", () => {
    for (const recorded of [null, "client"] as const) {
      expect(starterStartPreviewRequirement([ROUTE], recorded)).toEqual({
        paths: [ROUTE],
        satisfied: false,
        reason: STARTER_UPGRADE_START_PREVIEW_REQUIRED_MESSAGE,
      });
    }
  });

  it("is allowed once the Theme records start, and always when nothing needs it", () => {
    expect(starterStartPreviewRequirement([ROUTE], "start")).toMatchObject({
      satisfied: true,
      reason: null,
    });
    expect(starterStartPreviewRequirement([], "client")).toMatchObject({
      satisfied: true,
      reason: null,
    });
  });
});

describe("the current Starter", () => {
  // The version bump and the route change ship together: a new Theme records
  // the full Start preview exactly when the Starter it gets needs it.
  it("records start for a new Theme exactly when its files need it", () => {
    const needsStart =
      starterPlanFilesRequiringStartPreview(starterThemeWorkspaceFiles())
        .length > 0;
    expect(
      defaultPreviewRuntimeForNewTheme(STOREFRONT_STARTER_TEMPLATE_VERSION) ===
        "start",
    ).toBe(needsStart);
  });
});
