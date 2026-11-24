import { describe, expect, it } from "vitest";
import { confirmThemeContentModuleFunctionExport } from "./ast/theme-content-module";
import { classifyHideCapability } from "./ast/theme-hide-capability";
import {
  deriveThemeRouteSections,
  themeRouteStructureLock,
} from "./compiler/theme-route-sections";
import { starterThemeWorkspaceFiles } from "./starter-theme-files";
import { sourceRequiresStartPreview } from "./starter-upgrade-start-preview";
import { STARTER_V32_CANDIDATE_CONTENT_MODULE_SOURCE } from "./starter-v32-candidate-content-module";

/**
 * The acceptance gate for Starter 32, narrow A step 1 (2026-11-24).
 *
 * User decision: stay on Starter 31 until the home keeps every Design
 * capability it has today. Step 1 swaps ONLY the read source: the content
 * module's reads go through one `createServerFn` that calls the hosted SDK
 * (`morph.pages.get` from `@morph/sdk/start`). The home route keeps Starter
 * 31's per-section shape, `{!isSectionHidden("slot") && <El
 * {...content("slot")} />}`, byte for byte, and so do the root and the layout.
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
 * The candidate module is not shipped (nothing in the product reads it); the
 * gate runs it on the real adopted workspace.
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

function v31Workspace() {
  return starterThemeWorkspaceFiles().map((file) => ({
    path: file.path,
    content: file.content,
  }));
}

function v32Workspace() {
  return v31Workspace().map((file) => ({
    path: file.path,
    content:
      file.path === CONTENT
        ? STARTER_V32_CANDIDATE_CONTENT_MODULE_SOURCE
        : file.content,
  }));
}

function fileOf(files: ReturnType<typeof v32Workspace>, path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  if (!file) throw new Error(`${path} is not in the workspace`);
  return file.content;
}

function countOf(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

describe("the Starter 32 candidate (narrow A step 1: the read source only)", () => {
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
      sourceRequiresStartPreview(CONTENT, STARTER_V32_CANDIDATE_CONTENT_MODULE_SOURCE),
    ).toBe(true);
    const files = v32Workspace();
    // The routes stay Starter 31's, which the client runtime can render.
    for (const path of [HOME, ROOT, LAYOUT]) {
      expect(sourceRequiresStartPreview(path, fileOf(files, path)), path).toBe(
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
    // (its beforeLoad), and the module defines nothing else that reads.
    const loaders = files.filter((file) =>
      file.content.includes("loadContentSlots("),
    );
    expect(loaders.map((file) => file.path)).toEqual([ROOT]);
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
    // The Starter's own guard, through the module's isSectionHidden, as on 31.
    expect(hide).toEqual(classifyHideCapability({ files: v31Workspace(), ...args }));
  });
});
