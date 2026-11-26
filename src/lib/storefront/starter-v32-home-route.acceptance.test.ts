import { describe, expect, it } from "vitest";
import { confirmThemeContentModuleFunctionExport } from "./ast/theme-content-module";
import { classifyHideCapability } from "./ast/theme-hide-capability";
import {
  deriveThemeRouteSections,
  themeRouteStructureLock,
} from "./compiler/theme-route-sections";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "./default-storefront-document";
import { starterThemeWorkspaceFiles } from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "./starter-theme-v3-files";
import { sourceRequiresStartPreview } from "./starter-upgrade-start-preview";

/**
 * The acceptance gate for Starter 32, narrow A (user decision 2026-11-24).
 *
 * Stay on Starter 31's structure and swap ONLY the read source: the content
 * module's reads go through one `createServerFn` that calls the hosted SDK
 * (`morph.pages.get` from `@morph/sdk/start`). The home route keeps Starter
 * 31's per-section shape, `{!isSectionHidden("slot") && <El
 * {...content("slot")} />}`, byte for byte, and so do the root and the layout.
 * Design keeps binding, structure editing (the route has no loader, so no
 * structure lock) and Hide.
 *
 * The earlier candidate (the home read through its own loader, `{...page[slot]}`)
 * lost binding, structure editing and Hide; see the handoff
 * `~/handoff/2026-11-24/starter-v32-impl.md`. This one changes no analyzer
 * rule: Start's B1 already trusts `content` from `src/morph/content.ts`
 * whatever that module does inside (the platform contract is "content(slot)
 * returns the stored props of slot", theme-content-provenance.ts), and Hide
 * for a `content()` site asks only that `isSectionHidden` is a function the
 * module declares (theme-hide-capability.ts, A6).
 *
 * The shipped Starter is compared with itself carrying Starter 31's content
 * module, the one file 32 changes.
 */

const HOME = "src/routes/index.tsx";
const ROOT = "src/routes/__root.tsx";
const LAYOUT = "src/layouts/StorefrontLayout.tsx";
const CONTENT = "src/morph/content.ts";

const HOME_SLOTS = [
  "starter-hero",
  "starter-introduction",
  "starter-categories",
  "starter-story",
  "starter-principles",
  "starter-newsletter",
] as const;

/**
 * A route that is not the home page and reads a Page Document of its own,
 * written the way the Starter's home is. The Starter ships none (its other
 * routes, `/account` and `/order-transfer`, read no page sections), so the
 * gate adds one to the same workspace, as an author would.
 *
 * It imports the Starter workspace's shared section components
 * (`src/components/sections/*`). The workspace has no `src/components/Hero.tsx`
 * (that path is the flat base file set's), and an import that resolves to no
 * file gives Design no component to bind or hide.
 */
const PAGE = "src/routes/about.tsx";
const PAGE_SLOTS = ["about-hero", "about-newsletter"] as const;
const PAGE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content, isSectionHidden } from "../morph/content";
import Hero from "../components/sections/Hero";
import Newsletter from "../components/sections/Newsletter";

export const Route = createFileRoute("/about")({
  component: AboutRoute,
});

