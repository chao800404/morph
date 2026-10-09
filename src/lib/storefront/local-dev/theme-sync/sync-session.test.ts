import { describe, expect, it, vi } from "vitest";
import { createSyncSession, type CyclePlanSummary, type SyncState } from "./sync-session";
import {
  createFakeWorkspace,
  createHarnessClient,
  createMemoryFolder,
} from "./sync-test-harness";

vi.mock("cloudflare:workers", () => ({ env: {} }));

const emptyState = (): SyncState => ({
  protocol: 1,
  origin: "http://morph.test",
  storefrontId: "store-a",
  themeId: "theme-a",
  sourceGeneration: null,
  files: {},
});

function setup(options: {
  morph?: Record<string, string>;
  local?: Record<string, string>;
  confirm?: (summary: CyclePlanSummary, why: string) => boolean;
  beforeRequest?: (url: URL, init: RequestInit) => void;
  now?: () => Date;
}) {
  const workspace = createFakeWorkspace(options.morph);
  const local = createMemoryFolder(options.local);
  const confirm = vi.fn(async (summary: CyclePlanSummary, why: string) =>
    options.confirm ? options.confirm(summary, why) : true,
  );
  const saved: SyncState[] = [];
  const client = createHarnessClient(workspace, { beforeRequest: options.beforeRequest });
  const open = (state: SyncState) =>
    createSyncSession({
      client,
      folder: local.folder,
      state,
      saveState: async (current) => {
        saved.push(structuredClone(current));
      },
      confirm,
      now: options.now,
    });
  const session = open(emptyState());
  /** The same folder after the CLI was stopped and started again. */
  const restart = () => open(structuredClone(saved.at(-1)!));
  return { workspace, local, session, confirm, saved, restart };
}

const morphText = (workspace: ReturnType<typeof createFakeWorkspace>, path: string) =>
  workspace.files.get(path)?.content;

