// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyWorkspacePath,
  diffWorkspaceFileDigests,
  enterPreviewStart,
  isContentOnlyChange,
  parseWorkspaceManifest,
  serializeWorkspaceManifest,
  previewAddressDigest,
  workspaceFileDigests,
} from "./preview-server-observation";

const SOURCE = new Set(["src/routes/index.tsx", "src/components/Hero.tsx"]);

describe("workspaceFileDigests", () => {
  it("changes a file's digest exactly when its bytes change", () => {
    // A binary file is known by the digest of its bytes, never the bytes.
    const before = workspaceFileDigests([
      { path: "/workspace/a.ts", content: "a" },
      {
        path: "/workspace/b.png",
        binary: { digest: "a".repeat(64), sizeBytes: 2 },
      },
    ]);
    const after = workspaceFileDigests([
      { path: "/workspace/a.ts", content: "a" },
      {
        path: "/workspace/b.png",
        binary: { digest: "b".repeat(64), sizeBytes: 2 },
      },
    ]);
    expect(after["/workspace/a.ts"]).toBe(before["/workspace/a.ts"]);
    expect(after["/workspace/b.png"]).not.toBe(before["/workspace/b.png"]);
  });
});

describe("classifyWorkspacePath", () => {
  it("tells the content snapshot, the author's source and platform files apart", () => {
    expect(
      classifyWorkspacePath(
        "/workspace/src/morph/preview-content-snapshot.ts",
        SOURCE,
      ),
    ).toBe("preview-content");
    expect(
      classifyWorkspacePath("/workspace/.morph-preview-content.json", SOURCE),
    ).toBe("preview-content");
    // The code that serves the content is the platform's, like the bridge.
    expect(
      classifyWorkspacePath("/workspace/src/morph/preview-content.ts", SOURCE),
    ).toBe("platform");
    expect(
      classifyWorkspacePath("/workspace/src/routes/index.tsx", SOURCE),
    ).toBe("theme-source");
    expect(classifyWorkspacePath("/workspace/vite.config.ts", SOURCE)).toBe(
      "platform",
    );
  });
});

describe("diffWorkspaceFileDigests", () => {
  it("names what was added, removed and changed, by kind", () => {
    const change = diffWorkspaceFileDigests(
      {
        "/workspace/src/morph/preview-content-snapshot.ts": "c1",
        "/workspace/src/routes/index.tsx": "r1",
        "/workspace/old.ts": "o1",
      },
      {
        "/workspace/src/morph/preview-content-snapshot.ts": "c2",
        "/workspace/src/routes/index.tsx": "r1",
        "/workspace/src/components/Hero.tsx": "h1",
      },
      SOURCE,
    );
    expect(change).toEqual({
      comparable: true,
      added: 1,
      removed: 1,
      changed: 1,
      byKind: { "preview-content": 1, "theme-source": 1, platform: 1 },
      samplePaths: [
        "/workspace/old.ts",
        "/workspace/src/components/Hero.tsx",
        "/workspace/src/morph/preview-content-snapshot.ts",
      ],
      paths: [
        "/workspace/old.ts",
        "/workspace/src/components/Hero.tsx",
        "/workspace/src/morph/preview-content-snapshot.ts",
      ],
    });
  });

  it("says when there was nothing to compare with", () => {
    expect(
      diffWorkspaceFileDigests(null, { "/workspace/a": "x" }, SOURCE),
    ).toMatchObject({ comparable: false, added: 0, changed: 0 });
  });
});

describe("parseWorkspaceManifest", () => {
  it("reads a manifest with the fingerprint it was written for", () => {
    expect(
      parseWorkspaceManifest(
        serializeWorkspaceManifest("f1", { "/workspace/a": "x" }),
      ),
    ).toEqual({ fingerprint: "f1", files: { "/workspace/a": "x" } });
  });

  it("reads an older manifest without a fingerprint, so it is never trusted", () => {
    expect(parseWorkspaceManifest('{"/workspace/a":"x"}')).toEqual({
      fingerprint: null,
      files: { "/workspace/a": "x" },
    });
  });

  it("distrusts anything else", () => {
    expect(parseWorkspaceManifest("dirty")).toBeNull();
    expect(parseWorkspaceManifest('{"/workspace/a":1}')).toBeNull();
    expect(parseWorkspaceManifest("[]")).toBeNull();
    expect(parseWorkspaceManifest(null)).toBeNull();
    expect(
      parseWorkspaceManifest('{"format":2,"fingerprint":1,"files":{}}'),
    ).toBeNull();
  });
});

describe("isContentOnlyChange", () => {
  const base = {
    comparable: true,
    added: 0,
    removed: 0,
    changed: 1,
    samplePaths: [],
    paths: [],
  };

  it("is true only when the content snapshot alone changed", () => {
    expect(
      isContentOnlyChange({
        ...base,
        byKind: { "preview-content": 2, "theme-source": 0, platform: 0 },
      }),
    ).toBe(true);
    for (const byKind of [
      { "preview-content": 1, "theme-source": 1, platform: 0 },
      { "preview-content": 1, "theme-source": 0, platform: 1 },
      { "preview-content": 0, "theme-source": 0, platform: 0 },
    ]) {
      expect(isContentOnlyChange({ ...base, byKind })).toBe(false);
    }
  });

  it("is false when files appeared, vanished, or nothing could be compared", () => {
    const byKind = { "preview-content": 1, "theme-source": 0, platform: 0 };
    expect(isContentOnlyChange({ ...base, byKind, added: 1 })).toBe(false);
    expect(isContentOnlyChange({ ...base, byKind, removed: 1 })).toBe(false);
    expect(isContentOnlyChange({ ...base, byKind, comparable: false })).toBe(
      false,
    );
  });
});

describe("previewAddressDigest", () => {
  it("tells addresses apart without writing down the token", () => {
    const first = previewAddressDigest(
      "https://5173-sandbox-tokenaaaa.preview.example.com/",
    );
    const second = previewAddressDigest(
      "https://5173-sandbox-tokenbbbb.preview.example.com/",
    );
    expect(first).not.toBe(second);
    expect(first).not.toContain("tokenaaaa");
    expect(previewAddressDigest("not a url")).toBeNull();
  });
});

describe("enterPreviewStart", () => {
  it("counts the starts already running for the same preview", () => {
    const first = enterPreviewStart("p");
    const second = enterPreviewStart("p");
    const other = enterPreviewStart("q");
    expect([first.concurrentAtEntry, second.concurrentAtEntry]).toEqual([0, 1]);
    expect(other.concurrentAtEntry).toBe(0);
    second.leave();
    second.leave();
    first.leave();
    expect(enterPreviewStart("p").concurrentAtEntry).toBe(0);
  });
});
