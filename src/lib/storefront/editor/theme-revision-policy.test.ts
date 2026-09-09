import { describe, expect, it } from "vitest";
import {
  parseRevisionTimestamp,
  shouldRecordThemeRevision,
  THEME_REVISION_MIN_INTERVAL_MS,
} from "./theme-revision-policy";

const now = Date.parse("2026-09-09T12:00:00.000Z");

describe("when a workspace mutation is recorded", () => {
  it("always records a deletion", () => {
    // Deleting is the one act with nothing left to reconstruct from, so it is
    // recorded even a second after the last revision.
    expect(
      shouldRecordThemeRevision({
        reason: "delete",
        now,
        lastRevisionAt: now - 1_000,
      }),
    ).toBe(true);
  });

  it("always records what the caller explicitly asked for", () => {
    expect(
      shouldRecordThemeRevision({
        reason: "explicit",
        now,
        lastRevisionAt: now - 1_000,
      }),
    ).toBe(true);
  });

  it("records the first save of a workspace with no history", () => {
    expect(
      shouldRecordThemeRevision({ reason: "save", now, lastRevisionAt: null }),
    ).toBe(true);
  });

  it("throttles a save that follows a recent revision", () => {
    expect(
      shouldRecordThemeRevision({
        reason: "save",
        now,
        lastRevisionAt: now - (THEME_REVISION_MIN_INTERVAL_MS - 1),
      }),
    ).toBe(false);
  });

  it("records a save once the history has been quiet long enough", () => {
    expect(
      shouldRecordThemeRevision({
        reason: "save",
        now,
        lastRevisionAt: now - THEME_REVISION_MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });

  it("does not treat a revision stamped in the future as licence to record", () => {
    // A differing clock would otherwise make every save cross the threshold.
    expect(
      shouldRecordThemeRevision({
        reason: "save",
        now,
        lastRevisionAt: now + 60_000,
      }),
    ).toBe(false);
  });
});

describe("reading a stored revision timestamp", () => {
  it("parses an ISO timestamp", () => {
    expect(parseRevisionTimestamp("2026-09-09T12:00:00.000Z")).toBe(now);
  });

  it("treats an absent or unreadable value as no history", () => {
    expect(parseRevisionTimestamp(null)).toBeNull();
    expect(parseRevisionTimestamp("")).toBeNull();
    expect(parseRevisionTimestamp("not a date")).toBeNull();
  });
});
