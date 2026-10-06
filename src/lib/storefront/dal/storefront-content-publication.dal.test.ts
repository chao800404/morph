import Database from "better-sqlite3";
import { getDb } from "@/db";
import * as storefrontSchema from "@/db/storefront.schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storefrontContentPublicationDal } from "./storefront-content-publication.dal";
import type { StorefrontContentPublicationDraft } from "./storefront-content-publication.dal";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/db", () => ({ getDb: vi.fn() }));

let sqlite: Database.Database;

const doc = (marker: string) =>
  JSON.stringify({ version: 1, sections: [{ id: marker }] });

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE storefront_themes (
      id text PRIMARY KEY,
      storefront_id text NOT NULL,
      deleted_at text
    );
    INSERT INTO storefront_themes VALUES ('theme-a', 'storefront-a', NULL);
    CREATE TABLE storefront_theme_templates (
      id text PRIMARY KEY,
      theme_id text NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      route_path text,
      draft_revision_id text,
      published_revision_id text,
      deleted_at text
    );
    CREATE TABLE storefront_theme_template_revisions (
      id text PRIMARY KEY,
      template_id text NOT NULL,
      document text NOT NULL
    );
    CREATE TABLE storefront_pages (
      id text PRIMARY KEY,
      storefront_id text NOT NULL,
      handle text NOT NULL,
      published_revision_id text,
      deleted_at text
    );
    CREATE TABLE storefront_page_revisions (
      id text PRIMARY KEY,
      page_id text NOT NULL,
      document text NOT NULL
    );
  `);
  vi.mocked(getDb).mockResolvedValue(
    drizzle(sqlite, { schema: storefrontSchema }) as never,
  );
});

describe("readDocumentsForDraft", () => {
  it("rejects a frozen template role attached to a Page", async () => {
    const input: {
      themeId: string;
      publication: StorefrontContentPublicationDraft;
    } = fixture("page");
    input.publication.items[0]!.metadata = { templateType: "layout" };
    await expect(
      storefrontContentPublicationDal.readDocumentsForDraft(input),
    ).rejects.toThrow("non-template item");
  });
  it("validates layout scope from the frozen role, without copying the current role into legacy snapshots", async () => {
    const input: {
      themeId: string;
      publication: StorefrontContentPublicationDraft;
    } = fixture();
    input.publication.items[0]!.metadata = { templateType: "layout" };
    sqlite
      .prepare(
        "UPDATE storefront_theme_template_revisions SET document = ? WHERE id = 'selected'",
      )
      .run(JSON.stringify({ version: 1, sections: [] }));
    const result =
      await storefrontContentPublicationDal.readDocumentsForDraft(input);
    expect(result[0]?.item.metadata?.templateType).toBe("layout");
    delete input.publication.items[0]!.metadata;
    expect(
      (await storefrontContentPublicationDal.readDocumentsForDraft(input))[0]
        ?.item.metadata,
    ).toBeUndefined();
  });
  it("serves new publication template roles even if mutable type or route changes", async () => {
    fixture();
    sqlite.exec(
      `CREATE TABLE storefront_content_publication_items (id text, publication_id text, item_type text, content_id text, revision_id text, metadata text, deleted_at text); INSERT INTO storefront_content_publication_items VALUES ('item', 'pub', 'template', 'target', 'selected', '{"templateType":"index"}', NULL); UPDATE storefront_theme_templates SET type = 'page', route_path = '/changed';`,
    );
    expect(
      await storefrontContentPublicationDal.getPublishedTemplateDocument({
        publicationId: "pub",
        templateType: "index",
      }),
    ).not.toBeNull();
    expect(
      await storefrontContentPublicationDal.getPublishedTemplateDocument({
        publicationId: "pub",
        templateType: "page",
      }),
    ).toBeNull();
    expect(
      await storefrontContentPublicationDal.getPublishedRouteDocument({
        publicationId: "pub",
        routePath: "/changed",
      }),
    ).toBeNull();
  });
  function fixture(itemType: "template" | "page" = "template") {
    const document = JSON.stringify({
      version: 1,
      sections: [],
      renderPolicy: { mode: "ssr" },
    });
    if (itemType === "template") {
      sqlite
        .prepare(
          `INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, draft_revision_id, published_revision_id)
        VALUES ('target', 'theme-a', 'index', 'Target', 'new-draft', 'selected')`,
        )
        .run();
      sqlite
        .prepare(
          "INSERT INTO storefront_theme_template_revisions VALUES ('selected', 'target', ?)",
        )
        .run(document);
      sqlite
        .prepare(
          "INSERT INTO storefront_theme_template_revisions VALUES ('new-draft', 'target', ?)",
        )
        .run(
          JSON.stringify({
            version: 1,
            sections: [],
            renderPolicy: { mode: "ssg" },
          }),
        );
    } else {
      sqlite.exec(
        "INSERT INTO storefront_pages VALUES ('target', 'storefront-a', 'renamed', 'selected', 'deleted')",
      );
      sqlite
        .prepare(
          "INSERT INTO storefront_page_revisions VALUES ('selected', 'target', ?)",
        )
        .run(document);
    }
    return {
      themeId: "theme-a",
      publication: {
        id: "publication-a",
        storefrontId: "storefront-a",
        createdBy: null,
        createdAt: "now",
        updatedAt: "now",
        items: [
          {
            id: "item-a",
            publicationId: "publication-a",
            itemType,
            contentId: "target",
            revisionId: "selected",
          },
        ],
      },
    };
  }

  it("reads the selected revision, never the newer draft pointer", async () => {
    const result =
      await storefrontContentPublicationDal.readDocumentsForDraft(fixture());
    expect(result[0]?.document.renderPolicy).toEqual({ mode: "ssr" });
    expect(result[0]?.item.revisionId).toBe("selected");
  });

  it("retains a selected Page revision after its mutable Page is deleted", async () => {
    const result = await storefrontContentPublicationDal.readDocumentsForDraft(
      fixture("page"),
    );
    expect(result[0]?.document.renderPolicy).toEqual({ mode: "ssr" });
  });

  it("rejects another storefront's Theme", async () => {
    const input = fixture();
    input.publication.storefrontId = "storefront-b";
    await expect(
      storefrontContentPublicationDal.readDocumentsForDraft(input),
    ).rejects.toThrow("Theme ownership mismatch");
  });

  it("rejects another Theme's template revision", async () => {
    const input = fixture();
    sqlite.exec("UPDATE storefront_theme_templates SET theme_id = 'theme-b'");
    await expect(
      storefrontContentPublicationDal.readDocumentsForDraft(input),
    ).rejects.toThrow("Missing or malformed");
  });

  it("rejects another storefront's Page revision", async () => {
    const input = fixture("page");
    sqlite.exec("UPDATE storefront_pages SET storefront_id = 'storefront-b'");
    await expect(
      storefrontContentPublicationDal.readDocumentsForDraft(input),
    ).rejects.toThrow("Missing or malformed");
  });

  it("rejects another publication's item", async () => {
    const input = fixture();
    input.publication.items[0]!.publicationId = "publication-b";
    await expect(
      storefrontContentPublicationDal.readDocumentsForDraft(input),
    ).rejects.toThrow("another publication");
  });

  it.each(["malformed", "scope", "missing"])(
    "rejects a %s snapshot",
    async (problem) => {
      const input = fixture();
      if (problem === "missing") {
        input.publication.items[0]!.revisionId = "missing";
      } else {
        sqlite
          .prepare(
            "UPDATE storefront_theme_template_revisions SET document = ? WHERE id = 'selected'",
          )
          .run(
            problem === "malformed"
              ? "not json"
              : JSON.stringify({
                  version: 1,
                  sections: [],
                  websiteRenderPolicy: { mode: "ssr" },
                }),
          );
      }
      await expect(
        storefrontContentPublicationDal.readDocumentsForDraft(input),
      ).rejects.toThrow("CONTENT_PUBLICATION_INVALID");
    },
  );

  it("rejects page overrides on a layout", async () => {
    const input = fixture();
    sqlite.exec("UPDATE storefront_theme_templates SET type = 'layout'");
    await expect(
      storefrontContentPublicationDal.readDocumentsForDraft(input),
    ).rejects.toThrow("scope mismatch");
  });
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("listDocumentsForPublish", () => {
  it("takes the target and the shell at their drafts, the rest as published", async () => {
    sqlite.exec(`
      INSERT INTO storefront_theme_templates
        (id, theme_id, type, name, route_path, draft_revision_id, published_revision_id, deleted_at)
      VALUES
        ('home', 'theme-a', 'index', 'Home', NULL, 'home-draft', 'home-live', NULL),
        ('shell', 'theme-a', 'layout', 'Layout', NULL, 'shell-draft', 'shell-live', NULL),
        ('about', 'theme-a', 'page', 'About', '/aboutus', 'about-draft', 'about-live', NULL),
        ('never', 'theme-a', 'product', 'Product', NULL, 'never-draft', NULL, NULL),
        ('gone', 'theme-a', 'blog', 'Blog', NULL, 'gone-draft', 'gone-live', '2026-01-01'),
        ('other', 'theme-b', 'index', 'Other', NULL, 'other-draft', 'other-live', NULL);
      INSERT INTO storefront_theme_template_revisions (id, template_id, document) VALUES
        ('home-draft', 'home', '${doc("home-draft")}'),
        ('home-live', 'home', '${doc("home-live")}'),
        ('shell-draft', 'shell', '${doc("shell-draft")}'),
        ('shell-live', 'shell', '${doc("shell-live")}'),
        ('about-draft', 'about', '${doc("about-draft")}'),
        ('about-live', 'about', '${doc("about-live")}'),
        ('never-draft', 'never', '${doc("never-draft")}'),
        ('gone-live', 'gone', '${doc("gone-live")}'),
        ('other-live', 'other', '${doc("other-live")}');
      INSERT INTO storefront_pages (id, storefront_id, handle, published_revision_id, deleted_at) VALUES
        ('faq', 'storefront-a', 'faq', 'faq-live', NULL),
        ('draft-only', 'storefront-a', 'soon', NULL, NULL),
        ('elsewhere', 'storefront-b', 'x', 'x-live', NULL);
      INSERT INTO storefront_page_revisions (id, page_id, document) VALUES
        ('faq-live', 'faq', '${doc("faq-live")}'),
        ('x-live', 'elsewhere', '${doc("x-live")}');
    `);

    const documents =
      await storefrontContentPublicationDal.listDocumentsForPublish({
        storefrontId: "storefront-a",
        themeId: "theme-a",
        templateId: "home",
      });

    const seen = documents
      .map(({ label, document }) => [
        label,
        (document as { sections: { id: string }[] }).sections[0]!.id,
      ])
      .sort();
    expect(seen).toEqual([
      ["/aboutus", "about-live"],
      ["/pages/faq", "faq-live"],
      ["Home", "home-draft"],
      ["Layout", "shell-draft"],
    ]);
  });
});
