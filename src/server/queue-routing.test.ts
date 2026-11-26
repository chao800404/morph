import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_INVENTORY_EXPORT_QUEUE_NAME,
  DEFAULT_THEME_BUILD_QUEUE_NAME,
  dispatchQueueBatch,
  selectQueueConsumer,
} from "./queue-routing";

/**
 * Which consumer a queue batch reaches, by the queue's name.
 *
 * Queue names are unique per Cloudflare account, so a second deployment in
 * the production account (staging) has to rename both queues. The names it
 * routes by come from configuration; a name that matches neither is refused,
 * never handed to a consumer that would acknowledge its messages away.
 */
function batch(queue: string | undefined) {
  const ack = vi.fn();
  return { batch: { queue, messages: [{ body: { version: 1 }, ack }] }, ack };
}

function consumers() {
  return {
    inventoryExport: vi.fn(async () => {}),
    themeBuild: vi.fn(async () => {}),
  };
}

describe("selectQueueConsumer", () => {
  it("routes today's queue names exactly as before when nothing is configured", () => {
    expect(DEFAULT_INVENTORY_EXPORT_QUEUE_NAME).toBe("morph-inventory-exports");
    expect(DEFAULT_THEME_BUILD_QUEUE_NAME).toBe("morph-theme-builds");
    expect(selectQueueConsumer("morph-inventory-exports", {})).toEqual({
      consumer: "inventory-export",
    });
    expect(selectQueueConsumer("morph-theme-builds", {})).toEqual({
      consumer: "theme-build",
    });
    expect(selectQueueConsumer("morph-theme-builds", undefined)).toEqual({
      consumer: "theme-build",
    });
  });

  it("routes by the configured names", () => {
    const env = {
      MORPH_INVENTORY_EXPORT_QUEUE_NAME: "morph-stg-m1-inventory-exports",
      MORPH_THEME_BUILD_QUEUE_NAME: "morph-stg-m1-theme-builds",
    };
    expect(selectQueueConsumer("morph-stg-m1-inventory-exports", env)).toEqual({
      consumer: "inventory-export",
    });
    expect(selectQueueConsumer("morph-stg-m1-theme-builds", env)).toEqual({
      consumer: "theme-build",
    });
  });

  it("a configured name replaces the default rather than adding to it", () => {
    const env = {
      MORPH_INVENTORY_EXPORT_QUEUE_NAME: "morph-stg-m1-inventory-exports",
      MORPH_THEME_BUILD_QUEUE_NAME: "morph-stg-m1-theme-builds",
    };
    expect(selectQueueConsumer("morph-inventory-exports", env)).toHaveProperty(
      "refused",
    );
    expect(selectQueueConsumer("morph-theme-builds", env)).toHaveProperty(
      "refused",
    );
  });

  it("refuses an unknown queue name instead of giving it to the theme consumer", () => {
    for (const name of [
      "morph-stg-m1-inventory-exports",
      "other",
      "",
      undefined,
    ]) {
      const selected = selectQueueConsumer(name, {});
      expect(selected, String(name)).toHaveProperty("refused");
    }
  });

  it("refuses everything when a configured name is invalid or both names are equal", () => {
    for (const env of [
      { MORPH_INVENTORY_EXPORT_QUEUE_NAME: "" },
      { MORPH_INVENTORY_EXPORT_QUEUE_NAME: "Morph_Inventory" },
      { MORPH_THEME_BUILD_QUEUE_NAME: "x".repeat(64) },
      { MORPH_THEME_BUILD_QUEUE_NAME: 7 },
      { MORPH_THEME_BUILD_QUEUE_NAME: "morph-inventory-exports" },
    ]) {
      expect(
        selectQueueConsumer("morph-inventory-exports", env),
        JSON.stringify(env),
      ).toHaveProperty("refused");
      expect(
        selectQueueConsumer("morph-theme-builds", env),
        JSON.stringify(env),
      ).toHaveProperty("refused");
    }
  });
});

describe("dispatchQueueBatch", () => {
  it("hands the default inventory queue to the inventory consumer", async () => {
    const run = consumers();
    const { batch: b } = batch("morph-inventory-exports");
    await dispatchQueueBatch(b, {}, run);
    expect(run.inventoryExport).toHaveBeenCalledWith(b);
    expect(run.themeBuild).not.toHaveBeenCalled();
  });

  it("hands the default theme queue to the theme consumer", async () => {
    const run = consumers();
    const { batch: b } = batch("morph-theme-builds");
    await dispatchQueueBatch(b, {}, run);
    expect(run.themeBuild).toHaveBeenCalledWith(b);
    expect(run.inventoryExport).not.toHaveBeenCalled();
  });

  it("hands a configured inventory queue to the inventory consumer", async () => {
    const run = consumers();
    const { batch: b } = batch("morph-stg-m1-inventory-exports");
    await dispatchQueueBatch(
      b,
      { MORPH_INVENTORY_EXPORT_QUEUE_NAME: "morph-stg-m1-inventory-exports" },
      run,
    );
    expect(run.inventoryExport).toHaveBeenCalledWith(b);
    expect(run.themeBuild).not.toHaveBeenCalled();
  });

  it("throws for an unknown queue, so its messages are retried and never acknowledged", async () => {
    const run = consumers();
    const { batch: b, ack } = batch("morph-stg-m1-inventory-exports");
    await expect(dispatchQueueBatch(b, {}, run)).rejects.toThrow(
      /morph-stg-m1-inventory-exports/,
    );
    expect(run.inventoryExport).not.toHaveBeenCalled();
    expect(run.themeBuild).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled();
  });
});
