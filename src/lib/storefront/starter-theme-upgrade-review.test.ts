import { describe, expect, it } from "vitest";
import {
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "./starter-theme-v3-files";
import { reviewStarterThemeUpgrade } from "./starter-theme-upgrade-review";

type File = { id: string; path: string; content: string; version: number };

const CONTENT = "src/morph/content.ts";

/** A workspace created today: source-first, no manifest. */
const sourceFirst = (edit: (files: File[]) => File[] = (files) => files) =>
  edit(
    starterThemeWorkspaceFiles().map((file, index) => ({
      id: `file-${index}`,
      path: file.path,
      content: file.content,
      version: 1,
    })),
  );
const setContent = (path: string, content: string) => (files: File[]) =>
  files.map((file) => (file.path === path ? { ...file, content } : file));
const without = (path: string) => (files: File[]) =>
  files.filter((file) => file.path !== path);
const withFile = (path: string, content: string) => (files: File[]) => [
  ...files,
  { id: `extra-${path}`, path, content, version: 7 },
];

/** An author's own edit, with a marker the compiler can derive. */
const AUTHORED_WITH_MARKER = `import type { ThemeContentFields } from "../morph/content-fields";

export type PrinciplesProps = { label?: string };

export const contentFields = {
  label: { type: "text", label: "Label", maxLength: 8 },
} as const satisfies ThemeContentFields;

export default function Principles({ label = "Why we choose differently" }: PrinciplesProps) {
  return (
    <section className="bg-stone-50">
      <p
        data-storefront-field="label"
        className="mb-14 text-xs"
      >
        {label}
      </p>
    </section>
  );
}
`;

describe("reviewStarterThemeUpgrade", () => {
  it("has nothing to change or keep on a current, untouched workspace", () => {
    const review = reviewStarterThemeUpgrade(sourceFirst());
    expect(review.applies).toBe(true);
    expect(review.changes).toEqual([]);
    expect(review.kept).toEqual([]);
  });

  it("shows an untouched older content module with its text before and after", () => {
    const review = reviewStarterThemeUpgrade(
      sourceFirst(
        setContent(CONTENT, LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
      ),
    );
    expect(review.changes).toEqual([
      {
        path: CONTENT,
        operation: "update",
        before: LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
        after: STARTER_THEME_CONTENT_MODULE_SOURCE,
      },
    ]);
    expect(review.kept).toEqual([]);
  });

  it.each([
    [
      "one added line",
      `${LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE}\n// mine`,
    ],
    [
      "CRLF line endings",
      LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE.replace(/\n/g, "\r\n"),
    ],
    [
      "formatting only",
      LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE.replace(/"/g, "'"),
    ],
    [
      "the trailing newline removed",
      LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE.replace(/\n$/, ""),
    ],
  ])(
    "keeps a content module changed by %s, byte for byte, and says so",
    (_label, content) => {
      const review = reviewStarterThemeUpgrade(
        sourceFirst(setContent(CONTENT, content)),
      );
      expect(review.changes.map((change) => change.path)).not.toContain(
        CONTENT,
      );
      expect(review.plan.files.map((file) => file.path)).not.toContain(CONTENT);
      expect(review.kept).toContainEqual({ path: CONTENT, reason: "changed" });
    },
  );

  it("keeps an edited content module with exports of the author's own", () => {
    const content = `${STARTER_THEME_CONTENT_MODULE_SOURCE}\nexport function myHelper() {\n  return 1;\n}\nexport type Mine = { a: string };\n`;
    const review = reviewStarterThemeUpgrade(
      sourceFirst(setContent(CONTENT, content)),
    );
    expect(review.changes).toEqual([]);
    expect(review.kept).toEqual([{ path: CONTENT, reason: "changed" }]);
  });

  it("does not add back a Starter file the author removed, and lists it", () => {
    const review = reviewStarterThemeUpgrade(sourceFirst(without(CONTENT)));
    expect(review.changes).toEqual([]);
    expect(review.kept).toContainEqual({ path: CONTENT, reason: "missing" });
  });

  it("does not edit a file the author changed to remove its markers, and lists it", () => {
    const files = sourceFirst(
      withFile("src/components/Principles.tsx", AUTHORED_WITH_MARKER),
    );
    // Code mode's bootstrap would still edit it in place.
    expect(
      createStarterThemeWorkspaceUpgradePlan(files).files.map(
        (file) => file.path,
      ),
    ).toContain("src/components/Principles.tsx");

    const review = reviewStarterThemeUpgrade(files);
    expect(review.plan.files.map((file) => file.path)).not.toContain(
      "src/components/Principles.tsx",
    );
    expect(review.kept).toContainEqual({
      path: "src/components/Principles.tsx",
      reason: "markers-kept",
    });
  });

  it("does not apply to a workspace of another framework", () => {
    const review = reviewStarterThemeUpgrade(
      sourceFirst(
        compose(
          setContent(CONTENT, LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
          withFile(
            "morph.theme.json",
            JSON.stringify({ router: { framework: "astro" }, components: {} }),
          ),
        ),
      ),
    );
    expect(review.applies).toBe(false);
    expect(review.changes).toEqual([]);
    expect(review.plan).toEqual({ files: [], deletions: [] });
  });

  it("names the plan: the same files give the same digest, any change another", () => {
    const files = sourceFirst(
      setContent(CONTENT, LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE),
    );
    const digest = reviewStarterThemeUpgrade(files).digest;
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(reviewStarterThemeUpgrade(files).digest).toBe(digest);
    // The same change under another file version is another plan: its guard
    // differs.
    expect(
      reviewStarterThemeUpgrade(
        files.map((file) =>
          file.path === CONTENT ? { ...file, version: 2 } : file,
        ),
      ).digest,
    ).not.toBe(digest);
  });
});

function compose(...edits: Array<(files: File[]) => File[]>) {
  return (files: File[]) =>
    edits.reduce((current, edit) => edit(current), files);
}
