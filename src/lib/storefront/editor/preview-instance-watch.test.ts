import { describe, expect, it, vi } from "vitest";
import { createPreviewInstanceWatch } from "./preview-instance-watch";
import type {
  PreviewServedInstance,
  PreviewServedInstanceReport,
} from "./preview-protocol";

const SESSION_A = "aaaaaaaa-1111";
const SESSION_B = "bbbbbbbb-2222";

const instance = (session: string, serial: number): PreviewServedInstance => ({
  session,
  serial,
});
const known = (served: PreviewServedInstance): PreviewServedInstanceReport => ({
  kind: "known",
  instance: served,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness() {
  let key: string | null = "frame-0";
  const reloads: string[] = [];
  const logs: string[] = [];
  const answers: Array<ReturnType<typeof deferred<PreviewServedInstance | null>>> =
    [];
  const confirm = vi.fn(() => {
    const answer = deferred<PreviewServedInstance | null>();
    answers.push(answer);
    return answer.promise;
  });
  let editing = false;
  const deferrals: string[] = [];
  const watch = createPreviewInstanceWatch({
    currentKey: () => key,
    reloadFrame: (reloaded) => reloads.push(reloaded),
    confirm,
    log: (line) => logs.push(line),
    canReload: () => !editing,
    onDeferred: (reason) => deferrals.push(reason),
  });
  return {
    watch,
    reloads,
    logs,
    confirm,
    answers,
    deferrals,
    setKey(next: string | null) {
      key = next;
    },
    /** Text is being typed on the canvas (true), or that edit ended (false). */
    setEditing(next: boolean) {
      editing = next;
      if (!next) watch.editEnded();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createPreviewInstanceWatch", () => {
  it("asks nothing when a frame comes up", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.frameReady("frame-0", null);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.reloads).toEqual([]);
  });

  it("reloads the frame once when the same session serves a later instance", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    h.watch.observe("frame-0", instance(SESSION_A, 3));
    expect(h.reloads).toEqual(["frame-0"]);
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("asks nothing more about a frame it has already replaced", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    // The new frame is not current yet; answers still name the old key.
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    expect(h.reloads).toEqual(["frame-0"]);
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("ignores the frame's own instance and older ones of its session", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 4)));
    h.watch.observe("frame-0", instance(SESSION_A, 4));
    // An answer from an instance this frame never saw, but older: late.
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    expect(h.reloads).toEqual([]);
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("ignores an answer sent for a frame that is no longer on screen", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setKey("frame-1");
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    h.watch.observe("frame-1", instance(SESSION_A, 2));
    expect(h.reloads).toEqual([]);
  });

  it("ignores a ready message from a frame that is not current", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    // A late ready from a frame already replaced does not take its place.
    h.watch.frameReady("frame-old", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("compares a new frame against its own instance, not the last frame's", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    h.setKey("frame-1");
    h.watch.frameReady("frame-1", known(instance(SESSION_A, 2)));
    h.watch.observe("frame-1", instance(SESSION_A, 2));
    // A late answer from the instance the first frame came from.
    h.watch.observe("frame-1", instance(SESSION_A, 1));
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("confirms another session with one fresh question before reloading", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 3)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.reloads).toEqual([]);
    h.answers[0]!.resolve(instance(SESSION_B, 1));
    await settle();
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("keeps the frame when the fresh question names the frame's own instance", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 3)));
    // A late answer from a sidecar that has since gone.
    h.watch.observe("frame-0", instance(SESSION_B, 7));
    h.answers[0]!.resolve(instance(SESSION_A, 3));
    await settle();
    expect(h.reloads).toEqual([]);
  });

  it("reads a confirmation only for the frame it was asked for", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 3)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.setKey("frame-1");
    h.watch.frameReady("frame-1", known(instance(SESSION_B, 1)));
    h.answers[0]!.resolve(instance(SESSION_B, 2));
    await settle();
    expect(h.reloads).toEqual([]);
  });

  it("lets only the latest round decide when answers arrive out of order", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 3)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.setKey("frame-1");
    h.watch.frameReady("frame-1", known(instance(SESSION_A, 3)));
    h.watch.observe("frame-1", instance(SESSION_B, 1));
    expect(h.confirm).toHaveBeenCalledTimes(2);
    // The newer round answers first: the frame's own instance serves...
    h.answers[1]!.resolve(instance(SESSION_A, 3));
    await settle();
    // ...and the older round, answering late, decides nothing.
    h.answers[0]!.resolve(instance(SESSION_B, 1));
    await settle();
    expect(h.reloads).toEqual([]);
  });

  it("asks again after a confirmation that failed", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 3)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.answers[0]!.reject(new Error("lost"));
    await settle();
    expect(h.reloads).toEqual([]);
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    expect(h.confirm).toHaveBeenCalledTimes(2);
    h.answers[1]!.resolve(instance(SESSION_B, 1));
    await settle();
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("reloads for a sidecar restarted on the same address", async () => {
    const h = harness();
    // Same origin, new process: a new session whose serial starts again.
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 5)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.answers[0]!.resolve(instance(SESSION_B, 1));
    await settle();
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("treats a confirmation that cannot say as no answer", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 3)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.answers[0]!.resolve(null);
    await settle();
    expect(h.reloads).toEqual([]);
  });

  it("compares nothing when the page could not name every response", () => {
    const h = harness();
    h.watch.frameReady("frame-0", { kind: "missing" });
    h.watch.observe("frame-0", instance(SESSION_A, 9));
    h.watch.observe("frame-0", instance(SESSION_B, 9));
    expect(h.reloads).toEqual([]);
    expect(h.confirm).not.toHaveBeenCalled();
    expect(
      h.logs.filter((line) => line.includes("could not say")),
    ).toHaveLength(1);
  });

  it("compares nothing when the transport names no instance", () => {
    const h = harness();
    h.watch.frameReady("frame-0", null);
    h.watch.observe("frame-0", instance(SESSION_A, 9));
    expect(h.reloads).toEqual([]);
    expect(h.confirm).not.toHaveBeenCalled();
  });

  it("reloads a frame loaded from two instances once for the one serving", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", { kind: "mixed" });
    expect(h.confirm).toHaveBeenCalledTimes(1);
    h.answers[0]!.resolve(instance(SESSION_A, 2));
    await settle();
    expect(h.reloads).toEqual(["frame-0"]);

    h.setKey("frame-1");
    h.watch.frameReady("frame-1", { kind: "mixed" });
    h.answers[1]!.resolve(instance(SESSION_A, 2));
    await settle();
    expect(h.reloads).toEqual(["frame-0"]);
    expect(h.logs.some((line) => line.includes("not reloading again"))).toBe(
      true,
    );
  });

  it("does nothing after it is disposed", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.watch.dispose();
    h.answers[0]!.resolve(instance(SESSION_B, 1));
    await settle();
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    expect(h.reloads).toEqual([]);
  });
});

