// @vitest-environment node
/**
 * Public media authorisation for hidden sections (M3 Hide), on the real D1
 * engine (Miniflare) with every migration applied.
 *
 * A hidden section is gone from the published site, so an asset that only a
 * hidden section refers to must not be readable through public media
 * delivery. Each publication here is made by the real publication builder
 * (`createForTheme`) and made live through a release row, and every answer
 * comes from `lookupPublishedMedia` over the DAL the server wires in.
 *
 * The stored documents keep the hidden section's values (Show again and
 * rollback need them), and the deletion guard still counts them; only the
 * public authorisation list leaves them out.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { openMigratedD1 } from "@/lib/test-utils/real-d1";
import { lookupPublishedMedia } from "../service/storefront-media-delivery";
import { storefrontContentPublicationDal } from "./storefront-content-publication.dal";

let harness: Awaited<ReturnType<typeof openMigratedD1>>;
const NOW = "2026-11-26T00:00:00.000Z";

beforeAll(async () => {
  harness = await openMigratedD1("hidden-section-media-auth");
}, 240_000);

afterAll(async () => {
  await harness?.dispose();
});

const run = (sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).run();
const first = <T>(sql: string, ...args: unknown[]) =>
  harness.d1.prepare(sql).bind(...args).first<T>();

type Section = {
  id: string;
  type: string;
  enabled: boolean;
  props: Record<string, unknown>;
};

const media = (assetId: string) => ({
  source: "asset",
  assetId,
  url: `/assets/${assetId}.png`,
  mediaType: "image",
});
const keyOf = (assetId: string) => `assets/${assetId}.png`;
const doc = (sections: Section[], extra: Record<string, unknown> = {}) => ({
  version: 1,
  ...extra,
  sections,
});
const section = (
  id: string,
  enabled: boolean,
  props: Record<string, unknown>,
): Section => ({ id, type: id, enabled, props });

let storefrontId = "";
let themeId = "";
let layoutId = "";
let indexId = "";
let releaseNumber = 0;

async function seedTheme() {
  storefrontId = randomUUID();
  themeId = randomUUID();
  layoutId = randomUUID();
  indexId = randomUUID();
  releaseNumber = 0;
  await run(
    `INSERT INTO storefronts (id, sales_channel_id, name, status, created_at, updated_at)
     VALUES (?1, ?2, 'Store', 'active', ?3, ?3)`,
    storefrontId,
    `channel-${storefrontId}`,
    NOW,
  );
  await run(
    `INSERT INTO storefront_themes (id, storefront_id, name, status, created_at, updated_at)
     VALUES (?1, ?2, 'Theme', 'published', ?3, ?3)`,
    themeId,
    storefrontId,
    NOW,
  );
  for (const [id, type, name] of [
    [layoutId, "layout", "Layout"],
    [indexId, "index", "Home"],
  ] as const) {
    await run(
      `INSERT INTO storefront_theme_templates (id, theme_id, type, name, route_path, document,
         draft_revision_id, published_revision_id, draft_generation, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, NULL, ?5, NULL, NULL, 1, ?6, ?6)`,
      id,
      themeId,
      type,
      name,
      JSON.stringify(doc([])),
      NOW,
    );
  }
}

let revisionVersion = 0;
/** A new template revision, made the template's draft and published one. */
async function templateRevision(templateId: string, document: unknown) {
  const id = randomUUID();
  revisionVersion += 1;
  await run(
    `INSERT INTO storefront_theme_template_revisions (id, template_id, version, document, created_by, created_at, published_at)
     VALUES (?1, ?2, ?3, ?4, 'author', ?5, ?5)`,
    id,
    templateId,
    revisionVersion,
    JSON.stringify(document),
    NOW,
  );
  await run(
    `UPDATE storefront_theme_templates
        SET draft_revision_id = ?1, published_revision_id = ?1, document = ?2
      WHERE id = ?3`,
    id,
    JSON.stringify(document),
    templateId,
  );
  return id;
}

