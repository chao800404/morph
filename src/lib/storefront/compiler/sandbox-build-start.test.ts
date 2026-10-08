import { describe, expect, it, vi } from "vitest";
import {
  classifySandboxStartError,
  startBuildSandbox,
} from "./sandbox-build-start";

/** The SDK's typed errors, by the fields that decide anything. */
const sdkError = (code: string, context: Record<string, unknown>) =>
  Object.assign(new Error(`${code} from the SDK`), { code, context });
const unavailable = () =>
  sdkError("CONTAINER_UNAVAILABLE", { retryable: true, reason: "capacity" });
const startupFailed = () =>
  sdkError("INTERNAL_ERROR", {
    phase: "startup",
    error: "Container failed to start",
  });
const interrupted = () =>
  sdkError("OPERATION_INTERRUPTED", { reason: "connection-lost" });

type Session = { id: number; destroyed: boolean };

/**
 * A run of attempts: `outcomes[n]` is what attempt n+1's probe does. The
 * log records the order of acquire, probe and destroy, so overlap shows.
 */
function harness(
  outcomes: Array<"ok" | (() => Error) | "ran-then-lost">,
  overrides: Partial<Parameters<typeof startBuildSandbox<Session>>[0]> = {},
) {
  const events: string[] = [];
  const sessions: Session[] = [];
  let clock = 0;
  const sleeps: number[] = [];
  const probeEffects: number[] = [];
  const options = {
    acquire: vi.fn(async () => {
      const session = { id: sessions.length + 1, destroyed: false };
      sessions.push(session);
      events.push(`acquire ${session.id}`);
      return session;
    }),
    probe: vi.fn(async (session: Session) => {
      events.push(`probe ${session.id}`);
      const outcome = outcomes[session.id - 1] ?? "ok";
      if (outcome === "ok") return;
      if (outcome === "ran-then-lost") {
        // The probe ran in the container; only its response was lost.
        probeEffects.push(session.id);
        throw interrupted();
      }
      throw outcome();
    }),
    destroy: vi.fn(async (session: Session) => {
      session.destroyed = true;
      events.push(`destroy ${session.id}`);
    }),
    deadline: 120_000,
    log: vi.fn(),
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      sleeps.push(ms);
      clock += ms;
    }),
    random: () => 0.5,
    ...overrides,
  };
  return { options, events, sessions, sleeps, probeEffects };
}

describe("classifySandboxStartError", () => {
  it("recognises the SDK's two structured start failures", () => {
    expect(classifySandboxStartError(unavailable())).toBe(
      "container-unavailable",
    );
    expect(classifySandboxStartError(startupFailed())).toBe("startup");
  });

  it.each([
    [
      "a message that only reads like one",
      new Error("Container failed to start"),
    ],
    [
      "CONTAINER_UNAVAILABLE not marked retryable",
      sdkError("CONTAINER_UNAVAILABLE", {}),
    ],
    [
      "INTERNAL_ERROR outside startup",
      sdkError("INTERNAL_ERROR", { phase: "exec" }),
    ],
    ["an interrupted operation", interrupted()],
    ["no error object", "Container failed to start"],
  ])("does not recognise %s", (_name, error) => {
    expect(classifySandboxStartError(error)).toBeNull();
  });
});