describe("a reload held while text is typed on the canvas", () => {
  it("is held, told once, and happens once when the edit ends", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setEditing(true);
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    expect(h.reloads).toEqual([]);
    expect(h.deferrals).toHaveLength(1);
    expect(h.logs).toContain(
      `[preview-instance] reload deferred | served by ${SESSION_A}.1, serving ${SESSION_A}.2`,
    );
    h.setEditing(false);
    expect(h.reloads).toEqual(["frame-0"]);
    // Ended again: nothing is left to do.
    h.setEditing(false);
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("merges later answers into the one held reload", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setEditing(true);
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    h.watch.observe("frame-0", instance(SESSION_A, 3));
    // Another session while held: no confirmation is asked for.
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    await settle();
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.deferrals).toHaveLength(1);
    h.setEditing(false);
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("holds a reload a confirmation decided while text is typed", async () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_B, 1));
    h.setEditing(true);
    h.answers[0]!.resolve(instance(SESSION_B, 1));
    await settle();
    expect(h.reloads).toEqual([]);
    expect(h.deferrals).toHaveLength(1);
    h.setEditing(false);
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("drops the held reload when its frame is replaced for another reason", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setEditing(true);
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    // Compile recovery, a reconnect, a route change: a new frame, before the
    // edit ends. Its page will have come from the server serving.
    h.setKey("frame-1");
    h.setEditing(false);
    expect(h.reloads).toEqual([]);
    // And the new frame, once up, starts clean.
    h.watch.frameReady("frame-1", known(instance(SESSION_A, 2)));
    h.watch.observe("frame-1", instance(SESSION_A, 2));
    expect(h.reloads).toEqual([]);
  });

  it("drops the held reload when a new frame comes up before the edit ends", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setEditing(true);
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    h.setKey("frame-1");
    h.watch.frameReady("frame-1", known(instance(SESSION_A, 2)));
    h.setEditing(false);
    expect(h.reloads).toEqual([]);
  });

  it("does nothing after it is disposed", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setEditing(true);
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    h.watch.dispose();
    h.setEditing(false);
    expect(h.reloads).toEqual([]);
  });

  it("keeps holding, untold again, when the edit ends while the frame still cannot be replaced", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.setEditing(true);
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    expect(h.deferrals).toHaveLength(1);
    // Told the edit ended while something still holds the frame.
    h.watch.editEnded();
    expect(h.reloads).toEqual([]);
    expect(h.deferrals).toHaveLength(1);
    // A later answer adds nothing to the held reload.
    h.watch.observe("frame-0", instance(SESSION_A, 3));
    expect(h.deferrals).toHaveLength(1);
    // Once it can be replaced, it is, once.
    h.setEditing(false);
    expect(h.reloads).toEqual(["frame-0"]);
    h.setEditing(false);
    expect(h.reloads).toEqual(["frame-0"]);
  });

  it("reloads at once when nothing is being typed", () => {
    const h = harness();
    h.watch.frameReady("frame-0", known(instance(SESSION_A, 1)));
    h.watch.observe("frame-0", instance(SESSION_A, 2));
    expect(h.reloads).toEqual(["frame-0"]);
    expect(h.deferrals).toEqual([]);
  });
});
