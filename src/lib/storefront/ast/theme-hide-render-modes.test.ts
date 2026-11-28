import { describe, expect, it } from "vitest";
import { starterThemeWorkspaceFiles } from "@/lib/storefront/starter-theme-files";
import {
  RENDER_MODES,
  RENDER_MODE_KINDS,
  RENDER_MODES_FILES,
  renderModeDeferReadRoute,
  renderModeRouteFile,
  renderModeSlot,
  type RenderMode,
  type RenderModeKind,
} from "@/lib/storefront/compat/render-modes-theme";
import {
  createHideCapabilityAnalyzer,
  type HideCapability,
} from "./theme-hide-capability";
import type { B1SourceFile } from "./theme-content-provenance";

/**
 * Render-mode evidence (handoff/2026-11-28/start-render-modes-audit.md,
 * "Codex review — adopted", item 4): the Hide verdict for a section on a
 * route whose TanStack Start `ssr` option is set, and for a Theme that
 * changes the default render mode, in `src/router.tsx` or in `src/start.ts`.
 *
 * The classifier does not read a route's `ssr` option (it asks where the
 * page learns which sections are hidden, which is the root route's
 * `beforeLoad` in every mode). Whether hiding then holds in each mode is the
 * E2E evidence's question (e2e/start-render-modes-hidden.spec.ts); this file
 * records what the classifier says before any of it runs. Expectations are
 * written by hand, never derived from the analysis.
 */

const ROUTER = "src/router.tsx";
const ROOT = "src/routes/__root.tsx";

/** Starter 32 as a new Theme gets it, with the render-mode fixture beside it. */
function theme(
  edit: (files: Map<string, B1SourceFile>) => void = () => {},
): B1SourceFile[] {
  const files = new Map<string, B1SourceFile>();
  for (const file of [...starterThemeWorkspaceFiles(), ...RENDER_MODES_FILES]) {
    files.set(file.path, { path: file.path, content: file.content });
  }
  edit(files);
  return [...files.values()];
}

function replaceIn(
  files: Map<string, B1SourceFile>,
  path: string,
  from: string,
  to: string,
) {
  const file = files.get(path);
  if (!file) throw new Error(`${path} is not in the Theme.`);
  if (!file.content.includes(from)) {
    throw new Error(`${path} does not contain ${JSON.stringify(from)}.`);
  }
  files.set(path, { path, content: file.content.replace(from, to) });
}

function verdict(
  files: readonly B1SourceFile[],
  mode: RenderMode,
  kind: RenderModeKind,
): HideCapability {
  return createHideCapabilityAnalyzer(files).classify({
    callSitePath: renderModeRouteFile(mode),
    slot: renderModeSlot(mode, kind),
    scope: "route",
  });
}

/** Every fixture section's verdict, as `kind` or `kind:reason`. */
function verdicts(files: readonly B1SourceFile[]) {
  const analyzer = createHideCapabilityAnalyzer(files);
  return Object.fromEntries(
    RENDER_MODES.flatMap((mode) =>
      RENDER_MODE_KINDS.map((kind) => {
        const result = analyzer.classify({
          callSitePath: renderModeRouteFile(mode),
          slot: renderModeSlot(mode, kind),
          scope: "route",
        });
        return [
          renderModeSlot(mode, kind),
          result.kind === "supported" ? "supported" : `${result.kind}:${result.reason}`,
        ];
      }),
    ),
  );
}

