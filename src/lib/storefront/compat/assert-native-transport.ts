import { expect } from "vitest";

type FetchFixture = (path: string, init?: RequestInit) => Promise<Response>;

/** Use Start's generated URLs, never reverse-engineer production function IDs. */
async function functionUrls(request: FetchFixture) {
  const page = await request("/compat-transport");
  expect(page.status).toBe(200);
  const html = await page.text();
  const read = (name: string) => {
    const value = new RegExp(`data-${name}-url="([^"]+)"`).exec(html)?.[1];
    expect(value, `generated ${name} server function URL`).toBeTruthy();
    return value!.replace(/&amp;/g, "&");
  };
  return { raw: read("raw"), form: read("form"), stream: read("stream") };
}

export async function assertRawResponse(request: FetchFixture) {
  const { raw } = await functionUrls(request);
  const response = await request(raw, {
    headers: { "x-tsr-serverFn": "true" },
  });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-type")).toBe("application/octet-stream");
  expect(response.headers.get("x-compat-raw")).toBe("yes");
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 1, 127, 255]);
}

export async function assertMultipart(request: FetchFixture) {
  const { form } = await functionUrls(request);
  const body = new FormData();
  body.append("title", "中文");
  body.append("tag", "a");
  body.append("tag", "b");
  body.append(
    "file",
    new Blob([new Uint8Array([0, 1, 127, 255])], {
      type: "application/octet-stream",
    }),
    "fixture.bin",
  );
  // Encode the same multipart wire representation for preview and built HTTP.
  // The earlier in-process Wrangler helper rejected Node's cross-realm
  // FormData object; that was a harness mismatch, not a Theme failure.
  const encoded = new Request("http://fixture.local", { method: "POST", body });
  const response = await request(form, {
    method: "POST",
    body: await encoded.arrayBuffer(),
    headers: {
      "x-tsr-serverFn": "true",
      "content-type": encoded.headers.get("content-type")!,
    },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    title: "中文",
    tags: ["a", "b"],
    filename: "fixture.bin",
    mime: "application/octet-stream",
    size: 4,
    bytes: [0, 1, 127, 255],
  });
}

export async function assertByteStreaming(request: FetchFixture) {
  const { stream } = await functionUrls(request);
  const id = crypto.randomUUID();
  const response = await request(stream, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      "x-tsr-serverFn": "true",
      "x-compat-stream-id": id,
      // Keep this transport assertion independent of the local dev proxy's
      // compression buffering. Compressed delivery needs separate acceptance.
      "accept-encoding": "identity",
    },
  }).catch((error) => {
    throw new Error("Stream response headers did not arrive", { cause: error });
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/plain");
  const reader = response.body!.getReader();
  try {
    // No second chunk exists yet: completion cannot masquerade as streaming.
    const decoder = new TextDecoder();
    let firstText = "";
    // HTTP may split one producer chunk into several reader chunks.
    while (firstText.length < "first:中文\n".length) {
      const first = await reader.read().catch((error) => {
        throw new Error("Stream first chunk did not arrive", { cause: error });
      });
      expect(first.done).toBe(false);
      firstText += decoder.decode(first.value, { stream: true });
    }
    expect(firstText).toBe("first:中文\n");
    const release = await request(`/api/compat-stream-release?id=${id}`, {
      method: "POST",
    });
    expect(await release.json()).toEqual({ released: true });
    const remainder = new Response(
      new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const next = await reader.read();
              if (next.done) break;
              controller.enqueue(next.value);
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      }),
    );
    expect(await remainder.text()).toBe("second:done\n");
  } finally {
    await reader.cancel().catch(() => {});
  }
}