/** A published CMS Page. */
async function publishedPage(handle: string, document: unknown) {
  const pageId = randomUUID();
  const revisionId = randomUUID();
  await run(
    `INSERT INTO storefront_pages (id, storefront_id, title, handle, status,
       draft_revision_id, published_revision_id, created_by, created_at, updated_at)
     VALUES (?1, ?2, 'Page', ?3, 'published', ?4, ?4, 'author', ?5, ?5)`,
    pageId,
    storefrontId,
    handle,
    revisionId,
    NOW,
  );
  await run(
    `INSERT INTO storefront_page_revisions (id, page_id, version, document, created_by, created_at, published_at)
     VALUES (?1, ?2, 1, ?3, 'author', ?4, ?4)`,
    revisionId,
    pageId,
    JSON.stringify({ handle, ...(document as object) }),
    NOW,
  );
  return { pageId, revisionId };
}

/**
 * Publishes the index template's current revision the way a Theme publish
 * seals content, and makes the release live. Returns the release id.
 */
async function publish(indexRevisionId: string) {
  const publication = await storefrontContentPublicationDal.createForTheme({
    storefrontId,
    themeId,
    templateId: indexId,
    templateRevisionId: indexRevisionId,
    createdBy: "author",
  });
  releaseNumber += 1;
  const sourceRevisionId = randomUUID();
  const buildId = randomUUID();
  const releaseId = randomUUID();
  await run(
    `INSERT INTO storefront_theme_revisions (id, storefront_id, theme_id, revision_number, source, snapshot, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'publish', '[]', ?5, ?5)`,
    sourceRevisionId,
    storefrontId,
    themeId,
    releaseNumber,
    NOW,
  );
  await run(
    `INSERT INTO storefront_theme_builds (id, storefront_id, theme_id, source_revision_id, status, content_publication_id, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'succeeded', ?5, ?6, ?6)`,
    buildId,
    storefrontId,
    themeId,
    sourceRevisionId,
    publication.id,
    NOW,
  );
  await run(
    `INSERT INTO storefront_releases (id, storefront_id, theme_id, source_revision_id, theme_build_id, content_publication_id, status, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)`,
    releaseId,
    storefrontId,
    themeId,
    sourceRevisionId,
    buildId,
    publication.id,
    NOW,
  );
  await activate(releaseId);
  return releaseId;
}

/** Moves the live pointer, as a rollback does, without touching any row. */
async function activate(releaseId: string) {
  await run(
    "UPDATE storefronts SET active_release_id = ?1, active_theme_id = ?2 WHERE id = ?3",
    releaseId,
    themeId,
    storefrontId,
  );
}

/** What a visitor's request for `assetId` resolves to on the live release. */
async function visitorReads(assetId: string, withVersion = true) {
  const live = await first<{ publicationId: string | null }>(
    `SELECT r.content_publication_id AS publicationId
       FROM storefronts s INNER JOIN storefront_releases r ON r.id = s.active_release_id
      WHERE s.id = ?1`,
    storefrontId,
  );
  const lookup = await lookupPublishedMedia({
    assetId,
    storageKey: withVersion ? keyOf(assetId) : null,
    publicationId: live?.publicationId,
    ports: {
      listPublishedAssetKeys: (publicationId) =>
        storefrontContentPublicationDal.listPublishedAssetKeys(publicationId),
    },
  });
  return lookup.status;
}

beforeEach(async () => {
  await seedTheme();
  // An empty published layout unless a test gives it content.
  await templateRevision(layoutId, doc([]));
});