describe("Hide verdicts on routes with a Start render mode", () => {
  it("the fixture's sections, per route ssr option (literal true by default, false, data-only, a function) and a deferred <Await>", () => {
    expect(verdicts(theme())).toEqual({
      rmssrshown: "supported",
      rmssrhidden: "supported",
      rmssrloadshown: "supported",
      rmssrloadhidden: "supported",
      rmoffshown: "supported",
      rmoffhidden: "supported",
      rmoffloadshown: "supported",
      rmoffloadhidden: "supported",
      rmdatashown: "supported",
      rmdatahidden: "supported",
      rmdataloadshown: "supported",
      rmdataloadhidden: "supported",
      rmfnshown: "supported",
      rmfnhidden: "supported",
      rmfnloadshown: "supported",
      rmfnloadhidden: "supported",
      rmdefershown: "supported",
      rmdeferhidden: "supported",
      rmdeferloadshown: "supported",
      rmdeferloadhidden: "supported",
    });
  });

  it("a deferred value that reads the page itself, rendered inside <Await>: every hide in the Theme is refused", () => {
    // RECORDED (render-modes audit, finding): the deferred read's result
    // reaches the Await render prop, which the proof cannot follow, and the
    // proof is whole-Theme, so one such route refuses every section's hide,
    // the layout's and the Starter home's included.
    const files = theme((map) => {
      const variant = renderModeDeferReadRoute();
      map.set(variant.path, variant);
    });
    const all = verdicts(files);
    // The route's own sections are refused at the read itself, every
    // other section because another module reads content it cannot follow.
    for (const [slot, value] of Object.entries(all)) {
      expect(value, slot).toBe(
        slot.startsWith("rmdefer")
          ? "unsupported:untraced-use"
          : "unsupported:component-reads-content",
      );
    }
    const analyzer = createHideCapabilityAnalyzer(files);
    for (const [path, scope] of [
      ["src/routes/index.tsx", "route"],
      ["src/layouts/StorefrontLayout.tsx", "layout"],
    ] as const) {
      for (const slot of analyzer.sectionsIn(path)) {
        expect(analyzer.classify({ callSitePath: path, slot, scope }), slot).toMatchObject({
          kind: "unsupported",
          reason: "component-reads-content",
          at: { file: renderModeRouteFile("defer") },
        });
      }
    }
  });

  it("the ssr literal is not what decides: the same route with each other literal gets the same verdict", () => {
    for (const literal of ["ssr: true,", "ssr: false,", 'ssr: "data-only",']) {
      const files = theme((map) =>
        replaceIn(map, renderModeRouteFile("off"), "ssr: false,", literal),
      );
      for (const kind of RENDER_MODE_KINDS) {
        expect(verdict(files, "off", kind), `${literal} ${kind}`).toMatchObject({
          kind: "supported",
        });
      }
    }
  });
});

describe("Hide verdicts when the Theme changes the default render mode", () => {
  it("defaultSsr: false in src/router.tsx: no check names it, and the sections stay hideable", () => {
    // Start's server handler overwrites the router's defaultSsr with the
    // start options' value on every request (createStartHandler's
    // router.update), and createRouter's type omits it: on the server this
    // edit does nothing. Recorded, so a later check that reads it shows here.
    const files = theme((map) =>
      replaceIn(map, ROUTER, "scrollRestoration: true,", "scrollRestoration: true,\n    defaultSsr: false,"),
    );
    expect(verdicts(files)).toEqual(verdicts(theme()));
  });

  it("defaultSsr: false in src/start.ts: a replaced Start entry point refuses every hide as custom-build", () => {
    const files = theme((map) =>
      map.set("src/start.ts", {
        path: "src/start.ts",
        content: `import { createStart } from "@tanstack/react-start";

export const startInstance = createStart(() => ({ defaultSsr: false }));
`,
      }),
    );
    for (const mode of RENDER_MODES) {
      for (const kind of ["shown", "hidden"] as const) {
        expect(verdict(files, mode, kind), `${mode} ${kind}`).toMatchObject({
          kind: "unsupported",
          reason: "custom-build",
          at: { file: "src/start.ts" },
        });
      }
    }
  });

  it("ssr: false on the root route: the edited root refuses every hide as root-route-unconfirmed", () => {
    const files = theme((map) =>
      replaceIn(map, ROOT, "export const Route = createRootRoute({", "export const Route = createRootRoute({\n  ssr: false,"),
    );
    for (const mode of RENDER_MODES) {
      for (const kind of ["shown", "hidden"] as const) {
        expect(verdict(files, mode, kind), `${mode} ${kind}`).toMatchObject({
          kind: "unsupported",
          reason: "root-route-unconfirmed",
          at: { file: ROOT },
        });
      }
    }
  });
});
