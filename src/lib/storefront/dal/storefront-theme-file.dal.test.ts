import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontThemeFileDal } from "./storefront-theme-file.dal";

vi.mock("cloudflare:workers", () => ({
  env: {
    DATABASE: {
      prepare: (sql: string) => ({
        bind: (...args: any[]) => {
          const hasNumbered = /\?\d+/.test(sql);
          const params = hasNumbered
            ? Object.fromEntries(args.map((val, idx) => [String(idx + 1), val]))
            : args;
          return {
            run: () => {
              const stmt = sqlite.prepare(sql);
              const upper = sql.trim().toUpperCase();
              if (upper.startsWith("SELECT") || upper.includes("RETURNING")) {
                const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
                return { results: res };
              }
              const res = hasNumbered ? stmt.run(params) : stmt.run(...args);
              return { meta: { changes: res.changes } };
            },
            all: () => {
              const stmt = sqlite.prepare(sql);
              const res = hasNumbered ? stmt.all(params) : stmt.all(...args);
              return { results: res };
            },
            first: () => {
              const stmt = sqlite.prepare(sql);
              return hasNumbered ? stmt.get(params) : stmt.get(...args);
            },
          };
        },
      }),
      batch: async (statements: Array<any>) => {
        return statements.map((s) => {
          if (typeof s.run === "function") return s.run();
          if (typeof s.all === "function") return s.all();
          return {};
        });
      },
    },
  },
}));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefronts (
      id text PRIMARY KEY NOT NULL,
      sales_channel_id text NOT NULL,
      name text NOT NULL,
      domain text,
      status text NOT NULL,
      active_theme_id text,
      active_release_id text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      name text NOT NULL,
      status text NOT NULL,
      published_source_revision_id text,
      source_generation integer DEFAULT 1 NOT NULL,
      source_index_version integer,
      source_index_status text,
      source_index text,
      metadata text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_files (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      path text NOT NULL,
      content text NOT NULL,
      mime_type text,
      is_entry integer DEFAULT 0,
      version integer DEFAULT 1,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text,
      encoding text DEFAULT 'utf8' NOT NULL,
      blob_digest text,
      size_bytes integer
    );
    CREATE TABLE storefront_theme_revisions (
      id text PRIMARY KEY NOT NULL,
      storefront_id text NOT NULL,
      theme_id text NOT NULL,
      revision_number integer NOT NULL,
      source_generation integer,
      message text,
      source text,
      snapshot text,
      source_manifest text,
      source_index text,
      created_by text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      route_path text,
      updated_at text NOT NULL,
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_templates_active_name_unique
      ON storefront_theme_templates (theme_id, type, name)
      WHERE deleted_at IS NULL;
    CREATE UNIQUE INDEX storefront_theme_templates_active_route_unique
      ON storefront_theme_templates (theme_id, route_path)
      WHERE route_path IS NOT NULL AND deleted_at IS NULL;
    CREATE TABLE storefront_theme_route_document_moves (
      id text PRIMARY KEY NOT NULL,
      theme_id text NOT NULL,
      from_route_path text NOT NULL,
      to_route_path text NOT NULL,
      source_generation integer NOT NULL,
      sequence integer NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE storefront_content_publication_items (
      id text PRIMARY KEY NOT NULL,
      item_type text NOT NULL,
      content_id text NOT NULL,
      metadata text NOT NULL DEFAULT '{}',
      deleted_at text
    );
    CREATE UNIQUE INDEX storefront_theme_files_unique_path_idx
    ON storefront_theme_files (storefront_id, theme_id, path)
    WHERE deleted_at IS NULL;
  `);

  sqlite.exec(`
    INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
    VALUES ('storefront-a', 'channel-a', 'Store A', 'draft', 'now', 'now');
    INSERT INTO storefront_themes (id, storefront_id, name, status, source_generation, created_at, updated_at)
    VALUES ('theme-a', 'storefront-a', 'Theme A', 'draft', 1, 'now', 'now');
  `);

  const db = drizzle(sqlite, { schema: storefrontSchema });
  vi.mocked(getDb).mockResolvedValue(db as any);
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("storefront theme file DAL", () => {
  it("increments source_generation on saveFilesBatch", async () => {
    expect(
      await storefrontThemeFileDal.getSourceGeneration(
        "storefront-a",
        "theme-a",
      ),
    ).toBe(1);

    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function() { return <div>Home</div>; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration(
        "storefront-a",
        "theme-a",
      ),
    ).toBe(2);
  });

  it("writes and removes in one batch, which is what a move is", async () => {
    const [created] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/components/Card.tsx",
          content: "export default function Card() { return <div />; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/components/ui/Card.tsx",
          content: created.content,
          expectMissing: true,
        },
      ],
      {
        expectedSourceGeneration: 2,
        deletions: [
          {
            path: created.path,
            expectedFileId: created.id,
            expectedVersion: created.version,
          },
        ],
      },
    );

    const paths = (
      await storefrontThemeFileDal.listFiles("storefront-a", "theme-a")
    ).map((file) => file.path);

    // Both halves land together: writing without removing duplicates the file,
    // removing without writing loses it.
    expect(paths).toContain("src/components/ui/Card.tsx");
    expect(paths).not.toContain("src/components/Card.tsx");
  });

  it("moves a route-owned document and freezes its old publication path", async () => {
    const [routeFile] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/routes/about.tsx",
          content: 'export const Route = createFileRoute("/about")({});',
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, route_path, updated_at)
      VALUES ('about-document', 'theme-a', 'page', '/about', '/about', 'now');
      INSERT INTO storefront_content_publication_items
        (id, item_type, content_id, metadata)
      VALUES ('old-release', 'template', 'about-document', '{}');
      INSERT INTO storefront_content_publication_items
        (id, item_type, content_id, metadata)
      VALUES ('older-snapshot', 'template', 'about-document', '{"routePath":"/legacy-about"}');
    `);

    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/routes/company.tsx",
          content: 'export const Route = createFileRoute("/company")({});',
          expectMissing: true,
        },
      ],
      {
        expectedSourceGeneration: 2,
        deletions: [
          {
            path: routeFile!.path,
            expectedFileId: routeFile!.id,
            expectedVersion: routeFile!.version,
          },
        ],
        routePathMoves: [
          {
            fromSourcePath: "src/routes/about.tsx",
            toSourcePath: "src/routes/company.tsx",
          },
        ],
      },
    );

    expect(
      sqlite
        .prepare(
          "SELECT route_path FROM storefront_theme_templates WHERE id = 'about-document'",
        )
        .get(),
    ).toEqual({ route_path: "/company" });
    expect(
      sqlite
        .prepare(
          "SELECT metadata FROM storefront_content_publication_items WHERE id = 'old-release'",
        )
        .get(),
    ).toEqual({ metadata: '{"routePath":"/about"}' });
    expect(
      sqlite
        .prepare(
          "SELECT metadata FROM storefront_content_publication_items WHERE id = 'older-snapshot'",
        )
        .get(),
    ).toEqual({ metadata: '{"routePath":"/legacy-about"}' });
  });

  describe("rolling back across a route move", () => {
    const aboutRoute = {
      path: "src/routes/about.tsx",
      content: 'export const Route = createFileRoute("/about")({});',
    };

    /** Saves /about as revision #1 (generation 2). */
    async function saveAboutRevision() {
      const [routeFile] = await storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [{ ...aboutRoute, expectMissing: true }],
        { expectedSourceGeneration: 1, createRevision: true },
      );
      return routeFile!;
    }

    /** Renames /about to /company (generation 3). */
    async function renameAboutToCompany(routeFile: {
      path: string;
      id: string;
      version: number;
    }) {
      await storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/routes/company.tsx",
            content: 'export const Route = createFileRoute("/company")({});',
            expectMissing: true,
          },
        ],
        {
          expectedSourceGeneration: 2,
          deletions: [
            {
              path: routeFile.path,
              expectedFileId: routeFile.id,
              expectedVersion: routeFile.version,
            },
          ],
          routePathMoves: [
            {
              fromSourcePath: "src/routes/about.tsx",
              toSourcePath: "src/routes/company.tsx",
            },
          ],
        },
      );
    }

    /** What `ensureRouteTemplate` creates on a route's first content write. */
    const createRouteDocument = (id: string, path: string) =>
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
             (id, theme_id, type, name, route_path, updated_at)
           VALUES (?, 'theme-a', 'page', ?, ?, 'now')`,
        )
        .run(id, path, path);

    const placement = (id: string) =>
      sqlite
        .prepare(
          "SELECT route_path, name FROM storefront_theme_templates WHERE id = ?",
        )
        .get(id);

    const rollBackToAbout = () =>
      storefrontThemeFileDal.rollbackToRevision("storefront-a", "theme-a", 1, {
        expectedSourceGeneration: 3,
      });

    it("carries the document back with its route, name and all", async () => {
      const routeFile = await saveAboutRevision();
      createRouteDocument("about-document", "/about");
      await renameAboutToCompany(routeFile);
      expect(placement("about-document")).toEqual({
        route_path: "/company",
        name: "/company",
      });

      const files = await rollBackToAbout();

      expect(files.map((file) => file.path)).toEqual(["src/routes/about.tsx"]);
      expect(placement("about-document")).toEqual({
        route_path: "/about",
        name: "/about",
      });
      // The move back is recorded too, so rolling the rollback back works.
      expect(
        sqlite
          .prepare(
            `SELECT from_route_path, to_route_path, source_generation
             FROM storefront_theme_route_document_moves
             ORDER BY source_generation`,
          )
          .all(),
      ).toEqual([
        {
          from_route_path: "/about",
          to_route_path: "/company",
          source_generation: 3,
        },
        {
          from_route_path: "/company",
          to_route_path: "/about",
          source_generation: 4,
        },
      ]);
    });

    it("carries content first written after the route was renamed", async () => {
      const routeFile = await saveAboutRevision();
      await renameAboutToCompany(routeFile);
      // /about had no document when it moved; /company's first write made one.
      createRouteDocument("written-later", "/company");

      await expect(
        storefrontThemeFileDal.planRouteDocumentRollback("theme-a", {
          sourceGeneration: 2,
          paths: [aboutRoute.path],
        }),
      ).resolves.toMatchObject({
        ok: true,
        documentMoves: [
          {
            templateId: "written-later",
            fromRoutePath: "/company",
            toRoutePath: "/about",
          },
        ],
      });
      await rollBackToAbout();
      expect(placement("written-later")).toEqual({
        route_path: "/about",
        name: "/about",
      });
    });

    it("lets the old path get a document of its own after a rename", async () => {
      const routeFile = await saveAboutRevision();
      createRouteDocument("about-document", "/about");
      await renameAboutToCompany(routeFile);

      // Would hit the (theme, type, name) index if the name stayed /about.
      expect(() => createRouteDocument("new-about", "/about")).not.toThrow();
    });

    it("refuses when the old path has a document of its own again", async () => {
      const routeFile = await saveAboutRevision();
      createRouteDocument("about-document", "/about");
      await renameAboutToCompany(routeFile);
      createRouteDocument("new-about", "/about");

      await expect(rollBackToAbout()).rejects.toThrow(
        "ROLLBACK_ROUTE_DOCUMENT_CONFLICT",
      );
      expect(placement("about-document")).toEqual({
        route_path: "/company",
        name: "/company",
      });
      await expect(
        storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
      ).resolves.toBe(3);
    });

    it("refuses a revision without its generation that would strand content", async () => {
      const routeFile = await saveAboutRevision();
      createRouteDocument("about-document", "/about");
      await renameAboutToCompany(routeFile);
      sqlite.exec(
        "UPDATE storefront_theme_revisions SET source_generation = NULL",
      );

      await expect(rollBackToAbout()).rejects.toThrow(
        "ROLLBACK_ROUTE_DOCUMENT_CONFLICT",
      );
      expect(placement("about-document")).toEqual({
        route_path: "/company",
        name: "/company",
      });
    });

    it("allows a revision without its generation when no content is stranded", async () => {
      await saveAboutRevision();
      createRouteDocument("about-document", "/about");
      await storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/routes/team.tsx",
            content: 'export const Route = createFileRoute("/team")({});',
            expectMissing: true,
          },
        ],
        { expectedSourceGeneration: 2 },
      );
      sqlite.exec(
        "UPDATE storefront_theme_revisions SET source_generation = NULL",
      );

      const files = await rollBackToAbout();
      expect(files.map((file) => file.path)).toEqual([aboutRoute.path]);
      expect(placement("about-document")).toEqual({
        route_path: "/about",
        name: "/about",
      });
    });
  });

  it("refuses to move a page document onto a path another document is named after", async () => {
    const [routeFile] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/routes/about.tsx",
          content: 'export const Route = createFileRoute("/about")({});',
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, route_path, updated_at)
      VALUES
        ('about-document', 'theme-a', 'page', '/about', '/about', 'now'),
        ('stale-name', 'theme-a', 'page', '/company', NULL, 'now');
    `);

    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/routes/company.tsx",
            content: 'export const Route = createFileRoute("/company")({});',
            expectMissing: true,
          },
        ],
        {
          expectedSourceGeneration: 2,
          deletions: [
            {
              path: routeFile!.path,
              expectedFileId: routeFile!.id,
              expectedVersion: routeFile!.version,
            },
          ],
          routePathMoves: [
            {
              fromSourcePath: "src/routes/about.tsx",
              toSourcePath: "src/routes/company.tsx",
            },
          ],
        },
      ),
    ).rejects.toThrow("ROUTE_DOCUMENT_MOVE_CONFLICT");
  });

  it("refuses to move an owned page document onto a shared template route", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, route_path, updated_at)
      VALUES ('about-document', 'theme-a', 'page', '/about', '/about', 'now');
    `);

    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/routes/products/new.tsx",
            content:
              "export const Route = createFileRoute('/products/new')({});",
            expectMissing: true,
          },
        ],
        {
          expectedSourceGeneration: 1,
          deletions: [
            {
              path: "src/routes/about.tsx",
              expectedFileId: "route-file",
              expectedVersion: 1,
            },
          ],
          routePathMoves: [
            {
              fromSourcePath: "src/routes/about.tsx",
              toSourcePath: "src/routes/products/new.tsx",
            },
          ],
        },
      ),
    ).rejects.toThrow("ROUTE_DOCUMENT_MOVE_UNSUPPORTED");
  });

  it("strictly requires expectedSourceGeneration at the DAL layer", async () => {
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/pages/index.tsx",
            content: "export default function() { return <div>Home</div>; }",
            expectMissing: true,
          },
        ],
        undefined as any,
      ),
    ).rejects.toThrow("expectedSourceGeneration is required");
  });

  it("rejects an empty workspace instead of creating an unusable revision", async () => {
    await expect(
      storefrontThemeFileDal.createRevision("storefront-a", "theme-a", {
        expectedSourceGeneration: 1,
      }),
    ).rejects.toThrow("EMPTY_THEME_WORKSPACE");

    await expect(
      storefrontThemeFileDal.listRevisions("storefront-a", "theme-a"),
    ).resolves.toMatchObject({
      revisions: [],
      pagination: { total: 0 },
    });
  });

  it("freezes source revision without incrementing source_generation and guards with OCC", async () => {
    // Save a file so source_generation becomes 2
    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function() { return <div>Home</div>; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration(
        "storefront-a",
        "theme-a",
      ),
    ).toBe(2);

    // Freezing with matching expectedSourceGeneration (2) succeeds and DOES NOT bump generation
    const rev = await storefrontThemeFileDal.createRevision(
      "storefront-a",
      "theme-a",
      {
        expectedSourceGeneration: 2,
        message: "Frozen checkpoint",
        source: "publish",
      },
    );

    expect(rev.id).toBeDefined();
    expect(rev.message).toBe("Frozen checkpoint");
    expect(rev.source).toBe("publish");

    // Generation must remain 2 after snapshot
    expect(
      await storefrontThemeFileDal.getSourceGeneration(
        "storefront-a",
        "theme-a",
      ),
    ).toBe(2);

    // Attempting to freeze with stale expectedSourceGeneration (e.g. 1) rejects due to OCC
    await expect(
      storefrontThemeFileDal.createRevision("storefront-a", "theme-a", {
        expectedSourceGeneration: 1,
        message: "Stale checkpoint",
      }),
    ).rejects.toThrow("CONFLICT_SOURCE_GENERATION_MISMATCH");
  });

  it("pages revision history and reports the total the pager needs", async () => {
    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [{ path: "src/pages/index.tsx", content: "v1", expectMissing: true }],
      { expectedSourceGeneration: 1 },
    );

    for (let i = 0; i < 3; i += 1) {
      await storefrontThemeFileDal.createRevision("storefront-a", "theme-a", {
        expectedSourceGeneration: 2,
        message: `checkpoint ${i + 1}`,
      });
    }

    const firstPage = await storefrontThemeFileDal.listRevisions(
      "storefront-a",
      "theme-a",
      { limit: 2, offset: 0 },
    );
    expect(firstPage.revisions).toHaveLength(2);
    // The total must come from a count, not the row count: a full page is
    // otherwise indistinguishable from the last page.
    expect(firstPage.pagination).toMatchObject({
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });

    const secondPage = await storefrontThemeFileDal.listRevisions(
      "storefront-a",
      "theme-a",
      { limit: 2, offset: 2 },
    );
    expect(secondPage.revisions).toHaveLength(1);
    expect(secondPage.pagination.page).toBe(2);

    // Newest first, and the pages must not overlap.
    const numbers = [...firstPage.revisions, ...secondPage.revisions].map(
      (revision) => revision.revisionNumber,
    );
    expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    expect(new Set(numbers).size).toBe(3);
  });

  it("clamps an out-of-range page size instead of trusting the caller", async () => {
    const page = await storefrontThemeFileDal.listRevisions(
      "storefront-a",
      "theme-a",
      { limit: 5000, offset: -10 },
    );
    expect(page.pagination.limit).toBe(100);
    expect(page.pagination.page).toBe(1);
  });

  it("finds a revision by number without reading the whole history", async () => {
    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [{ path: "src/pages/index.tsx", content: "v1", expectMissing: true }],
      { expectedSourceGeneration: 1 },
    );
    const created = await storefrontThemeFileDal.createRevision(
      "storefront-a",
      "theme-a",
      { expectedSourceGeneration: 2, message: "target" },
    );

    const found = await storefrontThemeFileDal.findRevisionByNumber(
      "storefront-a",
      "theme-a",
      created.revisionNumber,
    );
    expect(found?.id).toBe(created.id);
    expect(found?.message).toBe("target");

    expect(
      await storefrontThemeFileDal.findRevisionByNumber(
        "storefront-a",
        "theme-a",
        9999,
      ),
    ).toBeNull();

    // Another tenant must not reach this revision by number.
    expect(
      await storefrontThemeFileDal.findRevisionByNumber(
        "storefront-b",
        "theme-a",
        created.revisionNumber,
      ),
    ).toBeNull();
  });

  it("stores R2-backed revisions with a manifest and no duplicated D1 source payload", async () => {
    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function() { return <div>Home</div>; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    const rev = await storefrontThemeFileDal.createRevision(
      "storefront-a",
      "theme-a",
      {
        expectedSourceGeneration: 2,
        sourceManifest: {
          version: 1,
          algorithm: "sha256",
          files: [
            {
              path: "src/pages/index.tsx",
              digest: "a".repeat(64),
              sizeBytes: 53,
              mimeType: "text/typescript",
              isEntry: true,
            },
          ],
        },
      },
    );

    expect(rev.sourceManifest?.version).toBe(1);
    expect(rev.snapshot).toEqual([]);
  });

  it("rejects saveFilesBatch with CONFLICT_SOURCE_GENERATION_MISMATCH when expectedSourceGeneration does not match server", async () => {
    // Server generation is 1. Client attempts to save expecting 99
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/pages/index.tsx",
            content: "export default function() { return <div>Home</div>; }",
            expectMissing: true,
          },
        ],
        { expectedSourceGeneration: 99 },
      ),
    ).rejects.toThrow("CONFLICT_SOURCE_GENERATION_MISMATCH");
  });

  it("rejects saveFilesBatch with CONFLICT_VERSION_MISMATCH when file version mismatches but generation matches", async () => {
    // Save file at gen 1 -> gen becomes 2, file version becomes 1
    const [file] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "initial content",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    // Attempt to update with wrong expectedVersion (e.g. 99) while expectedSourceGeneration is 2
    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/pages/index.tsx",
            content: "new content",
            expectedFileId: file.id,
            expectedVersion: 99,
          },
        ],
        { expectedSourceGeneration: 2 },
      ),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");
  });

  it("increments source_generation on deleteFile with matching expectedSourceGeneration", async () => {
    const [file] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/components/Header.tsx",
          content: "export const Header = () => null;",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration(
        "storefront-a",
        "theme-a",
      ),
    ).toBe(2);

    await storefrontThemeFileDal.deleteFile(
      "storefront-a",
      "theme-a",
      "src/components/Header.tsx",
      file.id,
      file.version,
      { expectedSourceGeneration: 2 },
    );

    expect(
      await storefrontThemeFileDal.getSourceGeneration(
        "storefront-a",
        "theme-a",
      ),
    ).toBe(3);
  });

  it("saves route files and deletes an obsolete page in one OCC generation", async () => {
    const [legacyPage] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function LegacyPage() { return null; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/routes/index.tsx",
          content: "export const Route = {};",
          expectMissing: true,
        },
      ],
      {
        expectedSourceGeneration: 2,
        deletions: [
          {
            path: legacyPage.path,
            expectedFileId: legacyPage.id,
            expectedVersion: legacyPage.version,
          },
        ],
        createRevision: true,
        revisionMessage: "Adopt route workspace",
      },
    );

    await expect(
      storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).resolves.toBe(3);
    await expect(
      storefrontThemeFileDal.listFiles("storefront-a", "theme-a"),
    ).resolves.toEqual([
      expect.objectContaining({ path: "src/routes/index.tsx" }),
    ]);
  });

  it("rolls back route writes when an atomic deletion precondition is stale", async () => {
    const [legacyPage] = await storefrontThemeFileDal.saveFilesBatch(
      "storefront-a",
      "theme-a",
      [
        {
          path: "src/pages/index.tsx",
          content: "export default function LegacyPage() { return null; }",
          expectMissing: true,
        },
      ],
      { expectedSourceGeneration: 1 },
    );

    await expect(
      storefrontThemeFileDal.saveFilesBatch(
        "storefront-a",
        "theme-a",
        [
          {
            path: "src/routes/index.tsx",
            content: "export const Route = {};",
            expectMissing: true,
          },
        ],
        {
          expectedSourceGeneration: 2,
          deletions: [
            {
              path: legacyPage.path,
              expectedFileId: legacyPage.id,
              expectedVersion: legacyPage.version + 1,
            },
          ],
        },
      ),
    ).rejects.toThrow("CONFLICT_VERSION_MISMATCH");

    await expect(
      storefrontThemeFileDal.getSourceGeneration("storefront-a", "theme-a"),
    ).resolves.toBe(2);
    const files = await storefrontThemeFileDal.listFiles(
      "storefront-a",
      "theme-a",
    );
    expect(files.map((file) => file.path)).toEqual(["src/pages/index.tsx"]);
  });

  it("initializes starter theme idempotently without duplicating files or revisions", async () => {
    const files1 = await storefrontThemeFileDal.initStarterTheme(
      "storefront-a",
      "theme-a",
    );
    expect(files1.length).toBeGreaterThan(0);
    const gen1 = await storefrontThemeFileDal.getSourceGeneration(
      "storefront-a",
      "theme-a",
    );

    // Second call should return existing files cleanly without incrementing generation
    const files2 = await storefrontThemeFileDal.initStarterTheme(
      "storefront-a",
      "theme-a",
    );
    expect(files2.length).toBe(files1.length);
    const gen2 = await storefrontThemeFileDal.getSourceGeneration(
      "storefront-a",
      "theme-a",
    );
    expect(gen2).toBe(gen1);
  });

  it("rolls back to revision with expectedSourceGeneration OCC guard", async () => {
    await storefrontThemeFileDal.initStarterTheme("storefront-a", "theme-a");
    const gen = await storefrontThemeFileDal.getSourceGeneration(
      "storefront-a",
      "theme-a",
    );

    // Rollback with matching generation
    const rolledBack = await storefrontThemeFileDal.rollbackToRevision(
      "storefront-a",
      "theme-a",
      1,
      { expectedSourceGeneration: gen ?? 1 },
    );
    expect(rolledBack.length).toBeGreaterThan(0);

    // Rollback with stale generation should fail
    await expect(
      storefrontThemeFileDal.rollbackToRevision("storefront-a", "theme-a", 1, {
        expectedSourceGeneration: 999,
      }),
    ).rejects.toThrow();
  });
});
