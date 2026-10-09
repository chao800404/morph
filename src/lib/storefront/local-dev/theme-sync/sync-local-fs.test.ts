import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalSyncFolder, isIgnored, parseMorphIgnore } from "./sync-local-fs";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "morph-sync-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function put(path: string, content: string | Uint8Array) {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

describe("the local folder on disk", () => {
  it("scans the source it syncs and says what it left out", async () => {
    await put("src/routes/index.tsx", "home");
    await put("package.json", "{}");
    await put("node_modules/react/index.js", "x");
    await put(".env", "SECRET=1");
    await put(".morph/sync-state.json", "{}");
    await put("public/logo.png", new Uint8Array([0x89, 0x50]));
    await put("src/font.bin", new Uint8Array([0xff, 0xfe, 0xfd]));
    await put("src/routeTree.gen.ts", "generated");
    await put("notes/draft.md", "mine");
    await put(".morphignore", "# local notes\nnotes/\n");

    const { files, skipped } = await createLocalSyncFolder(root).scan();
    expect([...files.keys()].sort()).toEqual([
      ".morphignore",
      "package.json",
      "src/routes/index.tsx",
    ]);
    expect(skipped.map((skip) => [skip.path, skip.detail ?? skip.reason]).sort()).toEqual([
      ["public/logo.png", "binary-directory"],
      ["src/font.bin", "not-utf8"],
      ["src/routeTree.gen.ts", "generated"],
    ]);
  });

  it("writes Morph's text in the file's own line endings, leaving no temp file", async () => {
    await put("a.tsx", "one\r\ntwo\r\n");
    const folder = createLocalSyncFolder(root);
    await folder.write("a.tsx", "one\ntwo\nthree\n");
    expect(await readFile(join(root, "a.tsx"), "utf8")).toBe("one\r\ntwo\r\nthree\r\n");
    await folder.write("src/new/b.tsx", "b\n");
    expect(await readFile(join(root, "src/new/b.tsx"), "utf8")).toBe("b\n");
    expect(await readdir(root)).not.toContain("a.tsx.morph-tmp");
  });

  it("moves a deleted file into .morph/trash", async () => {
    await put("src/old.tsx", "old");
    await createLocalSyncFolder(root).remove("src/old.tsx");
    const stamps = await readdir(join(root, ".morph", "trash"));
    expect(stamps).toHaveLength(1);
    expect(await readFile(join(root, ".morph", "trash", stamps[0]!, "src", "old.tsx"), "utf8")).toBe(
      "old",
    );
  });

  it("writes and removes the conflict copy beside the file", async () => {
    await put("a.tsx", "mine");
    const folder = createLocalSyncFolder(root);
    await folder.writeConflictCopy("a.tsx", "theirs");
    expect(await readFile(join(root, "a.tsx.morph-remote"), "utf8")).toBe("theirs");
    expect((await folder.scan()).files.has("a.tsx.morph-remote")).toBe(false);
    await folder.removeConflictCopy("a.tsx");
    expect(await readdir(root)).toEqual(["a.tsx"]);
  });
});

describe(".morphignore", () => {
  const rules = parseMorphIgnore("# c\nexact.ts\ndrafts/\n*.log\n./lead.ts\n");

  it.each([
    ["exact.ts", true],
    ["drafts/a.ts", true],
    ["src/debug.log", true],
    ["lead.ts", true],
    ["src/exact.ts", false],
    ["draftsx/a.ts", false],
  ])("%s ignored: %s", (path, ignored) => {
    expect(isIgnored(path, rules)).toBe(ignored);
  });
});
