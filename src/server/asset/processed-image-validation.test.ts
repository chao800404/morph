import { describe, expect, it } from "vitest";
import {
  checkProcessedImage,
  MAX_PROCESSED_IMAGE_BYTES,
} from "./processed-image-validation";

const png = (extra = 0) => {
  const bytes = new Uint8Array(8 + extra);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes.buffer;
};

describe("checkProcessedImage", () => {
  it("accepts a PNG", () => {
    expect(checkProcessedImage(png(10))).toEqual({ ok: true });
  });

  // It was stored as `image/png` whatever the bytes were, so the recorded type
  // was a claim nobody checked.
  it("refuses bytes that are not a PNG", () => {
    const notPng = new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0, 0, 0]);
    expect(checkProcessedImage(notPng.buffer)).toEqual({
      ok: false,
      reason: "not-a-png",
    });
  });

  it("refuses an empty payload", () => {
    expect(checkProcessedImage(new ArrayBuffer(0))).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses a payload too short to identify", () => {
    expect(checkProcessedImage(new Uint8Array([0x89, 0x50]).buffer)).toEqual({
      ok: false,
      reason: "not-a-png",
    });
  });

  it("refuses more than it will hold in memory", () => {
    const oversized = png(MAX_PROCESSED_IMAGE_BYTES);
    expect(checkProcessedImage(oversized)).toEqual({
      ok: false,
      reason: "too-large",
    });
  });
});
