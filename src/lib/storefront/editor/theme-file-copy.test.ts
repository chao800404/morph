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
          content: expect.stringContaining('createFileRoute("/company/about")'),
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
          content: expect.stringContaining('createFileRoute("/archive/blog/")'),
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

describe("planThemeFileCopies with binary files", () => {
  const binaryPaths = ["public/images/hero.png", "public/images/logo.png"];

  it("copies a binary file by reference, under a free name", () => {
    const plan = planThemeFileCopies({
      files: [],
      binaryPaths,
      selectedPaths: ["public/images/hero.png"],
      destinationFolder: "public/images",
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.files).toEqual([]);
    expect(plan.binaryCopies).toHaveLength(1);
    expect(plan.binaryCopies[0]!.from).toBe("public/images/hero.png");
    // Not over the source, nor over anything else there.
    expect(binaryPaths).not.toContain(plan.binaryCopies[0]!.to);
    expect(plan.binaryCopies[0]!.to.startsWith("public/images/")).toBe(true);
  });

  it("carries a folder's binary files with its source files", () => {
    const plan = planThemeFileCopies({
      files: [
        {
          path: "public/images/readme.txt",
          content: "notes",
          mimeType: "text/plain",
        },
      ],
      binaryPaths,
      selectedPaths: ["public/images"],
      destinationFolder: "public/assets",
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.files.map((file) => file.path)).toEqual([
      "public/assets/images/readme.txt",
    ]);
    expect(plan.binaryCopies).toEqual([
      { from: "public/images/hero.png", to: "public/assets/images/hero.png" },
      { from: "public/images/logo.png", to: "public/assets/images/logo.png" },
    ]);
  });
});
