import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { syncContentHash } from "./sync-content";
import { createLocalSyncFolder, LocalSyncFolderError } from "./sync-local-fs";
import {
  createSyncSession,
  type CyclePlanSummary,
  type RestorePlan,
  type SyncState,
} from "./sync-session";
import {
  createFakeWorkspace,
  createHarnessClient,
  createMemoryFolder,
} from "./sync-test-harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

/**
 * `morph-sync restore`: taking files back from Morph after the local copies
 * were deleted or broken, without deleting `.morph/sync-state.json` and
 * linking again (docs/local-code-sync.md).
 */

const emptyState = (): SyncState => ({
  protocol: 1,
  origin: "http://morph.test",
  storefrontId: "store-a",
  themeId: "theme-a",
  sourceGeneration: null,
  files: {},
});

function setup(options: {
  morph: Record<string, string>;
  confirmCycle?: (summary: CyclePlanSummary, why: string) => boolean;
  /** Local files before the first cycle, `.morphignore` included. */
  local?: Record<string, string>;
  state?: Partial<SyncState>;
}) {
  const workspace = createFakeWorkspace(options.morph);
  const local = createMemoryFolder(options.local);
  const client = createHarnessClient(workspace);
  const confirmCycle = vi.fn(async (summary: CyclePlanSummary, why: string) =>
    options.confirmCycle ? options.confirmCycle(summary, why) : true,
  );
  const session = createSyncSession({
    client,
    folder: local.folder,
    state: { ...emptyState(), ...options.state },
    saveState: async () => {},
    confirm: confirmCycle,
  });
  /** Answers a restore's question, recording what it was shown. */
  const shown: RestorePlan[] = [];
  const answer =
    (yes: boolean, meanwhile?: () => void) => async (plan: RestorePlan) => {
      shown.push(plan);
      meanwhile?.();
      return yes;
    };
  return { workspace, local, session, confirmCycle, shown, answer };
}

