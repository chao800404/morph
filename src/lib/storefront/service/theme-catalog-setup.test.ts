import { describe, expect, it } from "vitest";
import {
  planThemeCatalogFiles,
  planThemeCatalogUpgrades,
  reviewThemeCatalog,
} from "./theme-catalog-setup";
import { STARTER_THEME_FILES } from "../starter-theme-files";
import {
  STARTER_THEME_CATALOG_FILES,
  STARTER_THEME_CATALOG_UPGRADES,
  starterThemeCatalogSource,
} from "../starter-theme-catalog-files";

const withIds = (files: readonly { path: string; content: string }[]) =>
  files.map((file) => ({
    id: `file-${file.path}`,
    path: file.path,
    content: file.content,
    version: 3,
  }));

const AUTHORED_PRODUCTS_ROUTE = {
  path: "src/routes/products.tsx",
  content:
    'import {createFileRoute} from "@tanstack/react-router"; export const Route=createFileRoute("/products")({component: Custom}); function Custom(){return <p>Authored</p>}',
};

describe("the catalog review", () => {
  it("offers to install the catalog routes, additively, with each file's text", () => {
    const review = reviewThemeCatalog(withIds(STARTER_THEME_FILES), {
      hasProducts: true,
      framework: null,
    });
    expect(review.applies).toBe(true);
    expect(review.kind).toBe("install");
    expect(review.changes.map((change) => change.path).sort()).toEqual(
      STARTER_THEME_CATALOG_FILES.map((file) => file.path).sort(),
    );
    for (const change of review.changes) {
      expect(change.operation).toBe("create");
      expect(change.before).toBeNull();
      expect(change.after).toBe(starterThemeCatalogSource(change.path));
    }
    // Each new file is written only if it is still missing when applied.
    expect(
      review.plan.files.every(
        (file) => "expectMissing" in file && file.expectMissing,
      ),
    ).toBe(true);
    expect(review.kept).toEqual([]);
    expect(review.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("offers nothing to a Theme recorded as another framework, and says why", () => {
    // The Starter's own files, which would otherwise be offered the catalog:
    // the refusal is the record's, not a route conflict read from them.
    for (const framework of ["astro", "nuxt"]) {
      const review = reviewThemeCatalog(withIds(STARTER_THEME_FILES), {
        hasProducts: true,
        framework,
      });
      expect(review.applies, framework).toBe(false);
      expect(review.unavailable, framework).toMatch(
        /^THEME_FRAMEWORK_UNAVAILABLE: .* not offered to (astro|nuxt) Themes/,
      );
      expect(review.kind).toBeNull();
      expect(review.changes).toEqual([]);
      expect(review.plan.files).toEqual([]);
      expect(review.kept).toEqual([]);
    }
    // NULL and Start itself are offered it, as before.
    for (const framework of [null, undefined, "tanstack-start"]) {
      const review = reviewThemeCatalog(withIds(STARTER_THEME_FILES), {
        hasProducts: true,
        framework,
      });
      expect(review.applies).toBe(true);
      expect(review.unavailable).toBeNull();
      expect(review.kind).toBe("install");
    }
  });

  it("offers nothing to a store whose channel has no products", () => {
    const review = reviewThemeCatalog(withIds(STARTER_THEME_FILES), {
      hasProducts: false,
      framework: null,
    });
    expect(review.applies).toBe(false);
    expect(review.changes).toEqual([]);
    expect(review.plan.files).toEqual([]);
  });

  it("keeps a products route of the author's own and installs nothing over it", () => {
    const review = reviewThemeCatalog(
      withIds([...STARTER_THEME_FILES, AUTHORED_PRODUCTS_ROUTE]),
      { hasProducts: true, framework: null },
    );
    expect(review.changes).toEqual([]);
    expect(review.plan.files).toEqual([]);
    expect(new Set(review.kept.map((item) => item.reason))).toEqual(
      new Set(["products-route-exists"]),
    );
  });

  it("does not install over a file at one of its paths, and lists the rest as kept", () => {
    const review = reviewThemeCatalog(
      withIds([
        ...STARTER_THEME_FILES,
        {
          path: "src/components/ProductList.tsx",
          content: "export default function Custom(){return null}",
        },
      ]),
      { hasProducts: true, framework: null },
    );
    expect(review.changes).toEqual([]);
    expect(review.kept).toContainEqual({
      path: "src/components/ProductList.tsx",
      reason: "changed",
    });
    expect(review.kept).toContainEqual({
      path: "src/routes/products.index.tsx",
      reason: "missing",
    });
  });

  it("updates only an untouched older catalog file, and keeps an edited one", () => {
    const upgrade = STARTER_THEME_CATALOG_UPGRADES[0]!;
    const files = withIds(
      STARTER_THEME_CATALOG_FILES.map((file) =>
        file.path === upgrade.path
          ? { path: file.path, content: upgrade.legacyContent }
          : file,
      ),
    );
    const review = reviewThemeCatalog(files, {
      hasProducts: true,
      framework: null,
    });
    expect(review.kind).toBe("update");
    expect(review.changes).toEqual([
      {
        path: upgrade.path,
        operation: "update",
        before: upgrade.legacyContent,
        after: starterThemeCatalogSource(upgrade.path),
      },
    ]);

    const edited = reviewThemeCatalog(
      files.map((file) =>
        file.path === upgrade.path
          ? { ...file, content: `${file.content}\n// author's note\n` }
          : file,
      ),
      { hasProducts: true, framework: null },
    );
    expect(edited.changes).toEqual([]);
    expect(edited.kept).toContainEqual({
      path: upgrade.path,
      reason: "changed",
    });
  });

  it("does not add back catalog files the author removed, and lists them as kept", () => {
    const removed = [
      "src/components/ProductDetail.tsx",
      "src/routes/products.$slug.tsx",
    ];
    const review = reviewThemeCatalog(
      withIds([
        ...STARTER_THEME_FILES,
        ...STARTER_THEME_CATALOG_FILES.filter(
          (file) => !removed.includes(file.path),
        ),
      ]),
      { hasProducts: true, framework: null },
    );
    expect(review.kind).toBeNull();
    expect(review.changes).toEqual([]);
    expect(review.plan.files).toEqual([]);
    expect(review.kept).toEqual(
      removed.map((path) => ({ path, reason: "missing" })),
    );
  });

  it("has nothing to do once every catalog file is current", () => {
    const review = reviewThemeCatalog(
      withIds([...STARTER_THEME_FILES, ...STARTER_THEME_CATALOG_FILES]),
      { hasProducts: true, framework: null },
    );
    expect(review.kind).toBeNull();
    expect(review.changes).toEqual([]);
    expect(review.kept).toEqual([]);
  });
});

describe("automatic catalog source setup", () => {
  it("is idempotent and preserves existing source", () => {
    expect(
      planThemeCatalogFiles([
        ...STARTER_THEME_FILES,
        ...STARTER_THEME_CATALOG_FILES,
      ]),
    ).toEqual([]);
    expect(
      planThemeCatalogFiles([...STARTER_THEME_FILES, AUTHORED_PRODUCTS_ROUTE]),
    ).toEqual([]);
    expect(
      planThemeCatalogFiles([
        ...STARTER_THEME_FILES,
        {
          path: "src/components/ProductList.tsx",
          content: "export default function Custom(){return null}",
        },
      ]),
    ).toEqual([]);
  });
});

describe("catalog source upgrades", () => {
  /** One installed workspace, sitting on exactly one past generation. */
  const workspaceOn = (upgrade: { path: string; legacyContent: string }) =>
    [
      ...STARTER_THEME_CATALOG_FILES.filter(
        (file) => file.path !== upgrade.path,
      ),
      { path: upgrade.path, content: upgrade.legacyContent },
    ].map((file) => ({
      id: `file-${file.path}`,
      path: file.path,
      content: file.content,
      version: 3,
    }));

  it("has a legacy copy to recognise, and never one that is already current", () => {
    expect(STARTER_THEME_CATALOG_UPGRADES.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      expect(upgrade.legacyContent).not.toBe(
        starterThemeCatalogSource(upgrade.path),
      );
      // Two generations that share bytes would make the match ambiguous, and
      // the second would be unreachable.
      expect(seen.has(upgrade.legacyContent)).toBe(false);
      seen.add(upgrade.legacyContent);
    }
  });

  // A workspace sits on one generation at a time, so each is planned alone.
  // Gallery images with no reserved space resized the page as each one landed,
  // and hand-written `data-morph-node` named elements the compiler now names
  // by position — both are Morph's own bytes to correct.
  it("replaces an untouched legacy file with the current source", () => {
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      const planned = planThemeCatalogUpgrades(workspaceOn(upgrade));
      expect(planned, upgrade.path).toHaveLength(1);
      const [file] = planned;
      expect(file.path).toBe(upgrade.path);
      expect(file.content).toBe(starterThemeCatalogSource(upgrade.path));
      expect(file.content).not.toMatch(/data-morph-node/);
      // The write must lose to a concurrent edit rather than overwrite it.
      expect(file.expectedFileId).toBe(`file-${upgrade.path}`);
      expect(file.expectedVersion).toBe(3);
    }
  });

  it("still reserves space for the gallery images it upgrades", () => {
    const detail = starterThemeCatalogSource(
      "src/components/ProductDetail.tsx",
    );
    expect(detail).toContain("aspect-square w-full bg-stone-200");
  });

  it("leaves a file the author has edited alone", () => {
    for (const upgrade of STARTER_THEME_CATALOG_UPGRADES) {
      const edited = workspaceOn(upgrade).map((file) =>
        file.path === upgrade.path
          ? { ...file, content: `${file.content}\n// author's note\n` }
          : file,
      );
      expect(planThemeCatalogUpgrades(edited), upgrade.path).toEqual([]);
    }
  });

  it("writes nothing once every file is current", () => {
    const current = STARTER_THEME_CATALOG_FILES.map((file) => ({
      id: `file-${file.path}`,
      path: file.path,
      content: file.content,
      version: 3,
    }));
    expect(planThemeCatalogUpgrades(current)).toEqual([]);
  });
});