describe("public media for hidden sections", () => {
  it("does not serve an asset only a hidden Page section refers to", async () => {
    const hiddenOnly = randomUUID();
    const visible = randomUUID();
    await publishedPage(
      "about",
      doc([
        section("hero", true, { image: media(visible) }),
        section("promo", false, { image: media(hiddenOnly) }),
      ]),
    );
    await publish(await templateRevision(indexId, doc([])));

    expect(await visitorReads(visible)).toBe("found");
    expect(await visitorReads(hiddenOnly)).toBe("not-published");
    // A legacy URL without `?version=` is refused the same way.
    expect(await visitorReads(hiddenOnly, false)).toBe("not-published");
  });

  it("does not serve an asset only a hidden template section refers to", async () => {
    const hiddenOnly = randomUUID();
    const visible = randomUUID();
    await publish(
      await templateRevision(
        indexId,
        doc([
          section("hero", true, { image: media(visible) }),
          section("banner", false, { image: media(hiddenOnly) }),
        ]),
      ),
    );

    expect(await visitorReads(visible)).toBe("found");
    expect(await visitorReads(hiddenOnly)).toBe("not-published");
  });

  it("does not serve an asset only a hidden shared-layout section refers to", async () => {
    const hiddenOnly = randomUUID();
    const visible = randomUUID();
    await templateRevision(
      layoutId,
      doc([
        section("header", true, { logo: media(visible) }),
        section("announcement", false, { image: media(hiddenOnly) }),
      ]),
    );
    await publish(await templateRevision(indexId, doc([])));

    expect(await visitorReads(visible)).toBe("found");
    expect(await visitorReads(hiddenOnly)).toBe("not-published");
  });

  it("treats references nested in lists and blocks of a hidden section as hidden", async () => {
    const inRow = randomUUID();
    const inBlock = randomUUID();
    await publish(
      await templateRevision(
        indexId,
        doc([
          section("gallery", false, {
            items: [{ id: "a", label: "One", image: media(inRow) }],
            blocks: [{ type: "card", props: { media: { primary: media(inBlock) } } }],
          }),
        ]),
      ),
    );

    expect(await visitorReads(inRow)).toBe("not-published");
    expect(await visitorReads(inBlock)).toBe("not-published");
  });

  it("still serves an asset a visible section also refers to, in the same or another document", async () => {
    const sameDocument = randomUUID();
    const otherDocument = randomUUID();
    await templateRevision(
      layoutId,
      doc([section("footer", true, { image: media(otherDocument) })]),
    );
    await publishedPage(
      "about",
      doc([section("promo", false, { image: media(otherDocument) })]),
    );
    await publish(
      await templateRevision(
        indexId,
        doc([
          section("banner", false, { image: media(sameDocument) }),
          section("hero", true, { items: [{ image: media(sameDocument) }] }),
        ]),
      ),
    );

    expect(await visitorReads(sameDocument)).toBe("found");
    expect(await visitorReads(otherDocument)).toBe("found");
  });

  it("does not serve a visible section's asset when the shared layout hides that slot id", async () => {
    // The runtime lets a hidden flag in either document win: layout and
    // route share one slot namespace, and the layout is on every route.
    const shadowed = randomUUID();
    await templateRevision(
      layoutId,
      doc([section("announcement", false, { text: "Off" })]),
    );
    await publish(
      await templateRevision(
        indexId,
        doc([section("announcement", true, { image: media(shadowed) })]),
      ),
    );

    expect(await visitorReads(shadowed)).toBe("not-published");
  });

  it("authorises a rollback by the restored release's own publication", async () => {
    const hiddenLater = randomUUID();
    const shownLater = randomUUID();
    const first = await publish(
      await templateRevision(
        indexId,
        doc([
          section("hero", true, { image: media(hiddenLater) }),
          section("promo", false, { image: media(shownLater) }),
        ]),
      ),
    );
    expect(await visitorReads(hiddenLater)).toBe("found");
    expect(await visitorReads(shownLater)).toBe("not-published");

    const second = await publish(
      await templateRevision(
        indexId,
        doc([
          section("hero", false, { image: media(hiddenLater) }),
          section("promo", true, { image: media(shownLater) }),
        ]),
      ),
    );
    expect(await visitorReads(hiddenLater)).toBe("not-published");
    expect(await visitorReads(shownLater)).toBe("found");

    // Rollback to the first release: its own visibility, not the latest one.
    await activate(first);
    expect(await visitorReads(hiddenLater)).toBe("found");
    expect(await visitorReads(shownLater)).toBe("not-published");

    // And forward again.
    await activate(second);
    expect(await visitorReads(hiddenLater)).toBe("not-published");
    expect(await visitorReads(shownLater)).toBe("found");
  });

  it("keeps the hidden section's values stored and protected from deletion", async () => {
    const hiddenOnly = randomUUID();
    const hidden = doc([
      section("promo", false, { heading: "Kept", image: media(hiddenOnly) }),
    ]);
    const revisionId = await templateRevision(indexId, hidden);
    await publish(revisionId);

    expect(await visitorReads(hiddenOnly)).toBe("not-published");
    // The stored revision is byte-for-byte what was published.
    const stored = await first<{ document: string }>(
      "SELECT document FROM storefront_theme_template_revisions WHERE id = ?1",
      revisionId,
    );
    expect(JSON.parse(stored!.document)).toEqual(hidden);
    // Show again and rollback need the bytes, so deletion still refuses it.
    expect(
      await storefrontContentPublicationDal.findPublishedAssetReferences([hiddenOnly]),
    ).toEqual(new Set([hiddenOnly]));
  });
});