describe("restoring local files from Morph", () => {
  it("brings back a file deleted locally, and the next sync does not delete it in Morph", async () => {
    const { workspace, local, session, answer } = setup({
      morph: { "a.tsx": "keep", "b.tsx": "deleted by mistake" },
    });
    await session.runCycle();
    local.files.delete("b.tsx");

    const result = await session.restore(["b.tsx"], answer(true));
    expect(result.status).toBe("applied");
    expect(result.status === "applied" && result.plan.write).toEqual(["b.tsx"]);
    expect(local.files.get("b.tsx")).toBe("deleted by mistake");

    const saves = workspace.saves.length;
    const next = await session.runCycle();
    expect(next.status).toBe("applied");
    expect(next.summary.remoteDeletions).toEqual([]);
    expect(next.summary.uploads).toEqual([]);
    expect(workspace.saves.length).toBe(saves);
    expect(workspace.files.get("b.tsx")?.content).toBe("deleted by mistake");
  });

  it("replaces a broken local file with Morph's, keeping the broken copy, and never writes Morph", async () => {
    const { workspace, local, session, answer } = setup({
      morph: { "a.tsx": "good\n" },
    });
    await session.runCycle();
    local.files.set("a.tsx", "broken\r\n");
    const saves = workspace.saves.length;

    const result = await session.restore(["a.tsx"], answer(true));
    expect(result.status === "applied" && result.plan.replace).toEqual(["a.tsx"]);
    // Morph's text, in the line endings the local file used.
    expect(local.files.get("a.tsx")).toBe("good\r\n");
    expect(local.backups).toEqual([{ path: "a.tsx", text: "broken\r\n" }]);
    expect(workspace.saves.length).toBe(saves);

    // In step: the broken edit is not sent up on the next sync.
    const next = await session.runCycle();
    expect(next.summary.uploads).toEqual([]);
    expect(workspace.files.get("a.tsx")?.content).toBe("good\n");
  });

  it("sets the base to the version it restored, even when Morph moved past the old base", async () => {
    const { workspace, local, session, answer } = setup({ morph: { "a.tsx": "v1" } });
    await session.runCycle();
    workspace.editInMorph("a.tsx", "v2");
    local.files.delete("a.tsx");

    await session.restore(["a.tsx"], answer(true));
    const remote = workspace.files.get("a.tsx")!;
    expect(session.state.files["a.tsx"]).toEqual({
      id: remote.id,
      version: remote.version,
      hash: await syncContentHash("v2"),
    });
    expect(local.files.get("a.tsx")).toBe("v2");
  });

  it("keeps a copy of a local file it cannot decode before writing Morph's over it", async () => {
    const { local, session, answer } = setup({ morph: { "a.tsx": "good" } });
    await session.runCycle();
    // On disk, `read` answers null for bytes that are not UTF-8, as for a
    // missing file; the file is still there and must not be lost.
    local.files.set("a.tsx", "\uFFFDnot utf-8");
    const read = local.folder.read;
    local.folder.read = async (path) => (path === "a.tsx" && local.files.get(path) !== "good" ? null : read(path));

    const result = await session.restore(["a.tsx"], answer(true));
    expect(result.status === "applied" && result.plan.write).toEqual(["a.tsx"]);
    expect(local.backups).toEqual([{ path: "a.tsx", text: "\uFFFDnot utf-8" }]);
    expect(local.files.get("a.tsx")).toBe("good");
  });

  it("changes nothing when the developer declines", async () => {
    const { workspace, local, session, answer } = setup({ morph: { "a.tsx": "good" } });
    await session.runCycle();
    local.files.set("a.tsx", "my edit");
    const before = structuredClone(session.state.files);

    const result = await session.restore(["a.tsx"], answer(false));
    expect(result.status).toBe("declined");
    expect(local.files.get("a.tsx")).toBe("my edit");
    expect(local.backups).toEqual([]);
    expect(session.state.files).toEqual(before);
    expect(workspace.files.get("a.tsx")?.content).toBe("good");
  });

  it("restores nothing when Morph changes while waiting for the answer", async () => {
    const { workspace, local, session, answer } = setup({ morph: { "a.tsx": "v1" } });
    await session.runCycle();
    local.files.delete("a.tsx");
    const before = structuredClone(session.state.files);

    const result = await session.restore(
      ["a.tsx"],
      answer(true, () => workspace.editInMorph("a.tsx", "v2")),
    );
    expect(result.status).toBe("retry");
    expect(local.files.has("a.tsx")).toBe(false);
    expect(session.state.files).toEqual(before);
  });

  it("skips a file edited locally while waiting for the answer, and keeps the edit", async () => {
    const { local, session, answer } = setup({
      morph: { "a.tsx": "a", "b.tsx": "b" },
    });
    await session.runCycle();
    local.files.set("a.tsx", "broken a");
    local.files.delete("b.tsx");

    const result = await session.restore(
      "all",
      answer(true, () => local.files.set("a.tsx", "fixed it myself")),
    );
    expect(result.status === "applied" && result.skipped).toEqual(["a.tsx"]);
    expect(local.files.get("a.tsx")).toBe("fixed it myself");
    expect(local.backups).toEqual([]);
    expect(local.files.get("b.tsx")).toBe("b");
  });

  it("leaves named files Morph does not hold, binary files and platform files alone, and says so", async () => {
    const { workspace, local, session, answer } = setup({
      morph: { "a.tsx": "a" },
    });
    workspace.addBinary("src/assets/photo.png");
    await session.runCycle();
    local.files.set("only-local.tsx", "mine");

    const result = await session.restore(
      ["only-local.tsx", "src/assets/photo.png", "__entry.tsx", "a.tsx"],
      answer(true),
    );
    expect(result.status).toBe("applied");
    const plan = (result as Extract<typeof result, { status: "applied" }>).plan;
    expect(plan.notInMorph).toEqual(["only-local.tsx"]);
    expect(plan.notRestorable.map((entry) => entry.path)).toEqual([
      "__entry.tsx",
      "src/assets/photo.png",
    ]);
    expect(plan.inStep).toEqual(["a.tsx"]);
    expect(local.files.get("only-local.tsx")).toBe("mine");
  });

  it("leaves a path .morphignore keeps out alone: ignored paths are out of sync both ways", async () => {
    const { workspace, local, session, answer } = setup({
      morph: { "a.tsx": "a", "notes/plan.md": "from Morph" },
      local: { ".morphignore": "notes/\n" },
    });
    const result = await session.restore("all", answer(true));
    expect(result.status).toBe("applied");
    const plan = (result as Extract<typeof result, { status: "applied" }>).plan;
    expect(plan.notRestorable).toEqual([{ path: "notes/plan.md", reason: ".morphignore" }]);
    expect(plan.ignoreRulesFrom).toBe("file");
    expect(local.files.has("notes/plan.md")).toBe(false);
    expect(session.state.files["notes/plan.md"]).toBeUndefined();
    expect(workspace.files.get("notes/plan.md")?.content).toBe("from Morph");
  });

  it("keeps leaving out what the last sync's rules listed when .morphignore is missing", async () => {
    const { local, session, answer } = setup({
      morph: { "a.tsx": "a", "notes/plan.md": "from Morph" },
      state: { ignoreHistory: { text: "notes/\n" } },
    });
    const result = await session.restore(["a.tsx", "notes/plan.md"], answer(true));
    expect(result.status).toBe("applied");
    const plan = (result as Extract<typeof result, { status: "applied" }>).plan;
    expect(plan.ignoreRulesFrom).toBe("last-sync");
    expect(plan.notRestorable).toEqual([{ path: "notes/plan.md", reason: ".morphignore" }]);
    expect(plan.write).toEqual(["a.tsx"]);
    expect(local.files.has("notes/plan.md")).toBe(false);
    // Restore is not a cycle: it does not record the rules it used.
    expect(session.state.ignoreHistory).toEqual({ text: "notes/\n" });
  });

  it("restores nothing when .morphignore changes while waiting for the answer", async () => {
    const { local, session, answer } = setup({
      morph: { "a.tsx": "a", "notes/plan.md": "from Morph" },
      local: { ".morphignore": "notes/\n" },
    });
    const before = structuredClone(session.state.files);
    const result = await session.restore(
      "all",
      answer(true, () => local.files.set(".morphignore", "")),
    );
    expect(result.status).toBe("retry");
    expect(local.files.has("a.tsx")).toBe(false);
    expect(local.files.has("notes/plan.md")).toBe(false);
    expect(session.state.files).toEqual(before);
  });

  it("asks nothing and writes nothing when every file already matches Morph", async () => {
    const { local, session, answer, shown } = setup({ morph: { "a.tsx": "a" } });
    await session.runCycle();
    const result = await session.restore("all", answer(true));
    expect(result.status).toBe("applied");
    expect(shown).toEqual([]);
    expect(local.backups).toEqual([]);
  });

  it("brings an emptied folder back so the held mass deletion has nothing left to delete", async () => {
    const morph = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`src/f${index}.ts`, `f${index}`]),
    );
    const { workspace, local, session, answer } = setup({
      morph,
      confirmCycle: (_summary, why) => why === "startup",
    });
    await session.runCycle();
    local.files.clear();
    expect((await session.runCycle()).status).toBe("declined");
    expect(session.state.deletionHold).toBeDefined();

    const result = await session.restore("all", answer(true));
    expect(result.status === "applied" && result.plan.write).toHaveLength(30);
    expect(local.files.size).toBe(30);

    const next = await session.runCycle();
    expect(next.status).toBe("applied");
    expect(next.summary.remoteDeletions).toEqual([]);
    expect(session.state.deletionHold).toBeUndefined();
    expect(workspace.files.size).toBe(30);
  });
});

describe("restoring when .morphignore cannot be read", () => {
  it("fails before anything is written, on the folder on disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "morph-restore-"));
    try {
      // A directory where the file should be: present, but not readable as one.
      await mkdir(join(root, ".morphignore"));
      await writeFile(join(root, "a.tsx"), "broken");
      const workspace = createFakeWorkspace({ "a.tsx": "good" });
      const state = emptyState();
      const session = createSyncSession({
        client: createHarnessClient(workspace),
        folder: createLocalSyncFolder(root),
        state,
        saveState: async () => {},
        confirm: async () => true,
      });
      const confirm = vi.fn(async () => true);
      await expect(session.restore(["a.tsx"], confirm)).rejects.toBeInstanceOf(LocalSyncFolderError);
      expect(confirm).not.toHaveBeenCalled();
      expect(await readFile(join(root, "a.tsx"), "utf8")).toBe("broken");
      expect(state.files).toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
