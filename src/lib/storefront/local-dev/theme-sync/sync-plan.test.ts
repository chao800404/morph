import { describe, expect, it } from "vitest";
import {
  massDeletionWarning,
  planSync,
  remoteChangedTextPaths,
  type SyncBaseEntry,
  type SyncRemoteEntry,
} from "./sync-plan";

const ID = "11111111-1111-4111-8111-111111111111";
const base = (version: number, hash: string): SyncBaseEntry => ({ id: ID, version, hash });
const remote = (version: number, kind: "text" | "binary" = "text"): SyncRemoteEntry => ({
  id: ID,
  version,
  kind,
});

function plan(input: {
  base?: SyncBaseEntry;
  local?: string;
  remote?: SyncRemoteEntry;
  remoteHash?: string;
}) {
  return planSync({
    base: new Map(input.base ? [["a.ts", input.base]] : []),
    local: new Map(input.local ? [["a.ts", { hash: input.local }]] : []),
    remote: new Map(input.remote ? [["a.ts", input.remote]] : []),
    remoteHashes: new Map(input.remoteHash ? [["a.ts", input.remoteHash]] : []),
  });
}

describe("the three-way sync plan", () => {
  it("does nothing when neither side moved from the base", () => {
    expect(plan({ base: base(3, "h1"), local: "h1", remote: remote(3) })).toEqual([]);
  });

  it("uploads a local edit against the workspace version it was based on", () => {
    expect(plan({ base: base(3, "h1"), local: "h2", remote: remote(3) })).toEqual([
      { kind: "upload", path: "a.ts", expect: { id: ID, version: 3 } },
    ]);
  });

  it("uploads a new local file expecting the workspace to have none", () => {
    expect(plan({ local: "h1" })).toEqual([{ kind: "upload", path: "a.ts", expect: null }]);
  });

  it("deletes from the workspace what was deleted locally, at its version", () => {
    expect(plan({ base: base(3, "h1"), remote: remote(3) })).toEqual([
      { kind: "delete-remote", path: "a.ts", remote: { id: ID, version: 3 } },
    ]);
  });

  it("downloads a workspace edit", () => {
    expect(
      plan({ base: base(3, "h1"), local: "h1", remote: remote(4), remoteHash: "h2" }),
    ).toEqual([{ kind: "download", path: "a.ts", remote: { id: ID, version: 4 } }]);
  });

  it("downloads a file that only the workspace has", () => {
    expect(plan({ remote: remote(1), remoteHash: "h1" })).toEqual([
      { kind: "download", path: "a.ts", remote: { id: ID, version: 1 } },
    ]);
  });

  it("deletes locally what the workspace deleted, when it was not edited here", () => {
    expect(plan({ base: base(3, "h1"), local: "h1" })).toEqual([
      { kind: "delete-local", path: "a.ts" },
    ]);
  });

  it("adopts a workspace version whose text is what the folder already has", () => {
    expect(
      plan({ base: base(3, "h1"), local: "h1", remote: remote(4), remoteHash: "h1" }),
    ).toEqual([{ kind: "adopt", path: "a.ts", entry: { id: ID, version: 4, hash: "h1" } }]);
  });

  it("adopts the same edit made on both sides instead of calling it a conflict", () => {
    expect(
      plan({ base: base(3, "h1"), local: "h2", remote: remote(4), remoteHash: "h2" }),
    ).toEqual([{ kind: "adopt", path: "a.ts", entry: { id: ID, version: 4, hash: "h2" } }]);
  });

  it("calls two different edits a conflict and copies neither over the other", () => {
    expect(
      plan({ base: base(3, "h1"), local: "h2", remote: remote(4), remoteHash: "h3" }),
    ).toEqual([
      { kind: "conflict", path: "a.ts", reason: "both-changed", remote: { id: ID, version: 4 } },
    ]);
  });

  it("calls a local edit of a file the workspace deleted a conflict", () => {
    expect(plan({ base: base(3, "h1"), local: "h2" })).toEqual([
      { kind: "conflict", path: "a.ts", reason: "remote-deleted", remote: null },
    ]);
  });

  it("calls a workspace edit of a file deleted locally a conflict", () => {
    expect(plan({ base: base(3, "h1"), remote: remote(4), remoteHash: "h2" })).toEqual([
      { kind: "conflict", path: "a.ts", reason: "local-deleted", remote: { id: ID, version: 4 } },
    ]);
  });

  it("treats two different files at one path on first link as a conflict", () => {
    expect(plan({ local: "h1", remote: remote(1), remoteHash: "h2" })).toEqual([
      { kind: "conflict", path: "a.ts", reason: "both-changed", remote: { id: ID, version: 1 } },
    ]);
  });

  it("forgets a file both sides deleted", () => {
    expect(plan({ base: base(3, "h1") })).toEqual([{ kind: "forget", path: "a.ts" }]);
  });

  it("leaves binary workspace files alone", () => {
    expect(plan({ local: "h1", remote: remote(1, "binary") })).toEqual([
      { kind: "skip-binary", path: "a.ts" },
    ]);
  });

  it("sees a file recreated under a new id as a workspace change", () => {
    const recreated = { ...remote(1), id: "22222222-2222-4222-8222-222222222222" };
    expect(
      remoteChangedTextPaths(new Map([["a.ts", base(3, "h1")]]), new Map([["a.ts", recreated]])),
    ).toEqual(["a.ts"]);
  });

  it("refuses to plan a moved workspace file it was not given the text of", () => {
    expect(() => plan({ base: base(3, "h1"), local: "h1", remote: remote(4) })).toThrow(
      "SYNC_PLAN_UNREAD_REMOTE",
    );
  });
});

describe("the mass-deletion check", () => {
  const deletions = (kind: "delete-remote" | "delete-local", count: number) =>
    Array.from({ length: count }, (_, index) =>
      kind === "delete-remote"
        ? { kind, path: `f${index}`, remote: { id: ID, version: 1 } }
        : { kind, path: `f${index}` },
    );

  it("stops a plan made from an emptied local folder", () => {
    expect(
      massDeletionWarning({ actions: [], baseCount: 40, localCount: 0, remoteTextCount: 40 }),
    ).toMatch(/local folder/);
  });

  it("stops a plan made from an emptied workspace", () => {
    expect(
      massDeletionWarning({ actions: [], baseCount: 40, localCount: 40, remoteTextCount: 0 }),
    ).toMatch(/workspace/);
  });

  it("stops many deletions at once", () => {
    expect(
      massDeletionWarning({
        actions: deletions("delete-remote", 20),
        baseCount: 60,
        localCount: 40,
        remoteTextCount: 60,
      }),
    ).toMatch(/delete 20 files from the workspace/);
  });

  it("lets a few deletions through", () => {
    expect(
      massDeletionWarning({
        actions: deletions("delete-local", 3),
        baseCount: 60,
        localCount: 60,
        remoteTextCount: 57,
      }),
    ).toBeNull();
  });

  it("has nothing to compare against before the first sync", () => {
    expect(
      massDeletionWarning({ actions: [], baseCount: 0, localCount: 0, remoteTextCount: 10 }),
    ).toBeNull();
  });
});
