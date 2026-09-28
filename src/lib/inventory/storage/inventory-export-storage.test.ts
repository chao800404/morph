import { describe, expect, it } from "vitest";
import {
  R2InventoryExportStorage,
  type InventoryExportR2Bucket,
} from "./inventory-export-storage";

const transactionId = "c31f09f6-8d9b-4f3e-94d8-047bb63376e2";

describe("R2 inventory export storage", () => {
  it("uses conditional writes to reject stale execution updates", async () => {
    const objects = new Map<string, { contents: string; etag: string }>();
    let revision = 0;
    const bucket: InventoryExportR2Bucket = {
      async put(key, value, options) {
        const existing = objects.get(key);
        if (
          options?.onlyIf?.etagDoesNotMatch === "*" &&
          existing !== undefined
        ) {
          return null;
        }
        if (
          options?.onlyIf?.etagMatches !== undefined &&
          existing?.etag !== options.onlyIf.etagMatches
        ) {
          return null;
        }
        const contents =
          typeof value === "string"
            ? value
            : new TextDecoder("utf-8", { ignoreBOM: true }).decode(
                await new Response(value).arrayBuffer(),
              );
        const etag = `etag-${++revision}`;
        objects.set(key, { contents, etag });
        return { etag };
      },
      async get(key) {
        const object = objects.get(key);
        if (!object) return null;
        return {
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(object.contents));
              controller.close();
            },
          }),
          etag: object.etag,
          size: new TextEncoder().encode(object.contents).byteLength,
          text: async () => object.contents,
        };
      },
      async delete(key) {
        objects.delete(key);
      },
    };
    const storage = new R2InventoryExportStorage(bucket);
    const first = {
      version: 1 as const,
      id: transactionId,
      ownerId: "admin-1",
      status: "pending" as const,
      filters: { sortBy: "createdAt" as const, sortOrder: "desc" as const },
      createdAt: "2026-09-28T01:00:00.000Z",
      updatedAt: "2026-09-28T01:00:00.000Z",
      processedItems: 0,
      totalItems: null,
      fileKey: null,
      expiresAt: null,
      error: null,
    };

    expect(await storage.createExecution(first)).toBe(true);
    expect(await storage.createExecution(first)).toBe(false);
    const loaded = await storage.getExecution(transactionId);
    expect(loaded?.execution.status).toBe("pending");
    expect(loaded).not.toBeNull();

    const updated = { ...first, status: "running" as const };
    expect(
      await storage.compareAndSwapExecution(
        transactionId,
        "stale-etag",
        updated,
      ),
    ).toBe(false);
    expect(
      await storage.compareAndSwapExecution(
        transactionId,
        loaded!.etag,
        updated,
      ),
    ).toBe(true);
    expect((await storage.getExecution(transactionId))?.execution.status).toBe(
      "running",
    );
  });
});
