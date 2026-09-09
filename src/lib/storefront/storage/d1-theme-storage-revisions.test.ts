/**
 * Every deletion leaves a way back, and ordinary saves do not bury it.
 *
 * The workspace reached a state where deleting a file recorded nothing at all:
 * `deleteFile` bumped the source generation and moved on, and saves only
 * recorded a revision when a caller happened to ask. A theme edited normally
 * therefore had a history that stopped weeks earlier, and the file someone had
 * just deleted was in none of it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listFiles: vi.fn(),
  getLatestRevisionAt: vi.fn(),
  deleteFile: vi.fn(),
  saveFile: vi.fn(),
  saveFilesBatch: vi.fn(),
  putImmutable: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { R2_BUCKET: { put: vi.fn(), get: vi.fn() } },
}));
vi.mock("@/lib/storefront/dal/storefront-theme-build.dal", () => ({
  storefrontThemeBuildDal: {},
}));
vi.mock("@/lib/storefront/dal/storefront-theme-file.dal", () => ({
  buildFileTree: vi.fn(() => []),
  storefrontThemeFileDal: {
    listFiles: mocks.listFiles,
    getLatestRevisionAt: mocks.getLatestRevisionAt,
    deleteFile: mocks.deleteFile,
    saveFile: mocks.saveFile,
    saveFilesBatch: mocks.saveFilesBatch,
  },
}));
vi.mock("./cloudflare-r2-theme-source-blob-store", () => ({
  CloudflareR2ThemeSourceBlobStore: class {
    putImmutable = mocks.putImmutable;
    getImmutable = vi.fn();
  },
  calculateThemeSourceSha256: () => "a".repeat(64),
}));

import { d1ThemeSourceStore } from "./d1-theme-storage";

const workspace = [
  {
    id: "f1",
    storefrontId: "s",
    themeId: "t",
    path: "src/components/Header.tsx",
    content: "export default function Header() { return null; }",
    mimeType: "text/typescript",
    isEntry: false,
    version: 1,
    createdAt: "",
    updatedAt: "",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listFiles.mockResolvedValue(workspace);
  mocks.deleteFile.mockResolvedValue(true);
  mocks.saveFile.mockResolvedValue({ path: "src/components/Header.tsx" });
  mocks.saveFilesBatch.mockResolvedValue([]);
  mocks.putImmutable.mockResolvedValue(undefined);
});

const deleteHeader = () =>
  d1ThemeSourceStore.deleteFile("s", "t", "src/components/Header.tsx", "f1", 1, {
    expectedSourceGeneration: 3,
  });

describe("deleting a file", () => {
  it("records a revision, whatever the caller asked for", async () => {
    await deleteHeader();

    const options = mocks.deleteFile.mock.calls[0]?.[5];
    expect(options.createRevision).toBe(true);
  });

  it("records the workspace with the file still in it", async () => {
    // A snapshot taken after the deletion could never bring the file back.
    await deleteHeader();

    const options = mocks.deleteFile.mock.calls[0]?.[5];
    expect(
      options.sourceManifest.files.map((file: { path: string }) => file.path),
    ).toEqual(["src/components/Header.tsx"]);
  });

  it("names the file in the revision message", async () => {
    await deleteHeader();

    expect(mocks.deleteFile.mock.calls[0]?.[5].revisionMessage).toBe(
      "Before deleting src/components/Header.tsx",
    );
  });

  it("still deletes when the workspace cannot be snapshotted", async () => {
    // Losing the history is bad; refusing the deletion the author asked for
    // because of it would be worse.
    mocks.listFiles.mockResolvedValue([]);

    await expect(deleteHeader()).resolves.toBe(true);
    expect(mocks.deleteFile.mock.calls[0]?.[5].createRevision).toBe(false);
  });

  it("does not consult the throttle", async () => {
    mocks.getLatestRevisionAt.mockResolvedValue(new Date().toISOString());

    await deleteHeader();

    expect(mocks.getLatestRevisionAt).not.toHaveBeenCalled();
    expect(mocks.deleteFile.mock.calls[0]?.[5].createRevision).toBe(true);
  });
});

describe("saving a file", () => {
  const save = () =>
    d1ThemeSourceStore.saveFile(
      "s",
      "t",
      "src/components/Header.tsx",
      "next",
      "text/typescript",
      { expectedSourceGeneration: 3 },
    );

  it("records a revision when the history has been quiet", async () => {
    mocks.getLatestRevisionAt.mockResolvedValue(
      new Date(Date.now() - 120_000).toISOString(),
    );

    await save();

    expect(mocks.saveFile.mock.calls[0]?.[5].createRevision).toBe(true);
  });

  it("skips one when a revision was just taken", async () => {
    mocks.getLatestRevisionAt.mockResolvedValue(new Date().toISOString());

    await save();

    expect(mocks.saveFile.mock.calls[0]?.[5].createRevision).toBe(false);
    expect(mocks.saveFile.mock.calls[0]?.[5].sourceManifest).toBeUndefined();
  });

  it("records the first save of a workspace with no history at all", async () => {
    mocks.getLatestRevisionAt.mockResolvedValue(null);

    await save();

    expect(mocks.saveFile.mock.calls[0]?.[5].createRevision).toBe(true);
  });
});

describe("a batch that removes files", () => {
  it("is treated as a deletion rather than a throttled save", async () => {
    // Deleting a folder goes through the batch path; throttling it would make
    // folder deletion the one unrecoverable act left.
    mocks.getLatestRevisionAt.mockResolvedValue(new Date().toISOString());
    // A second file, so the workspace is not emptied by the deletion.
    mocks.listFiles.mockResolvedValue([
      ...workspace,
      { ...workspace[0]!, id: "f2", path: "src/components/Footer.tsx" },
    ]);

    await d1ThemeSourceStore.saveFilesBatch("s", "t", [], {
      expectedSourceGeneration: 3,
      deletions: [
        { path: "src/components/Header.tsx", expectedFileId: "f1", expectedVersion: 1 },
      ],
    });

    expect(mocks.saveFilesBatch.mock.calls[0]?.[3].createRevision).toBe(true);
  });
});
