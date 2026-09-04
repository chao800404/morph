import { describe, expect, it, vi } from "vitest";

const executeQueuedBuild = vi.fn();
const getThemeBuild = vi.fn();
const markBuildResult = vi.fn();

vi.mock("@/lib/storefront/service/theme-build-service.factory", () => ({
  createServerThemeBuildService: () => ({ executeQueuedBuild, getThemeBuild }),
}));

vi.mock("@/lib/storefront/dal/storefront-theme-dependency.dal", () => ({
  storefrontThemeDependencyDal: { markBuildResult },
}));

const runReleasePreviewCapture = vi.fn();
vi.mock("./release-preview-capture", () => ({ runReleasePreviewCapture }));

const { processThemeBuildQueue } = await import("./theme-build-queue");

const BUILD_ID = "3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8";

const message = (overrides: Record<string, unknown> = {}) => ({
  body: {
    version: 1,
    type: "theme-build",
    storefrontId: "11111111-2222-4333-8444-555555555555",
    themeId: "66666666-7777-4888-8999-aaaaaaaaaaaa",
    buildId: BUILD_ID,
    ...overrides,
  },
  ack: vi.fn(),
});

describe("processThemeBuildQueue", () => {
  it("builds a message whose build is still pending", async () => {
    getThemeBuild.mockResolvedValueOnce({ id: BUILD_ID, status: "queued" });
    executeQueuedBuild.mockResolvedValueOnce({
      id: BUILD_ID,
      status: "succeeded",
    });

    await processThemeBuildQueue({ messages: [message()] });

    expect(executeQueuedBuild).toHaveBeenCalledTimes(1);
  });

  it("skips a build cancelled before the consumer picked it up", async () => {
    // Queues cannot revoke a delivered message, so the consumer is what stops
    // the work. Building anyway would spend a Sandbox on a result that the
    // cancellation would then refuse to record.
    const queued = message();
    getThemeBuild.mockResolvedValueOnce({ id: BUILD_ID, status: "cancelled" });

    await processThemeBuildQueue({ messages: [queued] });

    expect(executeQueuedBuild).not.toHaveBeenCalled();
    expect(queued.ack).toHaveBeenCalledTimes(1);
  });

  it("skips a build that already finished", async () => {
    const queued = message();
    getThemeBuild.mockResolvedValueOnce({ id: BUILD_ID, status: "succeeded" });

    await processThemeBuildQueue({ messages: [queued] });

    expect(executeQueuedBuild).not.toHaveBeenCalled();
    expect(queued.ack).toHaveBeenCalledTimes(1);
  });

  it("acknowledges a malformed message instead of poisoning the queue", async () => {
    const malformed = { body: { nope: true }, ack: vi.fn() };

    await processThemeBuildQueue({ messages: [malformed] });

    expect(malformed.ack).toHaveBeenCalledTimes(1);
    expect(getThemeBuild).not.toHaveBeenCalled();
  });
});

describe("release preview messages", () => {
  const previewMessage = () => ({
    body: {
      version: 1,
      type: "release-preview",
      storefrontId: "11111111-2222-4333-8444-555555555555",
      releaseId: "99999999-8888-4777-8666-555555555555",
    },
    ack: vi.fn(),
  });

  it("captures the release and never builds", async () => {
    executeQueuedBuild.mockClear();
    runReleasePreviewCapture.mockClear();
    const msg = previewMessage();

    await processThemeBuildQueue({ messages: [msg] });

    expect(runReleasePreviewCapture).toHaveBeenCalledWith({
      version: 1,
      type: "release-preview",
      storefrontId: "11111111-2222-4333-8444-555555555555",
      releaseId: "99999999-8888-4777-8666-555555555555",
    });
    expect(executeQueuedBuild).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalled();
  });

  it("acknowledges a capture that failed rather than retrying it", async () => {
    // Browser Run's daily cap is the common failure, and retrying would spend
    // the remaining budget re-failing. The card falls back on its own.
    runReleasePreviewCapture.mockClear();
    runReleasePreviewCapture.mockRejectedValueOnce(new Error("429"));
    const msg = previewMessage();

    await expect(
      processThemeBuildQueue({ messages: [msg] }),
    ).resolves.toBeUndefined();
    expect(msg.ack).toHaveBeenCalled();
  });

  it("drops a malformed preview message instead of poisoning the queue", async () => {
    runReleasePreviewCapture.mockClear();
    const msg = {
      body: { version: 1, type: "release-preview", storefrontId: "not-a-uuid" },
      ack: vi.fn(),
    };

    await processThemeBuildQueue({ messages: [msg] });

    expect(runReleasePreviewCapture).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalled();
  });
});
