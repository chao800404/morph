import { describe, expect, it } from "vitest";
import {
  advanceSelectionAfterTextPromotion,
  captureSelectionSourceBaseline,
  selectionSourceIsCurrent,
} from "./selection-source-baseline";

describe("selection source baseline", () => {
  const key = "index:hero:title";
  it("keeps the same source baseline for consecutive content-only saves", () => {
    const baseline = captureSelectionSourceBaseline(key, 1);
    for (const draftGeneration of [2, 3, 4]) {
      expect(draftGeneration).toBeGreaterThan(1);
      expect(selectionSourceIsCurrent(baseline, key, 1)).toBe(true);
    }
    expect(baseline?.sourceGeneration).toBe(1);
  });
  it("refuses changed source and never advances from an observed generation", () => {
    const baseline = captureSelectionSourceBaseline(key, 1);
    expect(selectionSourceIsCurrent(baseline, key, 2)).toBe(false);
    expect(baseline?.sourceGeneration).toBe(1);
    expect(
      selectionSourceIsCurrent(captureSelectionSourceBaseline(key, 2), key, 2),
    ).toBe(true);
  });
  it("advances only for the same selection's confirmed direct-successor promotion", () => {
    const baseline = captureSelectionSourceBaseline(key, 1);
    const next = advanceSelectionAfterTextPromotion(baseline, {
      selectionKey: key,
      sentSourceGeneration: 1,
      acceptedSourceGeneration: 2,
      confirmed: true,
    });
    expect(next?.sourceGeneration).toBe(2);
    expect(selectionSourceIsCurrent(next, key, 2)).toBe(true);
    expect(selectionSourceIsCurrent(next, key, 3)).toBe(false);
  });
  it.each([
    {
      selectionKey: "index:promo:title",
      sentSourceGeneration: 1,
      acceptedSourceGeneration: 2,
      confirmed: true,
    },
    {
      selectionKey: key,
      sentSourceGeneration: 2,
      acceptedSourceGeneration: 3,
      confirmed: true,
    },
    {
      selectionKey: key,
      sentSourceGeneration: 1,
      acceptedSourceGeneration: 3,
      confirmed: true,
    },
    {
      selectionKey: key,
      sentSourceGeneration: 1,
      acceptedSourceGeneration: 2,
      confirmed: false,
    },
  ])(
    "does not advance an unrelated, superseded or unconfirmed response: %j",
    (ack) => {
      const baseline = captureSelectionSourceBaseline(key, 1);
      expect(advanceSelectionAfterTextPromotion(baseline, ack)).toBe(baseline);
    },
  );
  it("fails closed without a valid baseline or for another target", () => {
    expect(captureSelectionSourceBaseline(key, 0)).toBeNull();
    expect(captureSelectionSourceBaseline(key, NaN)).toBeNull();
    expect(selectionSourceIsCurrent(null, key, 1)).toBe(false);
    expect(
      selectionSourceIsCurrent(
        captureSelectionSourceBaseline(key, 1),
        "index:promo:title",
        1,
      ),
    ).toBe(false);
  });
});
