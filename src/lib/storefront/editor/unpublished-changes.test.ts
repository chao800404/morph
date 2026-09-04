import { describe, expect, it } from "vitest";

import {
  describeThemeSourceChanges,
  describeUnpublishedChanges,
} from "./unpublished-changes";

const file = (path: string, content: string) => ({ path, content });
const snapshot = (entries: [string, string][]) => new Map(entries);

describe("describeThemeSourceChanges", () => {
  const published = snapshot([
    ["src/app.tsx", "a"],
    ["src/hero.tsx", "b"],
  ]);

  it("reports no change when the working source matches what shipped", () => {
    expect(
      describeThemeSourceChanges(
        [file("src/app.tsx", "a"), file("src/hero.tsx", "b")],
        published,
      ),
    ).toEqual({ changed: false });
  });

  it("stays unchanged however the files are ordered", () => {
    expect(
      describeThemeSourceChanges(
        [file("src/hero.tsx", "b"), file("src/app.tsx", "a")],
        published,
      ).changed,
    ).toBe(false);
  });

  it("names the file that differs", () => {
    expect(
      describeThemeSourceChanges(
        [file("src/app.tsx", "a"), file("src/hero.tsx", "CHANGED")],
        published,
      ),
    ).toEqual({ changed: true, reason: "modified", path: "src/hero.tsx" });
  });

  it("names a file that was added", () => {
    expect(
      describeThemeSourceChanges(
        [
          file("src/app.tsx", "a"),
          file("src/hero.tsx", "b"),
          file("src/new.tsx", "c"),
        ],
        published,
      ),
    ).toEqual({ changed: true, reason: "added", path: "src/new.tsx" });
  });

  it("names a file that was deleted", () => {
    expect(
      describeThemeSourceChanges([file("src/app.tsx", "a")], published),
    ).toEqual({ changed: true, reason: "removed", path: "src/hero.tsx" });
  });

  it("catches a rename, where the count alone would not", () => {
    // Same number of files, none matching by name. Comparing sizes only would
    // call this unchanged and leave a rename unpublishable.
    expect(
      describeThemeSourceChanges(
        [file("src/app.tsx", "a"), file("src/renamed.tsx", "b")],
        published,
      ).changed,
    ).toBe(true);
  });

  describe("with no published snapshot", () => {
    it("treats a theme that has never shipped as fully unpublished", () => {
      // The old test asked whether any file had version > 1 — "was ever
      // edited", which never becomes false again, so Publish stayed lit
      // forever once a snapshot was missing.
      expect(
        describeThemeSourceChanges([file("src/app.tsx", "a")], null),
      ).toEqual({ changed: true, reason: "never-published" });
    });

    it("still reports a brand new theme as publishable", () => {
      // Every file is at version 1 here. The old test called that "no
      // changes", which disabled Publish on a store that had never gone live.
      expect(
        describeThemeSourceChanges(
          [file("src/app.tsx", "a"), file("src/hero.tsx", "b")],
          null,
        ).changed,
      ).toBe(true);
    });

    it("has nothing to publish when there are no files at all", () => {
      expect(describeThemeSourceChanges([], null)).toEqual({ changed: false });
    });
  });
});

describe("describeUnpublishedChanges", () => {
  it("says which file would ship", () => {
    expect(
      describeUnpublishedChanges(
        { changed: true, reason: "modified", path: "src/hero.tsx" },
        false,
      ),
    ).toBe("Edited src/hero.tsx");
  });

  it("credits a content-only edit when the source is untouched", () => {
    expect(describeUnpublishedChanges({ changed: false }, true)).toBe(
      "Page content edited",
    );
  });

  it("says so plainly when there is nothing to publish", () => {
    expect(describeUnpublishedChanges({ changed: false }, false)).toBe(
      "Nothing to publish",
    );
  });
});

describe("an unresolved snapshot", () => {
  it("does not report every file as newly added", () => {
    // A revision stored against R2 keeps its files behind a manifest and
    // leaves `snapshot` empty. Treated as a real published state, the first
    // file compares as "added" and Publish stays lit on a store where nothing
    // changed. The caller passes null for this, and null means "never
    // published" — which is at least honest about what is known.
    const empty = new Map<string, string>();

    expect(
      describeThemeSourceChanges(
        [{ path: "src/app.tsx", content: "a" }],
        empty,
      ),
    ).toEqual({ changed: true, reason: "added", path: "src/app.tsx" });
  });
});
