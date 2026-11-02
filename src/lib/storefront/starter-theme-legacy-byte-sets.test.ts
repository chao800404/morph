/**
 * The byte-sets in `starter-theme-legacy-byte-sets.ts` are history: each must
 * stay exactly the file its source commit shipped, and the upgrade must match
 * it byte for byte and nothing else.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SHIPPED_BYTE_SET,
  LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS,
  type LegacyStarterThemeByteSet,
} from "./starter-theme-legacy-byte-sets";
import {
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";
import { LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SOURCE } from "./starter-theme-v3-files";

type Fixture = {
  starterVersion: number;
  sourceCommit: string;
  files: { path: string; content: string }[];
};

const FIXTURE_VERSIONS = [11, 15, 20, 26, 28] as const;
const fixtures = new Map<number, Fixture>(
  FIXTURE_VERSIONS.map((version) => [
    version,
    JSON.parse(
      readFileSync(
        join(__dirname, "__fixtures__", "starter-history", `v${version}.json`),
        "utf8",
      ),
    ) as Fixture,
  ]),
);

const sha256 = (content: string) =>
  createHash("sha256").update(content, "utf8").digest("hex");

// The gap rows of the T1 inventory (2026-10-29, section 3) the user chose to
// recognise. A byte-set dropped from the module, or one added without being
// listed here, fails the first test.
const EXPECTED_ROWS = [
  "src/components/CategoryShowcase.tsx 05fda18e5120",
  "src/components/CategoryShowcase.tsx 2364935d64e3",
  "src/components/CategoryShowcase.tsx 811d243ad6de",
  "src/components/CategoryShowcase.tsx e3c704cc68a3",
  "src/components/EditorialIntro.tsx 831ecbbf0840",
  "src/components/Footer.tsx 002785028f00",
  "src/components/Footer.tsx 3a30b8e7f308",
  "src/components/Header.tsx 216a587016a3",
  "src/components/Header.tsx 788521d2d93e",
  "src/components/Header.tsx 9855a5cbcd11",
  "src/components/Header.tsx f557c223cac2",
  "src/components/Hero.tsx 166e141b23fb",
  "src/components/Hero.tsx 58aaa82cc2d0",
  "src/components/ImageWithText.tsx 4fd74fd85910",
  "src/components/ImageWithText.tsx f96e43d83ac2",
  "src/components/Newsletter.tsx 36f9b826de9a",
  "src/components/Principles.tsx 956037903095",
  "src/routes/index.tsx ff53376047c2",
];

/** The newest history fixture at or before the last version that shipped `set`. */
function fixtureFor(set: LegacyStarterThemeByteSet): number {
  const last = Math.max(...set.shippedInVersions);
  return Math.max(...FIXTURE_VERSIONS.filter((version) => version <= last));
}

/** That fixture's workspace, with `content` at `set.path`. */
function workspaceWith(set: LegacyStarterThemeByteSet, content: string) {
  const files = fixtures.get(fixtureFor(set))!.files;
  expect(files.some((file) => file.path === set.path)).toBe(true);
  return files.map((file, index) => ({
    id: `file-${index}`,
    path: file.path,
    content: file.path === set.path ? content : file.content,
    version: 1,
  }));
}

const plannedWrite = (set: LegacyStarterThemeByteSet, content: string) => {
  const files = workspaceWith(set, content);
  const plan = createStarterThemeWorkspaceUpgradePlan(files, {
    editAuthoredFiles: false,
  });
  return {
    file: files.find((file) => file.path === set.path)!,
    write: plan.files.find((file) => file.path === set.path),
    deleted: plan.deletions.some((file) => file.path === set.path),
  };
};

/** One byte changed, near the middle of the file. */
function oneByteChanged(content: string): string {
  for (let i = Math.floor(content.length / 2); i < content.length; i += 1) {
    const char = content[i]!;
    if (/[a-z]/.test(char)) {
      return content.slice(0, i) + char.toUpperCase() + content.slice(i + 1);
    }
  }
  throw new Error("no lower-case letter to change");
}

const currentStarter = new Map(
  starterThemeWorkspaceFiles().map((file) => [file.path, file.content]),
);

