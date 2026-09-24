// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  servePreviewMedia,
  signPreviewMediaAssets,
  type PreviewMediaAsset,
} from "./preview-media-delivery";

const SECRET = "test-secret";
const NOW = Date.UTC(2026, 8, 24, 10, 17);
const IMAGE = {
  id: "43a43262-4ff6-46ee-a52b-02cdbafbabc6",
  type: "image",
  metadata: { r2Key: "assets/43a43262-4ff6-46ee-a52b-02cdbafbabc6.png" },
};
const MODEL = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "model",
  metadata: { r2Key: "assets/11111111-1111-4111-8111-111111111111.glb" },
};

async function addressFor(asset: PreviewMediaAsset) {
  const { urls } = await signPreviewMediaAssets([asset.id], {
    origin: "https://morph.example",
    secret: SECRET,
    now: NOW,
    findAssets: async () => [asset],
  });
  return urls.get(asset.id)!;
}

const object = {
  body: new Blob(["png-bytes"]).stream(),
  httpEtag: '"etag-1"',
  httpMetadata: { contentType: "image/png" },
};

function serve(
  url: string,
  options: {
    asset?: PreviewMediaAsset | null;
    method?: string;
    headers?: HeadersInit;
  } = {},
) {
  const getObject = vi.fn(async () => ({
    ...object,
    body: new Blob(["png-bytes"]).stream(),
  }));
  return {
    getObject,
    response: servePreviewMedia(
      new Request(url, { method: options.method, headers: options.headers }),
      {
        secret: SECRET,
        now: NOW,
        findAsset: async () =>
          options.asset === undefined ? IMAGE : options.asset,
        getObject,
      },
    ),
  };
}

describe("signPreviewMediaAssets", () => {
  it("signs only images and videos the library still has", async () => {
    const { urls } = await signPreviewMediaAssets(
      [IMAGE.id, MODEL.id, "22222222-2222-4222-8222-222222222222"],
      {
        origin: "https://morph.example",
        secret: SECRET,
        now: NOW,
        findAssets: async () => [IMAGE, MODEL],
      },
    );
    expect([...urls.keys()]).toEqual([IMAGE.id]);
  });
});

describe("servePreviewMedia", () => {
  it("serves the bytes a signed address names", async () => {
    const response = await serve(await addressFor(IMAGE)).response;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("png-bytes");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "cross-origin",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
  });

  it("refuses a forged address without touching storage", async () => {
    const url = new URL(await addressFor(IMAGE));
    url.searchParams.set("signature", "AAAA");
    const { response, getObject } = serve(url.toString());
    expect((await response).status).toBe(403);
    expect(getObject).not.toHaveBeenCalled();
  });

  it("stops serving an asset once it is replaced or deleted", async () => {
    const url = await addressFor(IMAGE);
    const replaced = serve(url, {
      asset: { ...IMAGE, metadata: { r2Key: "assets/replacement.png" } },
    });
    expect((await replaced.response).status).toBe(404);
    expect(replaced.getObject).not.toHaveBeenCalled();
    expect((await serve(url, { asset: null }).response).status).toBe(404);
  });

  it("answers HEAD and conditional requests without a body", async () => {
    const url = await addressFor(IMAGE);
    const head = await serve(url, { method: "HEAD" }).response;
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const cached = await serve(url, {
      headers: { "if-none-match": '"etag-1"' },
    }).response;
    expect(cached.status).toBe(304);
    expect((await serve(url, { method: "POST" }).response).status).toBe(405);
  });
});
