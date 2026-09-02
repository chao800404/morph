import { describe, expect, it, vi } from "vitest";
import type { StorefrontThemeBuildDTO } from "@/lib/storefront/dto/storefront-theme-build.dto";
import { waitForThemeBuild } from "./theme-build-wait";

const buildWith = (status: string): StorefrontThemeBuildDTO =>
  ({ id: "build-1234abcd", status }) as StorefrontThemeBuildDTO;

/** Runs without real timers so the tests do not spend the poll interval. */
const immediateSleep = () => Promise.resolve();

describe("waitForThemeBuild", () => {
  it("reports a build that succeeds", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce(buildWith("building"))
      .mockResolvedValueOnce(buildWith("succeeded"));

    const result = await waitForThemeBuild({
      build: buildWith("queued"),
      poll,
      signal: new AbortController().signal,
      sleep: immediateSleep,
    });

    expect(result.outcome).toBe("settled");
    expect(result.build.status).toBe("succeeded");
  });

  it("reports a build that fails", async () => {
    const result = await waitForThemeBuild({
      build: buildWith("queued"),
      poll: vi.fn().mockResolvedValue(buildWith("failed")),
      signal: new AbortController().signal,
      sleep: immediateSleep,
    });

    expect(result.outcome).toBe("settled");
    expect(result.build.status).toBe("failed");
  });

  it("does not poll at all when already settled", async () => {
    const poll = vi.fn();

    const result = await waitForThemeBuild({
      build: buildWith("succeeded"),
      poll,
      signal: new AbortController().signal,
      sleep: immediateSleep,
    });

    expect(result.outcome).toBe("settled");
    expect(poll).not.toHaveBeenCalled();
  });

  it("separates running out of polls from failing", async () => {
    // A build that is still running has not failed. Reporting it as one both
    // misstates the build and hides that its result is still coming.
    const result = await waitForThemeBuild({
      build: buildWith("queued"),
      poll: vi.fn().mockResolvedValue(buildWith("building")),
      signal: new AbortController().signal,
      sleep: immediateSleep,
      maxAttempts: 3,
    });

    expect(result.outcome).toBe("timeout");
    expect(result.build.status).toBe("building");
  });

  it("stops when the caller abandons the wait", async () => {
    const controller = new AbortController();
    const poll = vi.fn().mockImplementation(async () => {
      controller.abort("user");
      return buildWith("building");
    });

    const result = await waitForThemeBuild({
      build: buildWith("queued"),
      poll,
      signal: controller.signal,
      sleep: immediateSleep,
      maxAttempts: 30,
    });

    expect(result.outcome).toBe("aborted");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("carries the abort reason so an unmount can stay silent", async () => {
    const controller = new AbortController();
    controller.abort("unmount");

    const result = await waitForThemeBuild({
      build: buildWith("queued"),
      poll: vi.fn(),
      signal: controller.signal,
      sleep: immediateSleep,
    });

    expect(result).toMatchObject({ outcome: "aborted", reason: "unmount" });
  });

  it("does not poll after an abort that arrives during the interval", async () => {
    const controller = new AbortController();
    const poll = vi.fn().mockResolvedValue(buildWith("building"));

    const result = await waitForThemeBuild({
      build: buildWith("queued"),
      poll,
      signal: controller.signal,
      sleep: async () => {
        controller.abort("user");
      },
    });

    expect(result.outcome).toBe("aborted");
    expect(poll).not.toHaveBeenCalled();
  });

  it("keeps the last known build when a poll cannot be read", async () => {
    // An unreadable poll is not evidence about the build, so it must not be
    // mistaken for the build having no status.
    const poll = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(buildWith("succeeded"));

    const result = await waitForThemeBuild({
      build: buildWith("building"),
      poll,
      signal: new AbortController().signal,
      sleep: immediateSleep,
    });

    expect(result.outcome).toBe("settled");
    expect(result.build.status).toBe("succeeded");
  });
});
