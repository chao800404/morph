// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import { DEFAULT_APPROVED_DEPENDENCIES } from "./sandbox-vite-theme-build-runner.types";

/**
 * Which bridge a preview plan lays out, read from the plan itself.
 *
 * The planner is the one place that knows the bytes a page will load, so it
 * reports their identity and the capabilities their entry declares. A
 * transport passes that on; nothing downstream fills capabilities in from
 * its own constants. The entry is swapped here for one that declares less
 * than this process's constant, which is what an older or newer bridge does.
 */

const entryEdit = vi.hoisted(() => ({
  transform: null as ((source: string) => string) | null,
}));

vi.mock("./theme-preview-bridge-entry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./theme-preview-bridge-entry")>();
  return {
    ...actual,
    themePreviewBridgeEntrySource: () => {
      const source = actual.themePreviewBridgeEntrySource();
      return entryEdit.transform ? entryEdit.transform(source) : source;
    },
  };
});

const { planThemeSandboxWorkspace } = await import("./theme-sandbox-workspace");
const { THEME_PREVIEW_BRIDGE_CAPABILITIES } = await import(
  "./theme-preview-bridge-entry"
);

type Plan = Extract<
  ReturnType<typeof planThemeSandboxWorkspace>,
  { ok: true }
>;

function plan(
  options: {
    mode?: "preview-server" | "build";
    previewRuntime?: "client" | "start";
    page?: string;
    title?: string;
  } = {},
): Plan {
  const files = STARTER_THEME_FILES.map((file) =>
    options.page && file.path === "src/routes/index.tsx"
      ? { ...file, content: `${file.content}\n${options.page}\n` }
      : file,
  );
  const result = planThemeSandboxWorkspace({
    files: files as never,
    entry: "src/routes/index.tsx",
    buildId: "preview-bridge-identity",
    approvedDependencies: new Set(DEFAULT_APPROVED_DEPENDENCIES),
    mode: options.mode ?? "preview-server",
    previewRuntime: options.previewRuntime,
    previewContent: options.title
      ? ({
          templates: { index: { slots: { hero: { title: options.title } } } },
        } as never)
      : undefined,
  });
  if (!result.ok) throw new Error(`${result.stage}: ${result.errorMessage}`);
  return result;
}

const withoutAck = (source: string) =>
  source.replace(/,\n\s*"section-presentation-ack-v1"/, "");

beforeEach(() => {
  entryEdit.transform = null;
});

describe("the bridge a preview plan reports", () => {
  it("reports the capabilities its laid-out entry declares", () => {
    const reported = plan().previewBridge;
    expect(reported?.capabilities).toEqual([
      ...THEME_PREVIEW_BRIDGE_CAPABILITIES,
    ]);
    expect(reported?.buildId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports what the written entry declares, not this process's constant", () => {
    entryEdit.transform = withoutAck;
    const laidOut = plan();
    const entry = laidOut.workspaceFiles.find((file) =>
      file.path.endsWith("/preview-bridge.ts"),
    ) as { content: string } | undefined;
    expect(entry?.content).not.toContain("section-presentation-ack-v1");
    // The constant this process holds still names it.
    expect(THEME_PREVIEW_BRIDGE_CAPABILITIES).toContain(
      "section-presentation-ack-v1",
    );
    expect(laidOut.previewBridge?.capabilities).not.toContain(
      "section-presentation-ack-v1",
    );
  });

  it("reports no bridge when its entry's declaration cannot be read", () => {
    entryEdit.transform = (source) =>
      source.replace(
        "const BRIDGE_CAPABILITIES: readonly PreviewCapability[] = [",
        'const BRIDGE_CAPABILITIES: readonly PreviewCapability[] = ["not-a-capability",',
      );
    expect(plan().previewBridge ?? null).toBeNull();
  });

  it("keeps the build id when the Theme's source or its draft content changes", () => {
    const base = plan().previewBridge!;
    expect(plan({ page: "// edited" }).previewBridge).toEqual(base);
    expect(plan({ title: "A draft title" }).previewBridge).toEqual(base);
    // The workspace itself did change, which is what restarts the server.
    expect(plan({ page: "// edited" }).workspaceFingerprint).not.toBe(
      plan().workspaceFingerprint,
    );
  });

  it("changes the build id when any byte of the bridge changes", () => {
    const base = plan().previewBridge!;
    entryEdit.transform = (source) => `${source}\n// another bridge build\n`;
    const changed = plan().previewBridge!;
    expect(changed.buildId).not.toBe(base.buildId);
    expect(changed.capabilities).toEqual(base.capabilities);
  });

  it("counts the Start client entry for a Start preview", () => {
    const client = plan().previewBridge!;
    const start = plan({ previewRuntime: "start" }).previewBridge!;
    expect(start.buildId).not.toBe(client.buildId);
  });

  it("reports nothing for a build", () => {
    expect(plan({ mode: "build" }).previewBridge ?? null).toBeNull();
  });
});
