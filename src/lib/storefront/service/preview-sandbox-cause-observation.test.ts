import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_CAUSE_DEPTH,
  observedPreviewNamespace,
  previewErrorCauseChain,
} from "./preview-sandbox-cause-observation";
import {
  previewProxyEnv,
  previewSandboxBinding,
} from "./preview-sandbox-binding";

const PREVIEW_URL =
  "http://5173-sandbox-a-secrettoken123.preview.localhost:3000/src/layouts/StorefrontLayout.tsx?t=1&token=abc";

/**
 * A namespace whose methods, like the binding's, refuse any receiver but
 * itself, and whose stubs count what they are asked.
 */
function fakeNamespace(fetch: (request: Request) => Promise<Response>) {
  const calls: string[] = [];
  const stub = {
    fetch(this: unknown, request: Request) {
      if (this !== stub) throw new TypeError("Illegal invocation");
      calls.push(`fetch ${new URL(request.url).pathname}`);
      return fetch(request);
    },
    exec(command: string) {
      calls.push(`exec ${command}`);
      return Promise.resolve({ exitCode: 0 });
    },
    configure(configuration: unknown) {
      calls.push(`configure ${JSON.stringify(configuration)}`);
      return Promise.resolve();
    },
    id: { name: "sandbox-a" },
  };
  const namespace = {
    idFromName(this: unknown, name: string) {
      if (this !== namespace) throw new TypeError("Illegal invocation");
      calls.push(`idFromName ${name}`);
      return { name };
    },
    get(this: unknown, id: unknown) {
      if (this !== namespace) throw new TypeError("Illegal invocation");
      calls.push(`get ${JSON.stringify(id)}`);
      return stub;
    },
  };
  return { namespace, stub, calls };
}

function observedLines(log: ReturnType<typeof vi.spyOn>) {
  return log.mock.calls
    .map((call) => String(call[0]))
    .filter((line) =>
      line.startsWith("[preview-observe] proxy-fetch-rejected "),
    )
    .map((line) =>
      JSON.parse(line.slice("[preview-observe] proxy-fetch-rejected ".length)),
    );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("previewErrorCauseChain", () => {
  it("lists each error's name and message, outermost first, and no stack", () => {
    const root = new Error("Network connection lost.");
    const wrapper = new Error(
      "Sandbox operation sandbox.fetch was interrupted while the platform was updating the sandbox runtime",
      { cause: root },
    );
    wrapper.name = "OperationInterruptedError";
    const result = previewErrorCauseChain(wrapper);
    expect(result).toEqual({
      chain: [
        {
          name: "OperationInterruptedError",
          message:
            "Sandbox operation sandbox.fetch was interrupted while the platform was updating the sandbox runtime",
        },
        { name: "Error", message: "Network connection lost." },
      ],
      truncated: false,
    });
    expect(JSON.stringify(result)).not.toContain("at ");
  });

  it("stops after a bounded depth, and on a cycle", () => {
    let error: Error = new Error("deepest");
    for (let i = 0; i < 10; i += 1)
      error = new Error(`level ${i}`, { cause: error });
    const deep = previewErrorCauseChain(error);
    expect(deep.chain).toHaveLength(MAX_CAUSE_DEPTH);
    expect(deep.truncated).toBe(true);

    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;
    expect(previewErrorCauseChain(b).chain.map((item) => item.message)).toEqual(
      ["b", "a"],
    );
  });

  it("cuts long fields and passes them through the preview log's sanitiser", () => {
    const error = new Error(
      `\u001b[31mfailed\u001b[0m ?signature=SECRET\nAuthorization: Bearer abc ${"x".repeat(1_000)}`,
    );
    const [item] = previewErrorCauseChain(error).chain;
    expect(item!.message.length).toBeLessThanOrEqual(300);
    expect(item!.message).not.toContain("\u001b");
    expect(item!.message).not.toContain("SECRET");
    expect(item!.message).not.toContain("Bearer abc");
  });

  it("reads a thrown non-error as its text", () => {
    expect(previewErrorCauseChain("plain failure").chain).toEqual([
      { name: "", message: "plain failure" },
    ]);
  });
});

describe("observedPreviewNamespace", () => {
  it("is one wrapper per namespace, so the SDK's per-namespace cache still holds", () => {
    const { namespace } = fakeNamespace(async () => new Response("ok"));
    expect(observedPreviewNamespace(namespace)).toBe(
      observedPreviewNamespace(namespace),
    );
    const env = { PreviewSandbox: namespace };
    expect(previewSandboxBinding(env)).toBe(previewProxyEnv(env).Sandbox);
    expect(previewSandboxBinding({})).toBeUndefined();
  });

  it("passes every call through to the binding unchanged, on the binding itself", async () => {
    const response = new Response("module source", { status: 200 });
    const { namespace, stub, calls } = fakeNamespace(async () => response);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const observed = observedPreviewNamespace(namespace);

    const id = observed.idFromName("sandbox-a");
    const handle = observed.get(id) as typeof stub;
    expect(handle.id).toBe(stub.id);
    await expect(handle.exec("true")).resolves.toEqual({ exitCode: 0 });
    await expect(handle.configure({ sandboxName: "sandbox-a" })).resolves.toBe(
      undefined,
    );
    const request = new Request(PREVIEW_URL);
    await expect(handle.fetch(request)).resolves.toBe(response);

    expect(calls).toEqual([
      "idFromName sandbox-a",
      'get {"name":"sandbox-a"}',
      "exec true",
      'configure {"sandboxName":"sandbox-a"}',
      "fetch /src/layouts/StorefrontLayout.tsx",
    ]);
    expect(observedLines(log)).toEqual([]);
  });

  it("logs the cause chain of a rejected fetch, then rejects with the same error", async () => {
    const root = new Error("Network connection lost.");
    const failure = new Error("fetch failed", { cause: root });
    const { namespace, calls } = fakeNamespace(async () => {
      throw failure;
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const observed = observedPreviewNamespace(namespace);
    const handle = observed.get(observed.idFromName("sandbox-a")) as {
      fetch: (request: Request) => Promise<Response>;
    };

    const rejection = await handle
      .fetch(new Request(PREVIEW_URL))
      .catch((error: unknown) => error);
    expect(rejection).toBe(failure);
    // Asked once: nothing is retried.
    expect(calls.filter((call) => call.startsWith("fetch "))).toHaveLength(1);

    const [line] = observedLines(log);
    expect(line).toMatchObject({
      previewId: "sandbox-a",
      method: "GET",
      path: "/src/layouts/StorefrontLayout.tsx",
      chain: [
        { name: "Error", message: "fetch failed" },
        { name: "Error", message: "Network connection lost." },
      ],
      truncated: false,
    });
    // The host's token and the query are never logged.
    expect(JSON.stringify(line)).not.toContain("secrettoken123");
    expect(JSON.stringify(line)).not.toContain("token=abc");
  });

  it("still rejects with the same error when logging itself fails", async () => {
    const failure = new Error("boom");
    const { namespace } = fakeNamespace(async () => {
      throw failure;
    });
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("console is gone");
    });
    const observed = observedPreviewNamespace(namespace);
    const handle = observed.get(observed.idFromName("sandbox-a")) as {
      fetch: (request: Request) => Promise<Response>;
    };
    await expect(handle.fetch(new Request(PREVIEW_URL))).rejects.toBe(failure);
  });
});
