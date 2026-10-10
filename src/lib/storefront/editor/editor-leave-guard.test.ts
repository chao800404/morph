import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyEditorNavigation,
  createEditorLeaveGuard,
  type EditorLeaveFlush,
  type EditorLeavePrompt,
} from "./editor-leave-guard";

/**
 * A navigation that arrives while an edit is still waiting to be saved.
 *
 * Every outcome is a promise the test resolves by hand and the only timer is
 * faked, so "navigated before the debounce fired" is a fixed order of calls,
 * not a race against a 300ms timer.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(initiallyPending = true) {
  let pending = initiallyPending;
  const flushes: Array<ReturnType<typeof deferred<EditorLeaveFlush>>> = [];
  const prompts: Array<EditorLeavePrompt | null> = [];
  const discard = vi.fn();
  const onBlocked = vi.fn();
  const flush = vi.fn(() => {
    const next = deferred<EditorLeaveFlush>();
    flushes.push(next);
    return next.promise;
  });
  const guard = createEditorLeaveGuard({
    hasPendingWrites: () => pending,
    flush,
    onPrompt: (prompt) => prompts.push(prompt),
    discard,
    onBlocked,
    promptDelayMs: 400,
  });
  return {
    guard,
    flush,
    flushes,
    prompts,
    discard,
    onBlocked,
    setPending: (value: boolean) => {
      pending = value;
    },
    lastPrompt: () => prompts.at(-1),
  };
}

/** Lets the guard's promise callbacks run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a navigation with nothing waiting", () => {
  it("goes at once and sends nothing", async () => {
    const { guard, flush, prompts } = harness(false);

    await expect(guard.request("leave-editor")).resolves.toBe(false);

    expect(flush).not.toHaveBeenCalled();
    expect(prompts).toEqual([]);
  });
});

describe("a navigation before the debounce fired", () => {
  it("sends the edit now and goes once it is stored", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));

    // Sent at once, not when the debounce would have ended.
    expect(h.flush).toHaveBeenCalledWith("leave-editor");
    await settle();
    expect(blocked).toBeUndefined();

    h.setPending(false);
    h.flushes[0]!.resolve({ saved: true });
    await settle();

    expect(blocked).toBe(false);
    expect(h.discard).not.toHaveBeenCalled();
    // Quick enough that nothing was ever asked.
    expect(h.prompts.filter(Boolean)).toEqual([]);
  });

  it("stays and says why when the save fails, keeping the edit", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));

    h.flushes[0]!.resolve({ saved: false, reason: "Save failed: offline" });
    await settle();

    // Not navigated, and not discarded: the author decides.
    expect(blocked).toBeUndefined();
    expect(h.discard).not.toHaveBeenCalled();
    expect(h.lastPrompt()).toEqual({
      phase: "not-saved",
      kind: "leave-editor",
      reason: "Save failed: offline",
    });

    h.guard.stay();
    await settle();
    expect(blocked).toBe(true);
    expect(h.onBlocked).toHaveBeenCalledWith("leave-editor", "stayed");
    expect(h.lastPrompt()).toBeNull();
  });

  it("reports a flush that throws as not saved rather than going", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("switch-page").then((value) => (blocked = value));

    h.flushes[0]!.reject(new Error("Content is out of date."));
    await settle();

    expect(blocked).toBeUndefined();
    expect(h.lastPrompt()).toMatchObject({
      phase: "not-saved",
      reason: "Content is out of date.",
    });
  });

  it("treats an unknown outcome as not saved, and leaves only when told", async () => {
    // The flush sends nothing while an earlier save is unanswered; it says
    // so, and the guard does not resend or navigate on its own.
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));

    h.flushes[0]!.resolve({
      saved: false,
      reason: "It could not be confirmed whether an earlier save was stored.",
    });
    await settle();
    expect(h.flush).toHaveBeenCalledTimes(1);
    expect(blocked).toBeUndefined();

    h.guard.leave();
    await settle();

    expect(h.discard).toHaveBeenCalledWith("leave-editor");
    expect(blocked).toBe(false);
    expect(h.flush).toHaveBeenCalledTimes(1);
  });

  it("does not take an answer as stored while a newer edit is held", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));

    // The answer arrives, but something is still pending.
    h.flushes[0]!.resolve({ saved: true });
    await settle();

    expect(blocked).toBeUndefined();
    expect(h.lastPrompt()).toMatchObject({ phase: "not-saved" });
  });
});

describe("a slow save", () => {
  it("offers a way out while it runs, and goes if it then lands", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));

    await vi.advanceTimersByTimeAsync(399);
    expect(h.prompts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.lastPrompt()).toEqual({ phase: "saving", kind: "leave-editor" });

    h.setPending(false);
    h.flushes[0]!.resolve({ saved: true });
    await settle();
    expect(blocked).toBe(false);
    expect(h.lastPrompt()).toBeNull();
  });

  it("lets the author leave without waiting for an answer that never comes", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));
    await vi.advanceTimersByTimeAsync(400);

    h.guard.leave();
    await settle();

    expect(blocked).toBe(false);
    expect(h.discard).toHaveBeenCalledWith("leave-editor");

    // An answer arriving afterwards changes nothing.
    h.flushes[0]!.resolve({ saved: false, reason: "late" });
    await settle();
    expect(h.lastPrompt()).toBeNull();
  });
});

describe("editing again while a navigation waits", () => {
  it("cancels the navigation, during the save", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("switch-page").then((value) => (blocked = value));

    h.guard.noteInput();
    await settle();

    expect(blocked).toBe(true);
    expect(h.onBlocked).toHaveBeenCalledWith("switch-page", "kept-editing");
    expect(h.discard).not.toHaveBeenCalled();

    // The earlier save landing does not revive it.
    h.setPending(false);
    h.flushes[0]!.resolve({ saved: true });
    await settle();
    expect(blocked).toBe(true);
    expect(h.lastPrompt()).toBeNull();
    expect(h.guard.waiting).toBe(false);
  });

  it("cancels the navigation, while the author is being asked", async () => {
    const h = harness();
    let blocked: boolean | undefined;
    void h.guard.request("leave-editor").then((value) => (blocked = value));
    h.flushes[0]!.resolve({ saved: false, reason: "Save failed" });
    await settle();

    h.guard.noteInput();
    await settle();

    expect(blocked).toBe(true);
    expect(h.lastPrompt()).toBeNull();
  });

  it("does nothing when no navigation is waiting", () => {
    const h = harness();
    h.guard.noteInput();
    expect(h.onBlocked).not.toHaveBeenCalled();
  });
});

describe("a second navigation while one waits", () => {
  it("drops the first and handles the second", async () => {
    const h = harness();
    let first: boolean | undefined;
    let second: boolean | undefined;
    void h.guard.request("switch-page").then((value) => (first = value));
    void h.guard.request("leave-editor").then((value) => (second = value));
    await settle();

    expect(first).toBe(true);
    expect(h.onBlocked).toHaveBeenCalledWith("switch-page", "superseded");

    // The first flush answering is not the second's answer.
    h.flushes[0]!.resolve({ saved: false, reason: "old" });
    await settle();
    expect(h.prompts.filter(Boolean)).toEqual([]);

    h.setPending(false);
    h.flushes[1]!.resolve({ saved: true });
    await settle();
    expect(second).toBe(false);
  });
});

describe("classifyEditorNavigation", () => {
  const at = (search: Record<string, unknown>, pathname = "/store/s/themes/t/editor") => ({
    pathname,
    search,
  });

  it("calls another route leaving the editor", () => {
    expect(
      classifyEditorNavigation(at({}), at({}, "/dashboard/online-store")),
    ).toBe("leave-editor");
  });

  it("calls another page a page switch, with home as the absent routePath", () => {
    expect(
      classifyEditorNavigation(at({}), at({ routePath: "/about" })),
    ).toBe("switch-page");
    expect(
      classifyEditorNavigation(at({ routePath: "/about" }), at({})),
    ).toBe("switch-page");
    expect(
      classifyEditorNavigation(at({ routePath: "/" }), at({})),
    ).toBeNull();
  });

  it("calls another template a page switch, but not filling one in", () => {
    expect(
      classifyEditorNavigation(
        at({ templateId: "a" }),
        at({ templateId: "b" }),
      ),
    ).toBe("switch-page");
    expect(
      classifyEditorNavigation(at({}), at({ templateId: "a" })),
    ).toBeNull();
  });

  it("lets selection and viewport changes through", () => {
    expect(
      classifyEditorNavigation(
        at({ templateId: "a", section: "hero" }),
        at({ templateId: "a", section: "footer", viewport: "mobile" }),
      ),
    ).toBeNull();
  });
});
