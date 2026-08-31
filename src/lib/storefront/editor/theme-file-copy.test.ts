import { describe, expect, it } from "vitest";
import { planThemeFileCopies } from "./theme-file-copy";

const file = (path: string) => ({
  path,
  content: `// ${path}`,
  mimeType: "text/typescript",
});

describe("planThemeFileCopies", () => {
  it("copies a file into a folder and allocates a VSCode-style copy name", () => {
    const plan = planThemeFileCopies({
      files: [file("src/Hero.tsx"), file("src/ui/Hero.tsx")],
      selectedPaths: ["src/Hero.tsx"],
      destinationFolder: "src/ui",
    });

    expect(plan).toMatchObject({
      ok: true,
      files: [{ path: "src/ui/Hero-copy.tsx" }],
    });
  });

  it("copies a folder tree atomically and preserves empty folders", () => {
    const plan = planThemeFileCopies({
      files: [file("src/cards/Hero.tsx"), file("src/cards/nested/Copy.tsx")],
      selectedPaths: ["src/cards"],
      destinationFolder: "src/ui",
      pendingFolders: ["src/cards/empty"],
    });

    expect(plan).toMatchObject({
      ok: true,
      files: [
        { path: "src/ui/cards/Hero.tsx" },
        { path: "src/ui/cards/nested/Copy.tsx" },
      ],
    });
    if (plan.ok) {
      expect(plan.createdFolders).toContain("src/ui/cards/empty");
    }
  });

  it("rejects copying a folder into itself", () => {
    expect(
      planThemeFileCopies({
        files: [file("src/cards/Hero.tsx")],
        selectedPaths: ["src/cards"],
        destinationFolder: "src/cards/nested",
      }),
    ).toEqual({
      ok: false,
      reason: "A folder cannot be copied inside itself.",
    });
  });

  it("rewrites a copied route's file-route literal to its new path", () => {
    const route = {
      path: "src/routes/about.tsx",
      content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/about")({});`,
      mimeType: "text/typescript",
    };
    const plan = planThemeFileCopies({
      files: [route],
      selectedPaths: [route.path],
      destinationFolder: "src/routes/company",
    });

    expect(plan).toMatchObject({
      ok: true,
      files: [
        {
          path: "src/routes/company/about.tsx",
          content: expect.stringContaining(
            'createFileRoute("/company/about")',
          ),
        },
      ],
    });
  });

  it("rewrites every route in a copied folder tree", () => {
    const files = [
      {
        path: "src/routes/blog/index.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/blog/")({});`,
        mimeType: "text/typescript",
      },
      {
        path: "src/routes/blog/post.tsx",
        content: `import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/blog/post")({});`,
        mimeType: "text/typescript",
      },
    ];
    const plan = planThemeFileCopies({
      files,
      selectedPaths: ["src/routes/blog"],
      destinationFolder: "src/routes/archive",
    });

    expect(plan).toMatchObject({
      ok: true,
      files: [
        {
          path: "src/routes/archive/blog/index.tsx",
          content: expect.stringContaining(
            'createFileRoute("/archive/blog/")',
          ),
        },
        {
          path: "src/routes/archive/blog/post.tsx",
          content: expect.stringContaining(
            'createFileRoute("/archive/blog/post")',
          ),
        },
      ],
    });
  });

  it("does not allow a second root route", () => {
    const plan = planThemeFileCopies({
      files: [
        {
          path: "src/routes/__root.tsx",
          content: "export const Route = createRootRoute({});",
          mimeType: "text/typescript",
        },
      ],
      selectedPaths: ["src/routes/__root.tsx"],
      destinationFolder: "src/routes",
    });

    expect(plan).toEqual({
      ok: false,
      reason: "The root route cannot be copied.",
    });
  });
});