describe("startBuildSandbox", () => {
  it("returns the first session whose probe answers, without waiting", async () => {
    const run = harness(["ok"]);
    const session = await startBuildSandbox(run.options);
    expect(session.id).toBe(1);
    expect(run.events).toEqual(["acquire 1", "probe 1"]);
    expect(run.options.destroy).not.toHaveBeenCalled();
  });

  it.each([
    ["the platform had no capacity", unavailable],
    ["the container failed to start", startupFailed],
  ])("starts again when %s, destroying first", async (_name, failure) => {
    const run = harness([failure, failure, "ok"]);
    const session = await startBuildSandbox(run.options);
    expect(session.id).toBe(3);
    // Each failed attempt is gone before the next one begins.
    expect(run.events).toEqual([
      "acquire 1",
      "probe 1",
      "destroy 1",
      "acquire 2",
      "probe 2",
      "destroy 2",
      "acquire 3",
      "probe 3",
    ]);
    // Short backoff that grows, with jitter.
    expect(run.sleeps).toEqual([2_500, 4_500]);
    expect(run.options.log).toHaveBeenCalledWith(
      "info",
      expect.stringContaining("attempt 3 of at most 3"),
    );
  });

  it("gives up after two retries with the last start error", async () => {
    const run = harness([startupFailed, startupFailed, startupFailed]);
    await expect(startBuildSandbox(run.options)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
    expect(run.options.acquire).toHaveBeenCalledTimes(3);
    expect(run.sessions.every((session) => session.destroyed)).toBe(true);
  });

  it("does not retry a probe that ran but whose response was lost", async () => {
    const run = harness(["ran-then-lost", "ok"]);
    await expect(startBuildSandbox(run.options)).rejects.toMatchObject({
      code: "OPERATION_INTERRUPTED",
    });
    expect(run.probeEffects).toEqual([1]);
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
    expect(run.sessions[0]!.destroyed).toBe(true);
  });

  it("does not retry an error it does not recognise", async () => {
    const run = harness([() => new Error("Container failed to start")]);
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      "Container failed to start",
    );
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });

  it("does not start again when the failed container's destruction fails", async () => {
    const run = harness([startupFailed, "ok"], {
      destroy: vi.fn(async () => {
        throw new Error("destroy refused");
      }),
    });
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      /SANDBOX_START_FAILED: .*could not be confirmed destroyed/,
    );
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });

  it("does not start again when the destruction never answers", async () => {
    const run = harness([startupFailed, "ok"], {
      destroy: vi.fn(() => new Promise<void>(() => {})),
      destroyTimeoutMs: 5,
    });
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      /could not be confirmed destroyed/,
    );
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });

  it("does not start again when the build stopped running during the wait", async () => {
    const stillRunning = vi.fn(async () => false);
    const run = harness([unavailable, "ok"], { stillRunning });
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      "SANDBOX_START_ABANDONED",
    );
    // Asked after the wait, not before it.
    expect(run.sleeps).toHaveLength(1);
    expect(stillRunning).toHaveBeenCalledTimes(1);
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });

  it("does not wait past the deadline for another attempt", async () => {
    const run = harness([startupFailed, "ok"], { deadline: 1_000 });
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      /deadline leaves no time/,
    );
    expect(run.sleeps).toEqual([]);
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });

  it("does not start again when the deadline passed during the wait", async () => {
    let clock = 0;
    const run = harness([startupFailed, "ok"], {
      deadline: 3_000,
      now: () => clock,
      // The wait overruns: the clock moves past the deadline.
      sleep: vi.fn(async () => {
        clock += 10_000;
      }),
    });
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      /deadline passed while waiting/,
    );
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });

  it("hands nothing back when the build was cancelled while its container started", async () => {
    const stillRunning = vi.fn(async () => false);
    const run = harness(["ok"], { stillRunning });
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      "SANDBOX_START_ABANDONED",
    );
    // Asked after the probe answered, and the started container destroyed.
    expect(run.events).toEqual(["acquire 1", "probe 1", "destroy 1"]);
  });

  it("waits for a destroy no longer than the deadline allows", async () => {
    let clock = 0;
    const run = harness([startupFailed, "ok"], {
      deadline: 10,
      destroyTimeoutMs: 60_000,
      now: () => clock,
      destroy: vi.fn(() => new Promise<void>(() => {})),
    });
    const started = Date.now();
    await expect(startBuildSandbox(run.options)).rejects.toThrow(
      /could not be confirmed destroyed/,
    );
    // Bounded by the 10 ms left, not by the 60 s destroy bound.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(run.options.acquire).toHaveBeenCalledTimes(1);
  });
});
