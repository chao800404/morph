// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalPreviewStagingError,
  LocalVitePreviewServer,
} from "./local-vite-preview-server";

/**
 * The local preview's staging of binary files, which holds only verified
 * bytes, outside every workspace, and never grows without bound. No dev
 * server is started here; staging does not need one.
 */

const ROOT = path.join(process.cwd(), ".morph-previews-staging-test");
const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const bytesOf = (size: number, fill: number) => new Uint8Array(size).fill(fill);

function server(
  options: ConstructorParameters<typeof LocalVitePreviewServer>[0] = {},
) {
  return new LocalVitePreviewServer({ workspacesRoot: ROOT, ...options });
}

const stagingDir = (previewId: string) =>
  path.join(ROOT, ".binary-staging", previewId);
const staged = async (previewId: string) =>
  (await fs.readdir(stagingDir(previewId)).catch(() => [] as string[])).sort();

async function stage(
  target: LocalVitePreviewServer,
  previewId: string,
  bytes: Uint8Array,
) {
  return target.stageBinary({
    previewId,
    digest: sha256(bytes),
    sizeBytes: bytes.byteLength,
    bytes,
  });
}

/** Moves a file's modification time into the past. */
async function age(file: string, milliseconds: number) {
  const then = new Date(Date.now() - milliseconds);
  await fs.utimes(file, then, then);
}

beforeEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});
afterEach(async () => {
  await fs.rm(ROOT, { recursive: true, force: true });
});

describe("staging binary files for a local preview", () => {
  it("refuses a preview id it would have had to rewrite", async () => {
    const target = server();
    for (const previewId of [
      "../escape",
      ".hidden",
      "a b",
      "",
      "x".repeat(121),
    ]) {
      await expect(
        stage(target, previewId, bytesOf(8, 1)),
        previewId,
      ).rejects.toBeInstanceOf(LocalPreviewStagingError);
    }
    await expect(
      fs.access(path.join(ROOT, ".binary-staging")),
    ).rejects.toThrow();
  });

  it("evicts the oldest files to stay under its byte limit", async () => {
    const target = server({ maxStagedBytes: 100 });
    const first = bytesOf(40, 1);
    const second = bytesOf(40, 2);
    const third = bytesOf(40, 3);
    await stage(target, "p", first);
    await age(path.join(stagingDir("p"), sha256(first)), 3_000);
    await stage(target, "p", second);
    await age(path.join(stagingDir("p"), sha256(second)), 2_000);
    await stage(target, "p", third);

    // 120 bytes would not fit; the oldest went.
    expect(await staged("p")).toEqual([sha256(second), sha256(third)].sort());
  });

  it("removes files not staged again in time, and temporary files left behind", async () => {
    const target = server({ stagedTtlMs: 60_000, staleTempMs: 60_000 });
    const old = bytesOf(16, 1);
    await stage(target, "p", old);
    await age(path.join(stagingDir("p"), sha256(old)), 120_000);
    const leftover = path.join(stagingDir("p"), `.${"a".repeat(64)}.x.tmp`);
    await fs.writeFile(leftover, "partial");
    await age(leftover, 120_000);
    const recentTemp = path.join(stagingDir("p"), `.${"b".repeat(64)}.y.tmp`);
    await fs.writeFile(recentTemp, "in flight");

    const fresh = bytesOf(16, 2);
    await stage(target, "p", fresh);

    // The stale ones are gone; a temporary file still being written is not.
    expect(await staged("p")).toEqual(
      [sha256(fresh), path.basename(recentTemp)].sort(),
    );
  });

  it("keeps staging to one preview's directory", async () => {
    const target = server();
    await stage(target, "p", bytesOf(8, 1));
    await stage(target, "q", bytesOf(8, 2));
    expect(await staged("p")).toEqual([sha256(bytesOf(8, 1))]);
    expect(await staged("q")).toEqual([sha256(bytesOf(8, 2))]);
  });
});
