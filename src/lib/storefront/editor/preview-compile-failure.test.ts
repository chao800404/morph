import { describe, expect, it } from "vitest";
import {
  describePreviewCompileFailureCause,
  explainPreviewCompileFailure,
  missingSectionComponentPath,
  readPreviewCompileFailure,
  readPreviewCompileFailureCauses,
  type PreviewSourceCopy,
} from "./preview-compile-failure";

const ROUTE = "src/routes/error-recovery.tsx";
const WORKSPACE = new Set([
  ROUTE,
  "src/components/KeptCard.tsx",
  "src/components/ui/index.ts",
  "src/morph/content.ts",
  "src/assets/icon.svg",
]);
const ENTRY = "/__morph-theme-preview__/__entry.tsx";
const BROKEN_ROUTE = `import RecoveryCard from "../components/RecoveryCard";
export default function Route() {
  return <RecoveryCard />;
}
`;
/** The preview holding the broken route and every other workspace file. */
const PREVIEW: PreviewSourceCopy = {
  paths: WORKSPACE,
  contentOf: (path) => (path === ROUTE ? BROKEN_ROUTE : ""),
};

describe("which Theme files a page reports Vite refused", () => {
  it("names a workspace file that answered with a server error", () => {
    expect(
      readPreviewCompileFailure(
        {
          failedScripts: [ENTRY],
          failures: [{ status: 500, path: `/__morph-theme-preview__/${ROUTE}` }],
        },
        PREVIEW,
      ),
    ).toEqual({
      files: [ROUTE],
      source: { [ROUTE]: BROKEN_ROUTE },
      paths: [...WORKSPACE],
    });
  });

  it("needs a page that could not come up", () => {
    // A failed request with every script loaded is not an empty canvas.
    expect(
      readPreviewCompileFailure(
        {
          failedScripts: [],
          failures: [{ status: 500, path: `/__morph-theme-preview__/${ROUTE}` }],
        },
        PREVIEW,
      ),
    ).toBeNull();
  });

  it("leaves the proxy's interruption to its own recovery", () => {
    expect(
      readPreviewCompileFailure(
        {
          failedScripts: [ENTRY],
          failures: [{ status: 503, path: `/__morph-theme-preview__/${ROUTE}` }],
        },
        PREVIEW,
      ),
    ).toBeNull();
  });

  it("is not a compile error when the request was refused or missing", () => {
    for (const status of [403, 404]) {
      expect(
        readPreviewCompileFailure(
          {
            failedScripts: [ENTRY],
            failures: [{ status, path: `/__morph-theme-preview__/${ROUTE}` }],
          },
          PREVIEW,
        ),
      ).toBeNull();
    }
  });

  it("takes from the frame no path that is not one of the Theme's files", () => {
    // The frame runs Theme JavaScript; a path it invents is dropped rather
    // than shown.
    expect(
      readPreviewCompileFailure(
        {
          failedScripts: [ENTRY],
          failures: [
            { status: 500, path: "/__morph-theme-preview__/Your session expired" },
            { status: 500, path: "/__morph-theme-preview__/src/../../etc/passwd" },
            { status: 500, path: "/__morph-theme-preview__/%E0%A4%A" },
            {
              status: 500,
              path: "/__morph-theme-preview__/node_modules/.vite/deps/react.js",
            },
          ],
        },
        PREVIEW,
      ),
    ).toBeNull();
  });

  it("decodes the path, accepts it without the preview prefix, and names each file once", () => {
    expect(
      readPreviewCompileFailure(
        {
          failedScripts: [ENTRY],
          failures: [
            { status: 500, path: "/src/routes/error%2Drecovery.tsx" },
            { status: 500, path: `/__morph-theme-preview__/${ROUTE}` },
            {
              status: 502,
              path: "/__morph-theme-preview__/src/components/KeptCard.tsx",
            },
          ],
        },
        PREVIEW,
      )?.files,
    ).toEqual([ROUTE, "src/components/KeptCard.tsx"]);
  });
});

