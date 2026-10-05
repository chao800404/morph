import { expect } from "vitest";

type RequestFixture = (path: string, init?: RequestInit) => Promise<Response>;

export async function assertAdvancedLoader(request: RequestFixture) {
  const response = await request("/compat-advanced");
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('data-advanced="loader">true:amount:1234');
  // A rendered class method alone is not serialization evidence: Start can
  // flush that HTML before discovering the value cannot be dehydrated.
  expect(html).toContain('.t.get("compat-amount")');
  const url = /data-advanced-url="([^"]+)"/.exec(html)?.[1];
  expect(url).toBeTruthy();
  const reply = await request(url!.replace(/&amp;/g, "&"), {
    headers: { "x-tsr-serverFn": "true" },
  });
  expect(reply.status).toBe(200);
  expect(await reply.text()).toContain("$TSR/t/compat-amount");
}

/** The remainder cannot resolve until the test has actually observed the shell. */
export async function assertDeferredLoader(request: RequestFixture) {
  const id = crypto.randomUUID();
  const response = await request(`/compat-deferred?id=${id}`, {
    // Start deliberately waits for all data for bot/non-browser user agents.
    // This case is the ordinary browser's streaming response, not crawler SSR.
    headers: {
      "accept-encoding": "identity",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15_000),
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let html = "";
  let released = false;
  const read = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("SSR shell/stream stalled")),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    while (!html.includes('data-deferred="pending"')) {
      const chunk = await read();
      expect(chunk.done).toBe(false);
      html += decoder.decode(chunk.value, { stream: true });
    }
    expect(html).toContain("shell:ready");
    expect(html).not.toContain("deferred:中文");
    const release = await request(`/api/compat-deferred-release?id=${id}`, {
      method: "POST",
    });
    expect(release.status).toBe(200);
    expect(await release.json()).toEqual({ released: true });
    released = true;
    while (true) {
      const chunk = await read();
      if (chunk.done) break;
      html += decoder.decode(chunk.value, { stream: true });
    }
    html += decoder.decode();
    expect(html).toContain("deferred:中文");
  } finally {
    if (!released)
      await request(`/api/compat-deferred-release?id=${id}`, {
        method: "POST",
      });
    await reader.cancel();
  }
}