function AboutRoute() {
  return (
    <main>
      {!isSectionHidden("about-hero") && <Hero {...content("about-hero")} />}
      {!isSectionHidden("about-newsletter") && (
        <Newsletter {...content("about-newsletter")} />
      )}
    </main>
  );
}
`;

type WorkspaceFile = { path: string; content: string };

function v32Workspace(): WorkspaceFile[] {
  return starterThemeWorkspaceFiles().map((file) => ({
    path: file.path,
    content: file.content,
  }));
}

function v31Workspace(): WorkspaceFile[] {
  return v32Workspace().map((file) => ({
    path: file.path,
    content:
      file.path === CONTENT
        ? LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE
        : file.content,
  }));
}

function withPage(files: WorkspaceFile[]): WorkspaceFile[] {
  return [...files, { path: PAGE, content: PAGE_SOURCE }];
}

function fileOf(files: WorkspaceFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`${path} is not in the workspace`);
  return file.content;
}

function countOf(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("Starter 32 (narrow A: the read source only)", () => {
  it("is the current Starter, and ships the content module that reads through the hosted SDK", () => {
    expect(STOREFRONT_STARTER_TEMPLATE_VERSION).toBe(32);
    expect(fileOf(v32Workspace(), CONTENT)).toBe(
      STARTER_THEME_CONTENT_MODULE_SOURCE,
    );
    expect(STARTER_THEME_CONTENT_MODULE_SOURCE).not.toBe(
      LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
    );
  });

  it("changes only the content module of the Starter 31 workspace", () => {
    const before = v31Workspace();
    const after = v32Workspace();
    expect(after.map((file) => file.path)).toEqual(
      before.map((file) => file.path),
    );
    const changed = after
      .filter((file, index) => file.content !== before[index]!.content)
      .map((file) => file.path);
    expect(changed).toEqual([CONTENT]);
  });

  it("needs the full Start preview, through the content module alone", () => {
    expect(
      sourceRequiresStartPreview(CONTENT, STARTER_THEME_CONTENT_MODULE_SOURCE),
    ).toBe(true);
    // Starter 31's module needed none: a Theme still on it may run on client.
    expect(
      sourceRequiresStartPreview(
        CONTENT,
        LEGACY_STARTER_THEME_CONTENT_MODULE_V31_SOURCE,
      ),
    ).toBe(false);
    const files = v32Workspace();
    // The routes stay Starter 31's, which the client runtime can render.
    for (const file of files) {
      if (file.path === CONTENT) continue;
      expect(sourceRequiresStartPreview(file.path, file.content), file.path).toBe(
        false,
      );
    }
  });

  it("reads page content from one place: the server function that calls the hosted SDK", () => {
    const files = v32Workspace();
    const module = fileOf(files, CONTENT);
    // One server read entry, one SDK read inside it, and no read of its own.
    expect(module).toContain('from "@morph/sdk/start"');
    expect(countOf(module, /createServerFn\(/g)).toBe(1);
    expect(countOf(module, /hostedMorph\.pages\.get\(/g)).toBe(1);
    expect(module).not.toMatch(/\bfetch\(/);
    expect(module).not.toContain("getRequest");
    expect(module).not.toContain("x-morph-content-origin");
    // No other Theme file reads the content endpoint or the SDK.
    for (const file of files) {
      if (file.path === CONTENT) continue;
      expect(file.content, file.path).not.toContain("_morph/content");
      expect(file.content, file.path).not.toContain("@morph/sdk");
    }
    // The root is the one caller of the module's load, once per navigation
    // (its beforeLoad, with the location's own pathname), and the module
    // defines nothing else that reads.
    const loaders = files.filter((file) =>
      file.content.includes("loadContentSlots("),
    );
    expect(loaders.map((file) => file.path)).toEqual([ROOT]);
    expect(fileOf(files, ROOT)).toContain(
      "loadContentSlots(location.pathname)",
    );
    expect(countOf(fileOf(files, ROOT), /loadContentSlots\(/g)).toBe(1);
    expect(countOf(module, /readPage\(\{ data: /g)).toBe(3);
    // The home reads its sections from that one load, through content() and
    // isSectionHidden(), and has no loader or read of its own.
    const home = fileOf(files, HOME);
    expect(home).toMatch(/from "\.\.\/morph\/content"/);
    expect(home).not.toMatch(/\bloader\s*:/);
    expect(home).not.toContain("useLoaderData");
    expect(home).not.toContain("createServerFn");
    expect(home).not.toMatch(/morph\.pages\.get\(/);
    for (const slot of HOME_SLOTS) {
      expect(home).toContain(`content("${slot}")`);
      expect(home).toContain(`isSectionHidden("${slot}")`);
    }
    // The layout reads only the shared header and footer.
    const layout = fileOf(files, LAYOUT);
    const layoutSlots = [...layout.matchAll(/content\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(layoutSlots.sort()).toEqual(["starter-footer", "starter-header"]);
    for (const slot of HOME_SLOTS) expect(layout).not.toContain(slot);
  });

  it("still declares content() and isSectionHidden() as functions Design can confirm", () => {
    const files = v32Workspace();
    for (const exportName of ["content", "isSectionHidden"]) {
      expect(
        confirmThemeContentModuleFunctionExport(files, exportName, "check"),
        exportName,
      ).toEqual({ ok: true });
    }
  });

  it("keeps every home section bound for Design", () => {
    const derived = deriveThemeRouteSections(v32Workspace(), HOME);
    expect(derived.diagnostics).toEqual([]);
    expect(derived.sections.map((section) => section.slotId).sort()).toEqual(
      [...HOME_SLOTS].sort(),
    );
    // Exactly what Starter 31's home gives: the swap is invisible to binding.
    expect(derived).toEqual(deriveThemeRouteSections(v31Workspace(), HOME));
  });

  it("keeps Add, move and remove section in Design", () => {
    expect(themeRouteStructureLock(v32Workspace(), HOME)).toBeNull();
  });

  it.each(HOME_SLOTS)("keeps %s hideable", (slot) => {
    const args = { callSitePath: HOME, slot, scope: "route" as const };
    const hide = classifyHideCapability({ files: v32Workspace(), ...args });
    expect(hide).toMatchObject({ kind: "supported" });
    // Approach E (decision 2026-11-26, option A): Starter 31's content module
    // turns a failed read into empty content, so a hidden section could come
    // back with its defaults; that Theme is asked to upgrade first.
    expect(
      classifyHideCapability({ files: v31Workspace(), ...args }),
    ).toMatchObject({ kind: "unsupported", reason: "starter-upgrade-required" });
  });

  describe("a route other than the home that reads its own Page Document", () => {
    it("binds every section, as on Starter 31", () => {
      const derived = deriveThemeRouteSections(withPage(v32Workspace()), PAGE);
      expect(derived.diagnostics).toEqual([]);
      expect(derived.sections.map((section) => section.slotId).sort()).toEqual(
        [...PAGE_SLOTS].sort(),
      );
      expect(derived).toEqual(
        deriveThemeRouteSections(withPage(v31Workspace()), PAGE),
      );
    });

    it("keeps its structure editable", () => {
      expect(themeRouteStructureLock(withPage(v32Workspace()), PAGE)).toBeNull();
    });

    it.each(PAGE_SLOTS)("keeps %s hideable", (slot) => {
      const args = { callSitePath: PAGE, slot, scope: "route" as const };
      const hide = classifyHideCapability({
        files: withPage(v32Workspace()),
        ...args,
      });
      expect(hide).toMatchObject({ kind: "supported" });
      expect(
        classifyHideCapability({ files: withPage(v31Workspace()), ...args }),
      ).toMatchObject({ kind: "unsupported", reason: "starter-upgrade-required" });
    });

    it("needs nothing more than the home: the route itself runs on client", () => {
      expect(sourceRequiresStartPreview(PAGE, PAGE_SOURCE)).toBe(false);
    });
  });
});
