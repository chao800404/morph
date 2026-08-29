import { describe, expect, it } from "vitest";

import {
  directoryOf,
  planDropMoves,
  planThemeFileMove,
  relativeSpecifier,
  resolveSpecifierToFile,
  type ThemeSourceFile,
} from "@/lib/storefront/ast/theme-file-move";

const files: ThemeSourceFile[] = [
  {
    path: "src/routes/index.tsx",
    content: `import Hero from "../components/Hero";
import Card from "../components/Card";

export default function Home() {
  return (
    <main>
      <Hero />
      <Card />
    </main>
  );
}`,
  },
  {
    path: "src/components/Hero.tsx",
    content: `import Card from "./Card";
import { cn } from "../lib/cn";

export default function Hero() {
  return <section className={cn("hero")}><Card /></section>;
}`,
  },
  { path: "src/components/Card.tsx", content: `export default function Card() {\n  return <div />;\n}` },
  { path: "src/lib/cn.ts", content: `export const cn = (...parts: string[]) => parts.join(" ");` },
];

function contentAt(result: ReturnType<typeof planThemeFileMove>, path: string) {
  if (!result.ok) throw new Error(result.reason);
  return result.writes.find((file) => file.path === path)?.content;
}

describe("relative path arithmetic", () => {
  it("walks up and back down between directories", () => {
    expect(relativeSpecifier("src/routes", "src/components/Hero")).toBe(
      "../components/Hero",
    );
    expect(relativeSpecifier("src/components", "src/components/Card")).toBe(
      "./Card",
    );
    // A bare "components/Hero" would be read as a package, not a sibling.
    expect(relativeSpecifier("src", "src/components/Hero")).toMatch(/^\.\//);
  });

  it("resolves a specifier to the file a bundler would pick", () => {
    const paths = new Set(files.map((file) => file.path));
    expect(
      resolveSpecifierToFile("src/routes/index.tsx", "../components/Hero", paths),
    ).toBe("src/components/Hero.tsx");
    expect(
      resolveSpecifierToFile("src/components/Hero.tsx", "./Card", paths),
    ).toBe("src/components/Card.tsx");
    expect(
      resolveSpecifierToFile("src/routes/index.tsx", "react", paths),
    ).toBeNull();
  });

  it("reads the directory of a path", () => {
    expect(directoryOf("src/components/Hero.tsx")).toBe("src/components");
    expect(directoryOf("morph.theme.json")).toBe("");
  });
});

describe("planThemeFileMove", () => {
  it("rewrites the importers of a moved file", () => {
    const result = planThemeFileMove(files, [
      { from: "src/components/Hero.tsx", to: "src/components/ui/Hero.tsx" },
    ]);

    expect(result.ok).toBe(true);
    expect(contentAt(result, "src/routes/index.tsx")).toContain(
      '"../components/ui/Hero"',
    );
    expect(result.ok && result.deletions).toEqual(["src/components/Hero.tsx"]);
  });

  it("rewrites the moved file's own imports, because its directory changed", () => {
    const result = planThemeFileMove(files, [
      { from: "src/components/Hero.tsx", to: "src/components/ui/Hero.tsx" },
    ]);

    const moved = contentAt(result, "src/components/ui/Hero.tsx");
    expect(moved).toContain('"../Card"');
    expect(moved).toContain('"../../lib/cn"');
  });

  it("leaves specifiers alone when neither end moved", () => {
    const result = planThemeFileMove(files, [
      { from: "src/lib/cn.ts", to: "src/lib/utils/cn.ts" },
    ]);

    // index.tsx imports neither the moved file nor anything that moved.
    expect(contentAt(result, "src/routes/index.tsx")).toBeUndefined();
  });

  it("moves a whole folder in one plan, keeping siblings pointing at each other", () => {
    const result = planThemeFileMove(files, [
      { from: "src/components/Hero.tsx", to: "src/components/ui/Hero.tsx" },
      { from: "src/components/Card.tsx", to: "src/components/ui/Card.tsx" },
    ]);

    // Hero and Card stay siblings, so the specifier between them is unchanged.
    expect(contentAt(result, "src/components/ui/Hero.tsx")).toContain('"./Card"');
    expect(contentAt(result, "src/routes/index.tsx")).toContain(
      '"../components/ui/Card"',
    );
  });

  it("keeps an explicit extension explicit", () => {
    const withExtension: ThemeSourceFile[] = [
      {
        path: "src/routes/index.tsx",
        content: `import Hero from "../components/Hero.tsx";`,
      },
      { path: "src/components/Hero.tsx", content: "export default function Hero() { return null; }" },
    ];
    const result = planThemeFileMove(withExtension, [
      { from: "src/components/Hero.tsx", to: "src/ui/Hero.tsx" },
    ]);

    expect(contentAt(result, "src/routes/index.tsx")).toContain(
      '"../ui/Hero.tsx"',
    );
  });

  it("follows a folder specifier to its index file", () => {
    const withIndex: ThemeSourceFile[] = [
      { path: "src/routes/index.tsx", content: `import Button from "../ui";` },
      { path: "src/ui/index.tsx", content: "export default function Button() { return null; }" },
    ];
    const result = planThemeFileMove(withIndex, [
      { from: "src/ui/index.tsx", to: "src/components/ui/index.tsx" },
    ]);

    expect(contentAt(result, "src/routes/index.tsx")).toContain(
      '"../components/ui/index"',
    );
  });

  it("refuses a move that would overwrite an existing file", () => {
    const result = planThemeFileMove(files, [
      { from: "src/components/Hero.tsx", to: "src/components/Card.tsx" },
    ]);

    expect(result).toMatchObject({ ok: false });
  });

  it("refuses when a file cannot be parsed, rather than writing half a rewrite", () => {
    const broken = [
      ...files,
      { path: "src/components/Broken.tsx", content: "export default function ( {" },
    ];
    const result = planThemeFileMove(broken, [
      { from: "src/components/Hero.tsx", to: "src/ui/Hero.tsx" },
    ]);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain("syntax error");
  });

  it("reports every rewritten specifier so the change can be described", () => {
    const result = planThemeFileMove(files, [
      { from: "src/components/Hero.tsx", to: "src/components/ui/Hero.tsx" },
    ]);

    expect(result.ok && result.rewrites.length).toBeGreaterThan(0);
  });
});

describe("the manifest follows the files it names", () => {
  const withManifest: ThemeSourceFile[] = [
    ...files,
    {
      path: "morph.theme.json",
      content: `{
  "name": "Theme",
  "components": {
    "hero.default": {
      "name": "Hero",
      "source": "src/components/Hero.tsx",
      "sectionType": "hero"
    }
  }
}`,
    },
  ];

  it("repoints a component at its new path", () => {
    const result = planThemeFileMove(withManifest, [
      { from: "src/components/Hero.tsx", to: "src/components/ui/Hero.tsx" },
    ]);

    expect(contentAt(result, "morph.theme.json")).toContain(
      '"src/components/ui/Hero.tsx"',
    );
  });

  it("leaves the rest of the manifest exactly as the author wrote it", () => {
    const result = planThemeFileMove(withManifest, [
      { from: "src/components/Hero.tsx", to: "src/components/ui/Hero.tsx" },
    ]);

    const manifest = contentAt(result, "morph.theme.json") ?? "";
    // Same shape, same indentation, one value different.
    expect(manifest).toContain('"sectionType": "hero"');
    expect(manifest.split("\n").length).toBe(
      withManifest[withManifest.length - 1].content.split("\n").length,
    );
  });
});

describe("planDropMoves", () => {
  const paths = files.map((file) => file.path);

  it("moves a dropped file into the folder it landed on", () => {
    expect(planDropMoves(paths, "src/components/Hero.tsx", "src/ui")).toEqual([
      { from: "src/components/Hero.tsx", to: "src/ui/Hero.tsx" },
    ]);
  });

  it("moves every file under a dropped folder, keeping its own name", () => {
    expect(planDropMoves(paths, "src/components", "src/ui")).toEqual([
      { from: "src/components/Hero.tsx", to: "src/ui/components/Hero.tsx" },
      { from: "src/components/Card.tsx", to: "src/ui/components/Card.tsx" },
    ]);
  });

  it("treats a drop on the folder something already lives in as nothing", () => {
    expect(planDropMoves(paths, "src/components/Hero.tsx", "src/components")).toEqual(
      [],
    );
  });

  it("refuses to drop a folder inside itself or its own descendant", () => {
    // Every path under it would have to move under a path that is itself
    // moving, which has no stable answer.
    expect(planDropMoves(paths, "src/components", "src/components")).toEqual([]);
    expect(
      planDropMoves(paths, "src", "src/components"),
    ).toEqual([]);
  });

  it("moves to the root when dropped outside every folder", () => {
    expect(planDropMoves(paths, "src/lib/cn.ts", "")).toEqual([
      { from: "src/lib/cn.ts", to: "cn.ts" },
    ]);
  });
});


