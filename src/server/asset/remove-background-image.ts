/** Fetch only a target already accepted by resolveRemoveBackgroundTarget. */
export async function fetchRemoveBackgroundImage(
  targetUrl: string,
  cookie: string | null,
): Promise<Uint8Array> {
  const response = await fetch(targetUrl, {
    headers: cookie ? { cookie } : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    cf: {
      image: {
        segment: "foreground",
        format: "png",
        quality: 100,
      } as RequestInitCfPropertiesImage & { segment: string },
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Cloudflare Image Resizing is unavailable (${response.status}).`,
    );
  }
  return readBoundedImage(response, 20 * 1024 * 1024);
}

/** Enforce the decoded byte bound while reading, including chunked responses. */
async function readBoundedImage(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const tooLarge = () => new Error("That image is too large to process.");
  const length = Number(response.headers.get("content-length"));
  if (length > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) throw new Error("The image response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw tooLarge();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (size === 0) throw new Error("The image response was empty.");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
