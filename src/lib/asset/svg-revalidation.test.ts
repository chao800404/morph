// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AssetDTO } from "@/lib/asset/dto/asset.dto";
import { SVG_VALIDATOR_VERSION } from "@/lib/security/svg-validation";
import {
  restoreLibrarySvgs,
  scanLibrarySvgs,
  SVG_REVALIDATION_BATCH,
  type SvgRevalidationDeps,
} from "./svg-revalidation";

const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>`;
const WITH_DOCTYPE = `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${DRAWING}`;
const SCRIPTED = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`;

type Stored = {
  bytes: Uint8Array;
  etag: string;
  httpMetadata: Record<string, unknown>;
  customMetadata: Record<string, string>;
};

/**
 * R2 as the library uses it: the ETag is a hash of the bytes, so the same
 * bytes written again keep it, and `onlyIf` that fails answers null.
 */
function library() {
  const objects = new Map<string, Stored>();
  const assets = new Map<string, AssetDTO>();
  const etagOf = (bytes: Uint8Array) =>
    createHash("md5").update(bytes).digest("hex");

  const add = (
    id: string,
    text: string,
    customMetadata: Record<string, string> = {},
  ) => {
    const url = `/assets/${id}.svg`;
    assets.set(id, {
      id,
      name: `${id}.svg`,
      url,
      mimeType: "image/svg+xml",
    } as AssetDTO);
    const bytes = new TextEncoder().encode(text);
    objects.set(url.slice(1), {
      bytes,
      etag: etagOf(bytes),
      httpMetadata: { contentType: "image/svg+xml", cacheControl: "private" },
      customMetadata: { originalName: `${id}.svg`, ...customMetadata },
    });
  };

  const view = (stored: Stored) => ({
    etag: stored.etag,
    size: stored.bytes.byteLength,
    httpMetadata: stored.httpMetadata,
    customMetadata: stored.customMetadata,
    arrayBuffer: async () => stored.bytes.slice().buffer,
  });

  const putObject = vi.fn<SvgRevalidationDeps["putObject"]>(
    async (key, bytes, options) => {
      const current = objects.get(key);
      // As R2: with no condition it writes; with one that fails, it answers null.
      if (
        options.onlyIf &&
        (!current || current.etag !== options.onlyIf.etagMatches)
      ) {
        return null;
      }
      objects.set(key, {
        bytes,
        etag: etagOf(bytes),
        httpMetadata: options.httpMetadata ?? {},
        customMetadata: options.customMetadata,
      });
      return {};
    },
  );

  const deps: SvgRevalidationDeps = {
    listSvgPage: async (afterId, limit) =>
      [...assets.values()]
        .filter((asset) => afterId === null || asset.id > afterId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit),
    findAsset: async (id) => assets.get(id) ?? null,
    getObject: async (key) => {
      const stored = objects.get(key);
      return stored ? view(stored) : null;
    },
    putObject,
  };
  return { deps, objects, assets, add, putObject };
}

describe("scanLibrarySvgs", () => {
  it("reports what the current rules say of each file, and writes nothing", async () => {
    const { deps, add, objects, putObject } = library();
    add("a-legacy", DRAWING, { svgValidated: "true" });
    add("b-v1-doctype", WITH_DOCTYPE, { svgValidatorVersion: "1" });
    add("c-current", DRAWING, {
      svgValidatorVersion: String(SVG_VALIDATOR_VERSION),
    });
    add("d-unmarked", SCRIPTED);
    add("e-gone", DRAWING);
    objects.delete("assets/e-gone.svg");

    const page = await scanLibrarySvgs(deps, { after: null });

    expect(
      page.entries.map((entry) => [
        entry.assetId,
        entry.status,
        entry.recorded,
        entry.reason ?? null,
      ]),
    ).toEqual([
      ["a-legacy", "passes", "legacy", null],
      ["b-v1-doctype", "refused", "v1", "doctype"],
      ["c-current", "current", `v${SVG_VALIDATOR_VERSION}`, null],
      ["d-unmarked", "refused", null, "forbidden-element"],
      ["e-gone", "missing", null, null],
    ]);
    expect(page.entries[0]!.etag).toBe(
      objects.get("assets/a-legacy.svg")!.etag,
    );
    expect(page.next).toBeNull();
    expect(putObject).not.toHaveBeenCalled();
  });

  it("walks the library in pages", async () => {
    const { deps, add } = library();
    for (let n = 0; n < SVG_REVALIDATION_BATCH + 3; n += 1) {
      add(`asset-${String(n).padStart(3, "0")}`, DRAWING);
    }
    const first = await scanLibrarySvgs(deps, { after: null });
    expect(first.entries).toHaveLength(SVG_REVALIDATION_BATCH);
    const second = await scanLibrarySvgs(deps, { after: first.next });
    expect(second.entries).toHaveLength(3);
    expect(second.next).toBeNull();
  });

  it("refuses a file over the library's limit without reading it", async () => {
    const { deps, add, objects } = library();
    add("big", DRAWING);
    const stored = objects.get("assets/big.svg")!;
    stored.bytes = new Uint8Array(2 * 1024 * 1024 + 1);
    const page = await scanLibrarySvgs(deps, { after: null });
    expect(page.entries[0]).toMatchObject({
      status: "refused",
      reason: "too-large",
    });
  });
});

