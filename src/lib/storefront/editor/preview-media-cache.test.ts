// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPreviewMediaCache } from "./preview-media-cache";

const A = "43a43262-4ff6-46ee-a52b-02cdbafbabc6";
const GONE = "00000000-0000-4000-8000-000000000000";
const HOUR = 60 * 60 * 1000;

const props = (id: string) => ({
  image: {
    src: {
      source: "asset",
      mediaType: "image",
      assetId: id,
      url: `/assets/${id}.png`,
    },
    alt: "",
  },
});

describe("createPreviewMediaCache", () => {
  it("reports an asset it does not hold, and applies it once signed", async () => {
    const sign = vi.fn(async () => ({
      urls: { [A]: "https://morph.example/signed-a" },
      expiresAt: 25 * HOUR,
    }));
    const cache = createPreviewMediaCache({ sign, now: () => 0 });

    const first = cache.resolve(props(A));
    expect(first.missing).toEqual([A]);
    expect(first.content).toEqual(props(A));

    await cache.ensure(first.missing);
    expect(cache.resolve(props(A))).toEqual({
      content: { image: { src: "https://morph.example/signed-a", alt: "" } },
      missing: [],
    });
  });

  it("asks once for edits that arrive while a signature is pending", async () => {
    let finish!: () => void;
    const sign = vi.fn(
      () =>
        new Promise<{ urls: Record<string, string>; expiresAt: number }>(
          (resolve) =>
            (finish = () =>
              resolve({ urls: { [A]: "signed" }, expiresAt: 25 * HOUR })),
        ),
    );
    const cache = createPreviewMediaCache({ sign, now: () => 0 });
    const first = cache.ensure([A]);
    const second = cache.ensure([A]);
    finish();
    await Promise.all([first, second]);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it("remembers an asset it cannot sign for a while", async () => {
    let now = 0;
    const sign = vi.fn(async () => ({ urls: {}, expiresAt: 25 * HOUR }));
    const cache = createPreviewMediaCache({ sign, now: () => now });

    await cache.ensure([GONE]);
    expect(cache.resolve(props(GONE)).missing).toEqual([]);
    now = 6 * 60 * 1000;
    expect(cache.resolve(props(GONE)).missing).toEqual([GONE]);
  });

  it("asks again before a held address runs out", async () => {
    let now = 0;
    const sign = vi.fn(async () => ({
      urls: { [A]: "signed" },
      expiresAt: 25 * HOUR,
    }));
    const cache = createPreviewMediaCache({ sign, now: () => now });

    await cache.ensure([A]);
    now = 23 * HOUR;
    expect(cache.resolve(props(A)).missing).toEqual([]);
    now = 24 * HOUR + 1;
    expect(cache.resolve(props(A)).missing).toEqual([A]);
  });

  it("does not ask the server about ids that are not library ids", async () => {
    const sign = vi.fn();
    const cache = createPreviewMediaCache({ sign, now: () => 0 });
    expect(cache.resolve(props("not-a-uuid")).missing).toEqual([]);
    await cache.ensure(["not-a-uuid"]);
    expect(sign).not.toHaveBeenCalled();
  });

  it("keeps working when signing fails", async () => {
    const sign = vi.fn(async () => {
      throw new Error("offline");
    });
    const cache = createPreviewMediaCache({ sign, now: () => 0 });
    await expect(cache.ensure([A])).resolves.toBeUndefined();
    expect(cache.resolve(props(A)).missing).toEqual([A]);
  });
});