describe("what the editor sees wrong with a refused file", () => {
  it("names a relative import of a file that is not there", () => {
    const source = `import { content } from "../morph/content";
import RecoveryCard from "../components/RecoveryCard";
import KeptCard from "../components/KeptCard";
export default function Route() {
  return <RecoveryCard {...content("slot")} />;
}
`;
    const causes = explainPreviewCompileFailure(ROUTE, source, WORKSPACE);
    expect(causes).toEqual([
      { kind: "missing-import", specifier: "../components/RecoveryCard" },
    ]);
    expect(describePreviewCompileFailureCause(ROUTE, causes[0]!)).toBe(
      'src/routes/error-recovery.tsx imports "../components/RecoveryCard", which is not a file in this Theme.',
    );
  });

  it("names a syntax error with where it is", () => {
    const causes = explainPreviewCompileFailure(
      ROUTE,
      "export default function Route() {\n  return <main>;\n}\n",
      WORKSPACE,
    );
    expect(causes).toHaveLength(1);
    expect(causes[0]).toMatchObject({ kind: "syntax", line: 2 });
    expect(describePreviewCompileFailureCause(ROUTE, causes[0]!)).toMatch(
      /^src\/routes\/error-recovery\.tsx has a syntax error at line 2, column \d+: /,
    );
  });

  it("reads a .ts file as TypeScript, where a generic arrow is not JSX", () => {
    expect(
      explainPreviewCompileFailure(
        "src/lib/identity.ts",
        "export const identity = <T,>(value: T): T => value;\nexport const cast = <T>(value: unknown) => value as T;\n",
        WORKSPACE,
      ),
    ).toEqual([]);
  });

  it("does not claim what it cannot see", () => {
    const source = `import { createFileRoute } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { routeTree } from "../routeTree.gen";
import icon from "../assets/icon.svg?url";
import { Button } from "../components/ui";
export const Route = createFileRoute("/x")({ component: () => null });
`;
    // A package, an alias, the generated route tree, a bundler query and a
    // directory index all resolve somewhere the workspace list does not show.
    expect(explainPreviewCompileFailure(ROUTE, source, WORKSPACE)).toEqual([]);
  });
});

describe("a section whose component file is gone", () => {
  it("names the file a path ref points at when the Theme no longer has it", () => {
    expect(
      missingSectionComponentPath("src/components/RecoveryCard.tsx", WORKSPACE),
    ).toBe("src/components/RecoveryCard.tsx");
    expect(
      missingSectionComponentPath("src\\components\\RecoveryCard.tsx", WORKSPACE),
    ).toBe("src/components/RecoveryCard.tsx");
  });

  it("is not claimed for a file that is there, a legacy ref, or no file list", () => {
    expect(
      missingSectionComponentPath("src/components/KeptCard.tsx", WORKSPACE),
    ).toBeNull();
    // A manifest key, not a path: CMS-only or manifest-mapped, never "missing".
    expect(missingSectionComponentPath("hero.editorial", WORKSPACE)).toBeNull();
    expect(missingSectionComponentPath(undefined, WORKSPACE)).toBeNull();
    expect(
      missingSectionComponentPath("src/components/RecoveryCard.tsx", undefined),
    ).toBeNull();
  });
});

describe("reading a failure from the source the preview compiled", () => {
  const failure = readPreviewCompileFailure(
    {
      failedScripts: [ENTRY],
      failures: [{ status: 500, path: `/__morph-theme-preview__/${ROUTE}` }],
    },
    PREVIEW,
  )!;

  it("reads the reason from the preview's copy, not the draft", () => {
    // The author has already fixed the import, but the preview has not taken
    // it: the reason is still the preview's, and the draft is said to be ahead.
    const fixedDraft = BROKEN_ROUTE.replace("RecoveryCard", "KeptCard");
    expect(
      readPreviewCompileFailureCauses(failure, (path) =>
        path === ROUTE ? fixedDraft : null,
      ),
    ).toEqual([
      {
        path: ROUTE,
        causes: [
          { kind: "missing-import", specifier: "../components/RecoveryCard" },
        ],
        draftAhead: true,
      },
    ]);
  });

  it("is not ahead when the draft is what the preview compiled", () => {
    const [reading] = readPreviewCompileFailureCauses(failure, () => BROKEN_ROUTE);
    expect(reading!.draftAhead).toBe(false);
  });

  it("confirms nothing for a file that compiles, as for a 500 from elsewhere", () => {
    // A loader or server error can answer 500 for a module whose source is
    // fine; with no missing import or syntax error, no cause is claimed.
    const fine = readPreviewCompileFailure(
      {
        failedScripts: [ENTRY],
        failures: [{ status: 500, path: `/__morph-theme-preview__/${ROUTE}` }],
      },
      {
        paths: WORKSPACE,
        contentOf: () => 'import KeptCard from "../components/KeptCard";\n',
      },
    )!;
    expect(
      readPreviewCompileFailureCauses(fine, () => null)[0]!.causes,
    ).toEqual([]);
  });

  it("confirms nothing when the editor does not know what the preview holds", () => {
    const unknown = readPreviewCompileFailure(
      {
        failedScripts: [ENTRY],
        failures: [{ status: 500, path: `/__morph-theme-preview__/${ROUTE}` }],
      },
      { paths: WORKSPACE, contentOf: () => null },
    )!;
    expect(readPreviewCompileFailureCauses(unknown, () => BROKEN_ROUTE)).toEqual([
      { path: ROUTE, causes: [], draftAhead: false },
    ]);
  });
});
