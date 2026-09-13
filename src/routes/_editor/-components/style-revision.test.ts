import { describe, expect, it } from "vitest";
import {
  isLatestStyleRevision,
  shouldAcceptStyleAck,
  shouldConfirmPreviewStyleRevision,
  shouldRevealPreviewForStyleAck,
  shouldStartInitialPreviewSync,
} from "./style-revision";

describe("style revision protocol", () => {
  it("rejects stale response and accepts latest response", () => {
    expect(isLatestStyleRevision(4, 5)).toBe(false);
    expect(isLatestStyleRevision(5, 5)).toBe(true);
  });
  it("accepts only the latest acknowledgement", () => {
    expect(shouldAcceptStyleAck(4, 5)).toBe(false);
    expect(shouldAcceptStyleAck(5, 5)).toBe(true);
  });
  it("reveals the preview only after its initial workspace revision applies", () => {
    expect(shouldRevealPreviewForStyleAck(5, 5, null)).toBe(false);
    expect(shouldRevealPreviewForStyleAck(4, 5, 4)).toBe(false);
    expect(shouldRevealPreviewForStyleAck(5, 5, 6)).toBe(false);
    expect(shouldRevealPreviewForStyleAck(5, 5, 5)).toBe(true);
    expect(shouldRevealPreviewForStyleAck(7, 7, 5)).toBe(true);
  });

  it("ties a confirmation to the preview that requested it", () => {
    const current = {
      confirmationPreviewKey: "preview-2",
      currentPreviewKey: "preview-2",
      initialPreviewKey: "preview-2",
      revision: 7,
      latestRequested: 7,
      initialPreviewRevision: 7,
    };

    expect(shouldConfirmPreviewStyleRevision(current)).toBe(true);
    expect(
      shouldConfirmPreviewStyleRevision({
        ...current,
        confirmationPreviewKey: "preview-1",
      }),
    ).toBe(false);
    expect(
      shouldConfirmPreviewStyleRevision({
        ...current,
        initialPreviewKey: "preview-1",
      }),
    ).toBe(false);
  });

  it("starts one initial source sync per iframe document", () => {
    const current = { key: "preview-2", readySequence: 3 };

    expect(shouldStartInitialPreviewSync(current, null)).toBe(true);
    expect(shouldStartInitialPreviewSync(current, current)).toBe(false);
    expect(
      shouldStartInitialPreviewSync(current, {
        key: current.key,
        readySequence: 2,
      }),
    ).toBe(true);
    expect(
      shouldStartInitialPreviewSync(current, {
        key: "preview-1",
        readySequence: current.readySequence,
      }),
    ).toBe(true);
  });
});
