import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEditorCodeMonacoLoader,
  EDITOR_CODE_MONACO_TIMEOUT_MS,
  type EditorCodeMonacoRuntime,
} from "./editor-code-monaco-loader";

// vitest.setup.ts replaces this module for the suites that render the
// workspace; these tests are about the module itself.
vi.unmock("./editor-code-monaco-loader");

const runtime = {
  Editor: () => null,
  monaco: {},
} as unknown as EditorCodeMonacoRuntime;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("createEditorCodeMonacoLoader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is ready once the runtime import resolves", async () => {
    const importRuntime = vi.fn(async () => runtime);
    const loader = createEditorCodeMonacoLoader({ importRuntime });
    expect(loader.getState()).toEqual({ status: "loading" });
    loader.load();
    loader.load();
    await vi.runAllTimersAsync();
    expect(loader.getState()).toEqual({ status: "ready", runtime });
    expect(importRuntime).toHaveBeenCalledTimes(1);
  });

  it("reports a failed import, and Retry imports again", async () => {
    const importRuntime = vi
      .fn<() => Promise<EditorCodeMonacoRuntime>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"))
      .mockResolvedValueOnce(runtime);
    const loader = createEditorCodeMonacoLoader({ importRuntime });
    const seen: string[] = [];
    loader.subscribe(() => seen.push(loader.getState().status));
    loader.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState()).toEqual({ status: "error", reason: "failed" });

    loader.retry();
    expect(loader.getState()).toEqual({ status: "loading" });
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState()).toEqual({ status: "ready", runtime });
    expect(importRuntime).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["error", "loading", "ready"]);
  });

  it("shows a timeout instead of loading forever, and still takes a late answer", async () => {
    const pending = deferred<EditorCodeMonacoRuntime>();
    const loader = createEditorCodeMonacoLoader({
      importRuntime: () => pending.promise,
    });
    loader.load();
    await vi.advanceTimersByTimeAsync(EDITOR_CODE_MONACO_TIMEOUT_MS - 1);
    expect(loader.getState()).toEqual({ status: "loading" });
    await vi.advanceTimersByTimeAsync(1);
    expect(loader.getState()).toEqual({ status: "error", reason: "timeout" });

    pending.resolve(runtime);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState()).toEqual({ status: "ready", runtime });
  });

  it("Retry after a timeout waits again, and the retried import can answer", async () => {
    const first = deferred<EditorCodeMonacoRuntime>();
    const second = deferred<EditorCodeMonacoRuntime>();
    const importRuntime = vi
      .fn<() => Promise<EditorCodeMonacoRuntime>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const loader = createEditorCodeMonacoLoader({ importRuntime, timeoutMs: 100 });
    loader.load();
    await vi.advanceTimersByTimeAsync(100);
    expect(loader.getState()).toMatchObject({ status: "error", reason: "timeout" });

    loader.retry();
    expect(loader.getState()).toEqual({ status: "loading" });
    // The first attempt failing late does not overwrite the retry's state.
    first.reject(new Error("late failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState()).toEqual({ status: "loading" });

    second.resolve(runtime);
    await vi.advanceTimersByTimeAsync(0);
    expect(loader.getState()).toEqual({ status: "ready", runtime });
  });

  it("does nothing on Retry unless there is an error", async () => {
    const importRuntime = vi.fn(async () => runtime);
    const loader = createEditorCodeMonacoLoader({ importRuntime });
    loader.retry();
    expect(importRuntime).not.toHaveBeenCalled();
    loader.load();
    await vi.advanceTimersByTimeAsync(0);
    loader.retry();
    expect(importRuntime).toHaveBeenCalledTimes(1);
    expect(loader.getState().status).toBe("ready");
  });
});