describe("a local folder linked to a Theme", () => {
  it("is filled from the workspace on first link, after asking", async () => {
    const { local, session, confirm } = setup({
      morph: { "src/routes/index.tsx": "home", "package.json": "{}" },
    });
    const result = await session.runCycle();
    expect(result.status).toBe("applied");
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ downloads: ["package.json", "src/routes/index.tsx"] }),
      "startup",
    );
    expect(Object.fromEntries(local.files)).toEqual({
      "src/routes/index.tsx": "home",
      "package.json": "{}",
    });
  });

  it("sends a local edit to Morph against the version it was based on, once", async () => {
    const { workspace, local, session } = setup({ morph: { "a.tsx": "v1" } });
    await session.runCycle();
    local.files.set("a.tsx", "v2 from my editor");
    await session.runCycle();
    expect(morphText(workspace, "a.tsx")).toBe("v2 from my editor");
    expect(workspace.deps.saveFilesBatch).toHaveBeenLastCalledWith(
      "store-a",
      "theme-a",
      [
        {
          path: "a.tsx",
          content: "v2 from my editor",
          expectedFileId: workspace.files.get("a.tsx")!.id,
          expectedVersion: 1,
        },
      ],
      expect.objectContaining({ expectedSourceGeneration: 1, deletions: [], createdBy: "admin-1" }),
    );
    // The store decides whether this save is a revision, as for the editor.
    expect(workspace.deps.saveFilesBatch.mock.calls[0]![3]).not.toHaveProperty("createRevision");

    const writes = workspace.saves.length;
    const again = await session.runCycle();
    expect(again.status).toBe("applied");
    expect(workspace.saves.length).toBe(writes);
  });

  it("brings a Design edit in Morph down to the local file", async () => {
    const { workspace, local, session } = setup({ morph: { "a.tsx": '<div className="p-4" />' } });
    await session.runCycle();
    workspace.editInMorph("a.tsx", '<div className="p-4 pd-5" />');
    await session.runCycle();
    expect(local.files.get("a.tsx")).toBe('<div className="p-4 pd-5" />');
  });

  it("keeps a CRLF file CRLF and does not send it back", async () => {
    const { workspace, local, session } = setup({
      morph: { "a.tsx": "one\ntwo\n" },
      local: { "a.tsx": "one\r\ntwo\r\n" },
    });
    // Same text in both line endings: adopted, not a conflict.
    const first = await session.runCycle();
    expect(first.status === "applied" && first.summary.conflicts).toEqual([]);
    workspace.editInMorph("a.tsx", "one\ntwo\nthree\n");
    await session.runCycle();
    expect(local.files.get("a.tsx")).toBe("one\r\ntwo\r\nthree\r\n");
    const writes = workspace.saves.length;
    await session.runCycle();
    await session.runCycle();
    expect(workspace.saves.length).toBe(writes);
  });

  it("keeps both copies when both sides changed, and settles as told", async () => {
    const { workspace, local, session } = setup({ morph: { "a.tsx": "base" } });
    await session.runCycle();
    local.files.set("a.tsx", "mine");
    workspace.editInMorph("a.tsx", "theirs");

    const result = await session.runCycle();
    expect(result.summary.conflicts).toEqual([{ path: "a.tsx", reason: "both-changed" }]);
    expect(local.files.get("a.tsx")).toBe("mine");
    expect(morphText(workspace, "a.tsx")).toBe("theirs");
    expect(local.conflictCopies.get("a.tsx")).toBe("theirs");

    await session.resolve("a.tsx", "local");
    await session.runCycle();
    expect(morphText(workspace, "a.tsx")).toBe("mine");
    expect(local.conflictCopies.has("a.tsx")).toBe(false);
  });

  it("can settle a conflict in Morph's favour", async () => {
    const { workspace, local, session } = setup({ morph: { "a.tsx": "base" } });
    await session.runCycle();
    local.files.set("a.tsx", "mine");
    workspace.editInMorph("a.tsx", "theirs");
    await session.runCycle();
    await session.resolve("a.tsx", "remote");
    await session.runCycle();
    expect(local.files.get("a.tsx")).toBe("theirs");
    expect(morphText(workspace, "a.tsx")).toBe("theirs");
  });

  it("writes nothing when Morph changes between reading and saving, then catches up", async () => {
    let raced = false;
    const { workspace, local, session } = setup({
      morph: { "a.tsx": "v1", "b.tsx": "b1" },
      beforeRequest: (url) => {
        if (url.pathname.endsWith("files/save") && !raced) {
          raced = true;
          workspace.editInMorph("b.tsx", "b2 from Morph");
        }
      },
    });
    await session.runCycle();
    local.files.set("a.tsx", "v2");
    const result = await session.runCycle();
    expect(result.status).toBe("retry");
    expect(morphText(workspace, "a.tsx")).toBe("v1");

    const next = await session.runCycle();
    expect(next.status).toBe("applied");
    expect(morphText(workspace, "a.tsx")).toBe("v2");
    expect(local.files.get("b.tsx")).toBe("b2 from Morph");
  });

  it("deletes in Morph a file deleted locally, at its version", async () => {
    const { workspace, local, session } = setup({ morph: { "a.tsx": "x", "b.tsx": "y" } });
    await session.runCycle();
    local.files.delete("b.tsx");
    await session.runCycle();
    expect(workspace.files.has("b.tsx")).toBe(false);
    expect(workspace.files.has("a.tsx")).toBe(true);
  });

  it("moves a file Morph deleted into the trash rather than erasing it", async () => {
    const { workspace, local, session } = setup({ morph: { "a.tsx": "x", "b.tsx": "y" } });
    await session.runCycle();
    workspace.editInMorph("b.tsx", null);
    await session.runCycle();
    expect(local.files.has("b.tsx")).toBe(false);
    expect(local.trash).toEqual(["b.tsx"]);
  });

  it("does not empty Morph when the local folder is emptied", async () => {
    const morph = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`src/f${index}.ts`, `f${index}`]),
    );
    const { workspace, local, session, confirm } = setup({
      morph,
      confirm: (_summary, why) => why === "startup",
    });
    await session.runCycle();
    local.files.clear();
    const result = await session.runCycle();
    expect(result.status).toBe("declined");
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ massDeletion: expect.stringMatching(/local folder/) }),
      "mass-deletion",
    );
    expect(workspace.files.size).toBe(30);
  });

  describe("deleting a little at a time", () => {
    const morph = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`src/f${String(index).padStart(2, "0")}.ts`, `f${index}`]),
    );
    const deleteLocally = (local: ReturnType<typeof createMemoryFolder>, from: number, count: number) => {
      for (let index = from; index < from + count; index += 1) {
        local.files.delete(`src/f${String(index).padStart(2, "0")}.ts`);
      }
    };

    function clocked(confirmMass = false) {
      let clock = new Date("2026-10-09T10:00:00.000Z").getTime();
      const yes = { mass: confirmMass };
      const harness = setup({
        morph,
        confirm: (_summary, why) => why === "startup" || yes.mass,
        now: () => new Date(clock),
      });
      return { ...harness, yes, advance: (ms: number) => (clock += ms) };
    }

    const restoreLocally = (local: ReturnType<typeof createMemoryFolder>, from: number, count: number) => {
      for (let index = from; index < from + count; index += 1) {
        const path = `src/f${String(index).padStart(2, "0")}.ts`;
        local.files.set(path, morph[path]!);
      }
    };

    it("holds a refused deletion until an explicit yes, past the window and a restart", async () => {
      const { workspace, local, session, restart, advance, yes, confirm } = clocked();
      await session.runCycle();
      deleteLocally(local, 0, 12);
      await session.runCycle();
      deleteLocally(local, 12, 4);
      expect((await session.runCycle()).status).toBe("declined");

      // Twenty minutes later the log has expired, and sync was restarted:
      // 4 deletions alone would pass, but they are the ones that were stopped.
      advance(20 * 60_000);
      const later = restart();
      expect((await later.runCycle()).status).toBe("declined");
      expect(confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({ massDeletion: expect.stringMatching(/still need a yes: this would delete 4 files/) }),
        "mass-deletion",
      );
      expect(workspace.files.size).toBe(48);

      yes.mass = true;
      expect((await later.runCycle()).status).toBe("applied");
      expect(workspace.files.size).toBe(44);
    });

    it("lets the stop go once the stopped files are back, deleting nothing", async () => {
      const { workspace, local, session, saved } = clocked();
      await session.runCycle();
      deleteLocally(local, 0, 12);
      await session.runCycle();
      deleteLocally(local, 12, 4);
      expect((await session.runCycle()).status).toBe("declined");
      restoreLocally(local, 12, 4);
      expect((await session.runCycle()).status).toBe("applied");
      expect(workspace.files.size).toBe(48);
      expect(saved.at(-1)!.deletionHold).toBeUndefined();
    });

    it("takes the share of the files there were when the window opened", async () => {
      const { workspace, local, session } = clocked();
      await session.runCycle();
      deleteLocally(local, 0, 12);
      await session.runCycle();
      // Forty new files would put 16 deletions under a quarter of 88.
      for (let index = 0; index < 40; index += 1) local.files.set(`src/new${index}.ts`, `n${index}`);
      expect((await session.runCycle()).status).toBe("applied");
      deleteLocally(local, 12, 4);
      expect((await session.runCycle()).status).toBe("declined");
      expect(workspace.files.size).toBe(88);
    });

    it("stops once the deletions add up, though each batch was small", async () => {
      const { workspace, local, session, confirm, advance } = clocked();
      await session.runCycle();
      // 4, 8, 12 of 60: each under a quarter.
      for (const from of [0, 4, 8]) {
        advance(60_000);
        deleteLocally(local, from, 4);
        expect((await session.runCycle()).status).toBe("applied");
      }
      expect(workspace.files.size).toBe(48);
      // 16 of 60 is over a quarter, though this batch is only 4.
      advance(60_000);
      deleteLocally(local, 12, 4);
      expect((await session.runCycle()).status).toBe("declined");
      expect(confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          massDeletion: expect.stringMatching(/4 more files from the workspace, 16 in the last 15 minutes/),
        }),
        "mass-deletion",
      );
      expect(workspace.files.size).toBe(48);
    });

    it("keeps counting across a restart", async () => {
      const { workspace, local, session, restart } = clocked();
      await session.runCycle();
      deleteLocally(local, 0, 12);
      expect((await session.runCycle()).status).toBe("applied");
      const again = restart();
      deleteLocally(local, 12, 4);
      expect((await again.runCycle()).status).toBe("declined");
      expect(workspace.files.size).toBe(48);
    });

    it("lets deletions older than the window go", async () => {
      const { workspace, local, session, advance } = clocked();
      await session.runCycle();
      deleteLocally(local, 0, 12);
      await session.runCycle();
      advance(16 * 60_000);
      deleteLocally(local, 12, 6);
      expect((await session.runCycle()).status).toBe("applied");
      expect(workspace.files.size).toBe(42);
    });

    it("starts the count over once the developer approves", async () => {
      const { workspace, local, session } = clocked(true);
      await session.runCycle();
      deleteLocally(local, 0, 24);
      expect((await session.runCycle()).status).toBe("applied");
      expect(workspace.files.size).toBe(36);
      deleteLocally(local, 24, 3);
      expect((await session.runCycle()).status).toBe("applied");
    });
  });

  it("applies nothing at startup when the developer declines", async () => {
    const { workspace, local, session } = setup({
      morph: { "a.tsx": "morph" },
      local: { "a.tsx": "local", "new.tsx": "new" },
      confirm: () => false,
    });
    const result = await session.runCycle();
    expect(result.status).toBe("declined");
    expect(workspace.saves).toEqual([]);
    expect(local.files.get("a.tsx")).toBe("local");
  });

  it("leaves Morph's binary files and platform files out", async () => {
    const { workspace, local, session } = setup({
      morph: { "a.tsx": "x", "src/routeTree.gen.ts": "generated" },
      local: { "__entry.tsx": "platform" },
    });
    workspace.addBinary("src/assets/photo.png");
    const result = await session.runCycle();
    expect(result.summary.binarySkipped).toEqual(["src/assets/photo.png"]);
    expect(local.files.has("src/routeTree.gen.ts")).toBe(false);
    expect(workspace.files.has("__entry.tsx")).toBe(false);
  });
});