describe("Starter legacy byte-sets", () => {
  it("are exactly the inventory rows chosen for recognition", () => {
    expect(
      LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS.map(
        (set) => `${set.path} ${set.sha256.slice(0, 12)}`,
      ).sort(),
    ).toEqual(EXPECTED_ROWS);
  });

  it.each(LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS)(
    "$path $sha256 hashes to its recorded sha256 and names a full commit",
    (set) => {
      expect(set.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(set.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sha256(set.content)).toBe(set.sha256);
      expect(set.shippedInVersions.length).toBeGreaterThan(0);
    },
  );

  it("holds no byte-set twice", () => {
    const contents = LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS.map(
      (set) => set.content,
    );
    expect(new Set(contents).size).toBe(contents.length);
  });

  // The history fixtures were taken from the same commits for v11, v15 and
  // v20, so for those byte-sets the source can be checked offline. The rest
  // (489db1e, a2042be, 2bdcd3e, a8ff24e, 4882253) were generated the same way
  // by executing the commit's Starter module; their recorded sha256 is checked
  // above.
  it("equal the history fixture file wherever the fixture is from the same commit", () => {
    let checked = 0;
    for (const set of LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS) {
      const fixture = [...fixtures.values()].find(
        (candidate) => candidate.sourceCommit === set.sourceCommit,
      );
      if (!fixture) continue;
      const file = fixture.files.find(
        (candidate) => candidate.path === set.path,
      );
      expect(file?.content, `${set.path} at ${set.sourceCommit}`).toBe(
        set.content,
      );
      checked += 1;
    }
    expect(checked).toBe(12);
  });
});

describe("upgrading a file on a recognised legacy byte-set", () => {
  it.each(LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS)(
    "replaces an untouched $path ($sha256)",
    (set) => {
      const { file, write, deleted } = plannedWrite(set, set.content);
      expect(deleted).toBe(false);
      expect(write).toBeDefined();
      expect(write!.expectMissing).toBeFalsy();
      expect(write!.expectedFileId).toBe(file.id);
      expect(write!.expectedVersion).toBe(file.version);
      expect(write!.content).not.toBe(set.content);
      if (currentStarter.has(set.path)) {
        expect(write!.content).toBe(currentStarter.get(set.path));
      }
    },
  );

  it.each(LEGACY_STARTER_THEME_SHIPPED_BYTE_SETS)(
    "keeps $path ($sha256) when it differs by one byte, a trailing newline or CRLF",
    (set) => {
      const variants: Record<string, string> = {
        "one byte changed": oneByteChanged(set.content),
        "trailing newline added": `${set.content}\n`,
        "CRLF line endings": set.content.replace(/\n/g, "\r\n"),
        "author line appended": `${set.content}\n// author edit\n`,
      };
      if (set.content.endsWith("\n")) {
        variants["trailing newline removed"] = set.content.slice(0, -1);
      }
      for (const [name, content] of Object.entries(variants)) {
        expect(content, name).not.toBe(set.content);
        // That one variant is itself an older recognised constant; see the
        // CategoryShowcase test below.
        if (
          content === LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SOURCE
        )
          continue;
        const { write, deleted } = plannedWrite(set, content);
        expect({ write, deleted }, `${set.path} ${name}`).toEqual({
          write: undefined,
          deleted: false,
        });
      }
    },
  );

  it("treats the v19/v20 CategoryShowcase and the older constant as two exact byte-sets", () => {
    const shipped =
      LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SHIPPED_BYTE_SET;
    // They differ by the trailing newline only.
    expect(shipped.content.endsWith("\n")).toBe(false);
    expect(LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SOURCE).toBe(
      `${shipped.content}\n`,
    );
    // Each is recognised as itself...
    expect(plannedWrite(shipped, shipped.content).write).toBeDefined();
    expect(
      plannedWrite(
        shipped,
        LEGACY_STARTER_THEME_CATEGORY_SHOWCASE_PATH_MARKED_SOURCE,
      ).write,
    ).toBeDefined();
    // ...and nothing near them is: no newline is trimmed or added to match.
    for (const content of [
      `${shipped.content}\n\n`,
      `${shipped.content}\r\n`,
      shipped.content.replace(/\n/g, "\r\n"),
      `${shipped.content.replace(/\n/g, "\r\n")}\r\n`,
      ` ${shipped.content}`,
    ]) {
      expect(plannedWrite(shipped, content).write).toBeUndefined();
    }
  });
});
