// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  classifyWorkspacePath,
  diffWorkspaceFileDigests,
  enterPreviewStart,
  parseWorkspaceFileDigests,
  previewAddressDigest,
  workspaceFileDigests,
} from "./preview-server-observation";

const SOURCE = new Set(["src/routes/index.tsx", "src/components/Hero.tsx"]);

describe("workspaceFileDigests", () => {
  it("changes a file's digest exactly when its bytes change", () => {
    const before = workspaceFileDigests([
      { path: "/workspace/a.ts", content: "a" },
      { path: "/workspace/b.ts", content: new Uint8Array([1, 2]) },
    ]);
    const after = workspaceFileDigests([
      { path: "/workspace/a.ts", content: "a" },
      { path: "/workspace/b.ts", content: new Uint8Array([1, 3]) },
    ]);
    expect(after["/workspace/a.ts"]).toBe(before["/workspace/a.ts"]);
    expect(after["/workspace/b.ts"]).not.toBe(before["/workspace/b.ts"]);
  });
});

describe("classifyWorkspacePath", () => {
  it("tells the content snapshot, the author's source and platform files apart", () => {
    expect(
      classifyWorkspacePath("/workspace/src/morph/preview-content.ts", SOURCE),
    ).toBe("preview-content");
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
        "/workspace/src/morph/preview-content.ts": "c1",
        "/workspace/src/routes/index.tsx": "r1",
        "/workspace/old.ts": "o1",
      },
      {
        "/workspace/src/morph/preview-content.ts": "c2",
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
        "/workspace/src/morph/preview-content.ts",
      ],
    });
  });

  it("says when there was nothing to compare with", () => {
    expect(
      diffWorkspaceFileDigests(null, { "/workspace/a": "x" }, SOURCE),
    ).toMatchObject({ comparable: false, added: 0, changed: 0 });
  });
});

describe("parseWorkspaceFileDigests", () => {
  it("reads a manifest and distrusts anything else", () => {
    expect(parseWorkspaceFileDigests('{"/workspace/a":"x"}')).toEqual({
      "/workspace/a": "x",
    });
    expect(parseWorkspaceFileDigests("dirty")).toBeNull();
    expect(parseWorkspaceFileDigests('{"/workspace/a":1}')).toBeNull();
    expect(parseWorkspaceFileDigests("[]")).toBeNull();
    expect(parseWorkspaceFileDigests(null)).toBeNull();
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
