import { describe, expect, it } from "vitest";
import {
  isPreviewHandshakePending,
  isLatestStyleRevision,
  shouldAcceptStyleAck,
  shouldConfirmPreviewStyleRevision,
  shouldRevealPreviewForStyleAck,
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

  it("stops the loading state after either acknowledgement or failure", () => {
    expect(isPreviewHandshakePending("preview-2", null, null)).toBe(true);
    expect(isPreviewHandshakePending("preview-2", "preview-2", null)).toBe(
      false,
    );
    expect(isPreviewHandshakePending("preview-2", null, "preview-2")).toBe(
      false,
    );
    expect(
      isPreviewHandshakePending("preview-2", "preview-1", "preview-1"),
    ).toBe(true);
  });
});