describe("restoreLibrarySvgs", () => {
  it("records the current version and keeps every header, metadata value and byte", async () => {
    const { deps, add, objects } = library();
    add("a", DRAWING, { svgValidated: "true", uploadedBy: "user-1" });
    const before = objects.get("assets/a.svg")!;

    const outcomes = await restoreLibrarySvgs(deps, [
      { assetId: "a", etag: before.etag },
    ]);

    expect(outcomes).toEqual([{ assetId: "a", status: "restored" }]);
    const after = objects.get("assets/a.svg")!;
    expect(after.httpMetadata).toEqual(before.httpMetadata);
    expect(after.customMetadata).toEqual({
      originalName: "a.svg",
      svgValidated: "true",
      uploadedBy: "user-1",
      svgValidatorVersion: String(SVG_VALIDATOR_VERSION),
    });
    expect(new TextDecoder().decode(after.bytes)).toBe(DRAWING);
  });

  it("skips a file replaced since the scan", async () => {
    const { deps, add, objects, putObject } = library();
    add("a", DRAWING, { svgValidated: "true" });
    const scanned = objects.get("assets/a.svg")!.etag;
    add("a", DRAWING.replace("0 0 4 4", "0 0 5 5"), { svgValidated: "true" });

    expect(
      await restoreLibrarySvgs(deps, [{ assetId: "a", etag: scanned }]),
    ).toEqual([expect.objectContaining({ assetId: "a", status: "changed" })]);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("checks again rather than trusting the caller that a file passed", async () => {
    const { deps, add, objects, putObject } = library();
    add("scripted", SCRIPTED, { svgValidated: "true" });
    const etag = objects.get("assets/scripted.svg")!.etag;

    const outcomes = await restoreLibrarySvgs(deps, [
      { assetId: "scripted", etag },
    ]);

    expect(outcomes[0]).toMatchObject({ status: "refused" });
    expect(putObject).not.toHaveBeenCalled();
    expect(
      objects.get("assets/scripted.svg")!.customMetadata,
    ).not.toHaveProperty("svgValidatorVersion");
  });

  it("skips an asset deleted since the scan", async () => {
    const { deps, add, assets, objects, putObject } = library();
    add("a", DRAWING);
    const etag = objects.get("assets/a.svg")!.etag;
    assets.delete("a");

    expect(await restoreLibrarySvgs(deps, [{ assetId: "a", etag }])).toEqual([
      { assetId: "a", status: "missing" },
    ]);
    expect(putObject).not.toHaveBeenCalled();
  });

  it("reports a file changed between its check and its write as changed, not restored", async () => {
    const { deps, add, objects } = library();
    add("a", DRAWING);
    const etag = objects.get("assets/a.svg")!.etag;
    const racing: SvgRevalidationDeps = {
      ...deps,
      getObject: async (key) => {
        const view = await deps.getObject(key);
        // Someone replaces the file right after it is read.
        add("a", DRAWING.replace("0 0 4 4", "0 0 6 6"));
        return view;
      },
    };

    expect(await restoreLibrarySvgs(racing, [{ assetId: "a", etag }])).toEqual([
      expect.objectContaining({ status: "changed" }),
    ]);
    expect(objects.get("assets/a.svg")!.customMetadata).not.toHaveProperty(
      "svgValidatorVersion",
    );
  });

  it("reports a failed write as failed", async () => {
    const { deps, add, objects } = library();
    add("a", DRAWING);
    const etag = objects.get("assets/a.svg")!.etag;
    const failing: SvgRevalidationDeps = {
      ...deps,
      putObject: async () => {
        throw new Error("R2 unavailable");
      },
    };
    expect(await restoreLibrarySvgs(failing, [{ assetId: "a", etag }])).toEqual(
      [{ assetId: "a", status: "write-failed", detail: "R2 unavailable" }],
    );
  });

  it("takes one batch at a time", async () => {
    const { deps, add, objects } = library();
    const items = [];
    for (let n = 0; n < SVG_REVALIDATION_BATCH + 5; n += 1) {
      const id = `asset-${n}`;
      add(id, DRAWING);
      items.push({ assetId: id, etag: objects.get(`assets/${id}.svg`)!.etag });
    }
    expect(await restoreLibrarySvgs(deps, items)).toHaveLength(
      SVG_REVALIDATION_BATCH,
    );
  });

  it("restores a file rewritten with the very same bytes, which R2 gives the same ETag", async () => {
    const { deps, add, objects } = library();
    add("a", DRAWING, { svgValidated: "true" });
    const etag = objects.get("assets/a.svg")!.etag;
    add("a", DRAWING, { svgValidated: "true", uploadedBy: "someone-else" });

    expect(await restoreLibrarySvgs(deps, [{ assetId: "a", etag }])).toEqual([
      { assetId: "a", status: "restored" },
    ]);
    // What it keeps is what the file has when restored, not when scanned.
    expect(objects.get("assets/a.svg")!.customMetadata.uploadedBy).toBe(
      "someone-else",
    );
  });
});
