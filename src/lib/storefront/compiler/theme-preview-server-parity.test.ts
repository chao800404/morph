// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";
import { planThemeSandboxWorkspace } from "./theme-sandbox-workspace";

/**
 * The insurance between the two Live Preview transports.
 *
 * `workspace-theme-parity.test.ts` exists because an interpreter and a real
 * build can disagree about the same Theme, and only one of them runs in CI.
 * The preview transports have the same exposure, one layer over: CI runs the
 * local server, so a divergence in it is invisible here and only shows up when
 * someone opens the editor against a container.
 *
 * What can be checked without a container is the thing that would actually
 * drift: the workspace the two serve. Both lay it out with
 * `planThemeSandboxWorkspace`, and the only permitted difference is which root
 * the generated config names. If a second, local-only definition of what the
 * workspace contains ever appears, the first case below fails.
 *
 * What this cannot check, and deliberately does not pretend to: that the
 * Cloudflare Sandbox really serves it. That needs a real container, exactly as
 * it did before this transport existed.
 */

const THEME_FILES = [
  {
    path: "morph.theme.json",
    content: JSON.stringify({ router: { framework: "tanstack-start" } }),
  },
  { path: "src/router.tsx", content: "export function getRouter() { return null; }" },
  {
    path: "src/routes/__root.tsx",
    content: "export const Route = createRootRoute({});",
  },
  {
    path: "src/routes/index.tsx",
    content: 'export const Route = createFileRoute("/")({});',
  },
];

function plan(overrides: {
  hostWorkspaceRoot?: string;
  toolchainRoot?: string;
}) {
  const result = planThemeSandboxWorkspace({
    files: THEME_FILES,
    entry: "src/routes/index.tsx",
    buildId: "parity",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode: "preview-server",
    previewContent: {
      templates: { index: { slots: { hero: { heading: "Draft" } }, hiddenSlots: [] } },
      pages: {},
    },
    ...overrides,
  });
  if (!result.ok) throw new Error(result.errorMessage);
  return result;
}

describe("the two Live Preview transports", () => {
  it("lay out the same workspace, differing only in the root the config names", () => {
    const sandbox = plan({});
    const local = plan({
      hostWorkspaceRoot: "/checkout/.morph-previews/theme-a-user-1",
      toolchainRoot: "/checkout",
    });

    // The same files, in the same order, with the same paths: a plan path is
    // workspace vocabulary, and each transport's writer is what places it.
    expect(local.workspaceFiles.map((file) => file.path)).toEqual(
      sandbox.workspaceFiles.map((file) => file.path),
    );
    // The same entry, the same bridge, the same editor identity.
    expect(local.hoistedContentFields).toEqual(sandbox.hoistedContentFields);
    expect(local.previewWarnings).toEqual(sandbox.previewWarnings);

    // And every file is byte-identical once the two roots are read as the same
    // place, which is the whole claim: one definition, two locations.
    const rewritten = (file: { path: string; content: string | Uint8Array }) =>
      String(file.content)
        .split("/checkout/.morph-previews/theme-a-user-1")
        .join("/workspace")
        .split("/checkout")
        .join("/opt/morph-toolchain");
    for (const [index, file] of local.workspaceFiles.entries()) {
      expect(rewritten(file)).toBe(String(sandbox.workspaceFiles[index]!.content));
    }
  });

  it("keep one copy of the containment rules between them", () => {
    // The local transport is a different *place* to serve from, not a second
    // set of rules. A local copy of the dependency allowlist, the filesystem
    // containment check or the dev-infrastructure allowance would be a parallel
    // architecture wearing a transport's clothes — and it would be the copy
    // that CI exercises.
    const local = readFileSync(
      new URL("./local-vite-preview-server.ts", import.meta.url),
      "utf8",
    );
    for (const rule of [
      "UNAPPROVED_DEPENDENCY",
      "WORKSPACE_PATH_ESCAPE",
      "node_modules/.vite",
      "/@fs",
      "morph-dependency-enforcer",
      "morph-theme-preview-server-stub",
    ]) {
      expect(local).not.toContain(rule);
    }
    // It does not hand Vite a config of its own either: it points the pinned
    // toolchain at the config the plan generated.
    expect(local).toContain("configFile: path.join(root, \"vite.config.ts\")");
  });

  it("differ in exactly two contract points, and say so", () => {
    // `isServing` is where a container and a checkout cannot answer the same
    // question: a developer reaches the sandbox through a proxy that rewrites
    // the scheme and port, so it compares hostnames, while nothing sits between
    // an editor and a local server, so comparing origins is both possible and
    // stricter. Recorded as an assertion so that a later edit which quietly
    // makes one of them behave like the other has to change this on purpose.
    //
    // The watcher is the second, and it is the one divergence here backed by a
    // red test rather than by an argument: with the generated config's polling
    // watcher, an edit applied through `/applyFiles` does not reach the served
    // module, and `local-preview-sidecar.test.ts` fails. Run that file on its
    // own — inside the full suite it passes either way, so the suite's green is
    // not evidence about this.
    const sandbox = readFileSync(
      new URL("./cloudflare-sandbox-vite-preview-server.ts", import.meta.url),
      "utf8",
    );
    const sandboxConfig = readFileSync(
      new URL("./theme-sandbox-workspace.ts", import.meta.url),
      "utf8",
    );
    const local = readFileSync(
      new URL("./local-vite-preview-server.ts", import.meta.url),
      "utf8",
    );
    expect(sandbox).toContain("Compared by hostname, never by origin.");
    expect(local).toContain("so an origin is");
    // The local transport takes every serving decision from the config except
    // the watcher, which it overrides for the reason above.
    expect(sandboxConfig).toContain(
      "watch: isLivePreview\n  ? { usePolling: true, interval: 100 }",
    );
    expect(local).toContain("watch: { usePolling: false }");
  });
});
