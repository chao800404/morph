import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { queryLifecycleD1 } from "../scripts/verify-published-artifact.mjs";
import {
  B1_EXTRA_CASES,
  B1_HOME_LAYOUT_CASES,
} from "../src/lib/test-utils/binding-acceptance-b1-cases";
import {
  storedSectionsOf,
  type BasCase,
  type StoredDocument,
  type StoredSections,
} from "../src/lib/test-utils/binding-acceptance-cases";
import {
  seedLayoutCase,
  seedRouteCases,
  storedCaseSections,
  walkCase,
  type Fixture,
} from "./binding-acceptance-helpers";
import { previewFrame, previewFrameOf } from "./helpers";
import { m1Evidence } from "./helpers/m1-acceptance-evidence";
import {
  DOMAINS,
  RELEASES,
  latestRelease,
  openEditor,
  publishShowingRelease,
  servedRelease,
  serverFn,
  signedInPage,
  storefrontFetcher,
  storefrontHarness,
} from "./native-acceptance";
import { themeScopeFromEditorPath } from "./native-compat";

/**
 * M1 1a, A3 and A4 (handoff 2026-11-21 m1-acceptance-plan.md): non-home pages
 * that store their content in their own route Document, edited, published,
 * served to a browser with no cookie, rolled back and reloaded, with what is
 * shown and what is stored checked against each other at every step.
 *
 * The cases are the B1 route cases (`B1_EXTRA_CASES`), each on its own route
 * `/b1-pN` of the run's own Theme, seeded through the editor's own writes:
 *
 *   A3  p1 (per-field), p2 (cross-name alias), p5 (two instances, same text)
 *       are edited through Design (`walkCase`, S1-S5: canvas, location, the
 *       editor's real write, the raw D1 Document, reload): release 1 and
 *       release 2 each take one edit per case, one in the Inspector and one
 *       on the canvas.
 *   A4  p3 (literal after a spread), p4a (literal before a spread), p6
 *       (untraced value) are published as code shows them: p4a and p6 are
 *       walked and must write nothing; p3 is not edited. Their route
 *       Documents keep the seed revision through every step.
 *
 *   P1  each release's own content publication pins exactly the drafts.
 *       Publish seals the Document of the page open in the editor and
 *       carries the others' published revisions forward, so each page is
 *       published from its own editor (`publishPages`); release 1 and 2 are
 *       the last release of each round
 *   P2  the public site (local operator stand-in, `storefrontHarness`), read
 *       raw (HTML, `/_morph/content`) and in a browser context with no
 *       cookie, shows the publication on the home page and each route page;
 *       no other release's edit is anywhere
 *   P3  rollback with `expectedActiveReleaseId`: a stale expectation is
 *       refused first; only the active release changes
 *   P4  the public site, reloaded, is back to release 1
 *   P5  the editor, reloaded, keeps the drafts it had before the rollback
 *       (Q6: the current rollback semantics, read back on both sides)
 *
 * Publish scope (user decision 2026-11-22, handoff 2026-11-21
 * m1-acceptance-plan.md "Publish scope"). Publish is per page: it seals the
 * Document of the page open in the editor, and every other page's Document
 * keeps the revision it last published (`publishedRevisionId`), so another
 * page's unpublished draft stays unpublished. The exception is the shared
 * layout: a pending layout draft is sealed by whichever page is published
 * (`storefrontThemeDal.publishTemplate`, `pendingShell`, passed to
 * `resolveForTheme` as `alsoPublish`), so a single-page publish can change
 * the shared blocks every other page shows. l1 is the run Theme's root
 * layout (`seedLayoutCase`), seeded before release 1 and sealed by its first
 * publish; it is unchanged through release 2.
 *
 *   S-a  p1 holds an unpublished draft and p2 a new one; p2 is published
 *        from its own editor (release 3). Read back: release 3 pins exactly
 *        release 2's items except p2's new draft; p1's template row and its
 *        pin are release 2's; the public site serves release 3 and p1's
 *        page still shows p1's published value, never its draft.
 *   S-b  l1 (the layout) holds a pending draft, p1 still its unpublished
 *        one, p2 nothing new; p2 is published again (release 4). Read back:
 *        release 4 pins exactly release 3's items except the layout, now
 *        its draft revision; the layout row is published; p1's and p2's
 *        rows and pins are unchanged; the public site serves release 4 and
 *        p1's page shows the new shared block over p1's published body.
 *
 * Every public step records the release Core served (the ETag of
 * `/_morph/content`, `"<releaseId>:<path>"`) and the ledger row records
 * every item the release pins (`pins`) and the version ids checked
 * (`detail`). A merchant-facing display of this scope before publishing is
 * a product requirement tracked separately; this spec does not test UI for
 * it.
 *
 * Publish after rollback (PR #429, fix/publish-after-rollback). After the
 * rollback to release 1, p2's row still names the S-a revision as published
 * while release 1, now live, pins its release 1 revision: the rollback took
 * p2's published content off the storefront.
 *
 *   R-a  p2's editor shows unpublished changes and Publish is enabled.
 *   R-b  p2 alone is published from its own editor (release 5). Read back:
 *        release 5 pins exactly release 1's items except p2, at its draft;
 *        the layout stays at release 1's revision, not the one S-b sealed
 *        into release 4; the public site serves release 5, every other
 *        page shows release 1's values and p2 its draft.
 *   R-c  The layout is still untouched since the rollback: its row names
 *        release 4's revision as both draft and published, and release 5
 *        pins release 1's. On p1's editor the toolbar Build Preview runs the
 *        editor's preparation for a build over the page and the layout
 *        (`prepareContentDraftForBuild({ alwaysPrepare: true })`, the step a
 *        publish whose plan is `build` runs too), then p1 is published from
 *        its own editor (release 6). Read back: p2's editor, which has
 *        nothing of its own to publish, reads "published" with nothing to
 *        publish after the Build Preview, so the editor does not list the
 *        layout as a pending change; the Build Preview left the
 *        layout row as it was; release 6 pins exactly release 5's items
 *        except p1, at its draft, and the layout at release 1's revision;
 *        the public site serves release 6 and release 4's layout value is on
 *        no page. Before fix/rollback-build-layout-reseal the preparation
 *        forked the layout's revision into a new draft holding release 4's
 *        layout, which the next publish sealed as a pending layout edit.
 *
 * These fail before #429 (99b2f84; this branch is based on a main that has
 * it), where a publish carries the template rows'
 * published revisions forward instead of the live release's. Every test in
 * this describe is a prerequisite of R-a/R-b, so the describe carries the
 * tag `@publish-after-rollback`: `-g @publish-after-rollback` runs them with
 * the whole chain. A grep that selects R-a/R-b alone fails at their
 * prerequisite check; it never passes or skips.
 *
 * Q10: the Theme records full Start (`recordFullStartTheme`), and every
 * preview start this spec observes must answer container transport + full
 * Start. The spec writes the plan's ledger (2.3) and identity record (2.4)
 * into the run's output directory (e2e/helpers/m1-acceptance-evidence.ts).
 *
 * Serial: a failed step skips the rest, and the container target requires
 * every listed test to have passed
 * (scripts/container-acceptance-targets/b1-route-publish-rollback.mjs), so a
 * skip is never evidence.
 */

const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
const PREVIEW_RUNTIME = process.env.MORPH_E2E_PREVIEW_RUNTIME;
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;

test.skip(
  !EDITOR_PATH || !STATE_DIR,
  "Run through scripts/run-editor-e2e.mjs: this reads the run's own D1 and R2.",
);
test.skip(
  TRANSPORT !== "cloudflare-sandbox",
  "B1 route publish and rollback acceptance requires cloudflare-sandbox transport.",
);
test.skip(
  PREVIEW_RUNTIME !== "start",
  "B1 route publish and rollback acceptance requires full Start preview runtime (MORPH_E2E_PREVIEW_RUNTIME=start).",
);

const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
const HOST = "b1-routes.localhost";
const HOME = "/";

const caseById = (id: string) => {
  const found = B1_EXTRA_CASES.find((testCase) => testCase.id === id);
  if (!found) throw new Error(`no B1 case ${id}`);
  return found;
};
const P1 = caseById("p1");
const P2 = caseById("p2");
const P5 = caseById("p5");
const P3 = caseById("p3");
const P4A = caseById("p4a");
const P6 = caseById("p6");
/** A3: edited through Design. */
const EDITED = [P1, P2, P5] as const;
/** A4: published as the code shows them, never written. */
const CODE = [P3, P4A, P6] as const;
const ALL = [...EDITED, ...CODE] as const;
const L1_CASE = B1_HOME_LAYOUT_CASES.find((testCase) => testCase.id === "l1")!;
/**
 * The layout case on this Theme: walked from the home page, and seen there
 * and on p1's page (the page whose unpublished draft S-b keeps out).
 */
const L1: BasCase = {
  ...L1_CASE,
  layout: {
    ...L1_CASE.layout!,
    pages: [
      L1_CASE.layout!.pages.find((page) => page.routePath === "/")!,
      { routePath: P1.routePath, routeFile: P1.routeFile },
    ],
  },
};

/** Every case's own sections, as one release (or the drafts) hold them. */
type CaseValues = Readonly<Record<string, StoredSections>>;

/** The field an A3 case's edit lands on. */
const editedField = (testCase: BasCase) => {
  const target = testCase.elements[testCase.edit.element]!.target;
  if (target.kind !== "field") throw new Error(`${testCase.id} edits no field`);
  return target;
};

const valueOf = (stored: StoredSections | undefined, testCase: BasCase) => {
  const { section, field } = editedField(testCase);
  return stored?.[section]?.[field] ?? "";
};

/** A3's edited values of a release: what must and must not be on a page. */
const editedValues = (values: CaseValues) =>
  EDITED.map((testCase) => valueOf(values[testCase.id], testCase));

/** The case's own route, so a walk stays on `/b1-pN` in both modes. */
const ownRoute = (testCase: BasCase) => ({
  routePath: testCase.routePath,
  routeFile: testCase.routeFile,
});

const slug = (value: string) => value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";

test.describe("B1 non-home route Documents publish and rollback (A3, A4)", { tag: "@publish-after-rollback" }, () => {
  test.describe.configure({ mode: "serial" });
  test.use({ actionTimeout: 60_000 });

  const harness = STATE_DIR
    ? storefrontHarness({ scope: scope!, stateDir: STATE_DIR })
    : null;
  const evidence = STATE_DIR
    ? m1Evidence({ item: "1a", spec: "b1-route-publish-rollback", scope: scope!, stateDir: STATE_DIR })
    : null;
  const fx: Fixture | null = EDITOR_PATH
    ? { scope: scope!, editorPath: EDITOR_PATH }
    : null;
  let domainId: string | null = null;
  let origin = "";
  let release1 = "";
  let release2 = "";
  /** Publish scope S-a (p2 alone) and S-b (p2 with a pending layout). */
  let release3 = "";
  let release4 = "";
  /** Publish after rollback: p2 alone, published while release 1 is live. */
  let release5 = "";
  /** Release 5's route values (R-c reads them as its starting point). */
  let values5: CaseValues | null = null;
  /** R-c: p1 published after a Build Preview, the layout untouched. */
  let release6 = "";
  /** Set when the editor reload after the rollback passed (P5). */
  let reloadedAfterRollback = false;
  let publication1: string | null = null;
  let values1: CaseValues | null = null;
  let values2: CaseValues | null = null;
  /** Release 3 and 4's route values (S-b changes only the layout). */
  let values3: CaseValues | null = null;
  /** The drafts after S-b: release 3's, plus p1's unpublished draft. */
  let draftsLast: CaseValues | null = null;
  /** l1's sections as S-b sealed them (releases 1-3 hold the seed). */
  let layoutSealed: StoredSections | null = null;
  /** A4's route Documents' draft revisions right after seeding. */
  let codeRevisions: Record<string, string> = {};
  let contentTsBefore: string | null = null;

  const queryD1 = (sql: string, ...params: unknown[]) =>
    queryLifecycleD1(STATE_DIR!, sql, ...params) as Array<Record<string, unknown>>;

  /*
   * `storefrontHarness`'s publishedState and releaseBuild, the same SQL read
   * through `queryD1`: theirs start a second workerd on the run's D1
   * (`queryRunD1`), and right after a rollback that reader hit SQLITE_BUSY
   * while the dev server was writing (dev-run3, D1 "internal error"). A
   * read-only handle with a busy timeout reads the same rows.
   */
  /** Publications a build sealed are left out, as in `storefrontHarness`. */
  const publishedState = async () =>
    queryD1(
      `SELECT
         (SELECT active_release_id FROM storefronts WHERE id = ?1) AS active,
         (SELECT COUNT(*) FROM storefront_releases WHERE storefront_id = ?1) AS releases,
         (SELECT COUNT(*) FROM storefront_content_publications p
           WHERE p.storefront_id = ?1
             AND NOT EXISTS (
               SELECT 1 FROM storefront_theme_builds b
               WHERE b.content_publication_id = p.id
             )) AS publications`,
      scope!.storefrontId,
    )[0] as { active: string; releases: number; publications: number };

  /** A release's build and what its build proved about content. */
  const releaseBuild = async (releaseId: string) =>
    queryD1(
      `SELECT r.theme_build_id AS buildId,
              r.content_publication_id AS releaseContent,
              b.content_publication_id AS buildContent,
              b.content_dependency AS dependency
         FROM storefront_releases r
         JOIN storefront_theme_builds b ON b.id = r.theme_build_id
        WHERE r.id = ?1`,
      releaseId,
    )[0] as {
      buildId: string;
      releaseContent: string | null;
      buildContent: string | null;
      dependency: "dependent" | "independent" | null;
    };

  /** Every case's sections in its draft route Document, read raw from D1. */
  const draftValues = async (): Promise<CaseValues> => {
    const entries: Array<[string, StoredSections]> = [];
    for (const testCase of ALL) entries.push([testCase.id, await storedCaseSections(fx!, testCase)]);
    return Object.fromEntries(entries);
  };

  /** The draft revision of each A4 route Document. */
  const draftRevisions = (cases: readonly BasCase[]) =>
    Object.fromEntries(
      cases.map((testCase) => {
        const rows = queryD1(
          `SELECT draft_revision_id AS id FROM storefront_theme_templates
            WHERE theme_id = ?1 AND route_path = ?2 AND deleted_at IS NULL`,
          scope!.themeId,
          testCase.routePath,
        );
        expect(rows, `${testCase.routePath} has one route Document`).toHaveLength(1);
        return [testCase.id, String(rows[0]!.id)];
      }),
    );

  /**
   * Every case's sections in a release's own content publication: the route
   * revisions it pins, not the templates' current rows.
   */
  const releaseValues = (releaseId: string): CaseValues => {
    const rows = queryD1(
      `SELECT t.route_path AS route_path, r.document AS document
         FROM storefront_releases rel
         JOIN storefront_content_publication_items i
           ON i.publication_id = rel.content_publication_id AND i.item_type = 'template' AND i.deleted_at IS NULL
         JOIN storefront_theme_template_revisions r ON r.id = i.revision_id
         JOIN storefront_theme_templates t ON t.id = r.template_id
        WHERE rel.id = ?1 AND t.theme_id = ?2`,
      releaseId,
      scope!.themeId,
    );
    return Object.fromEntries(
      ALL.map((testCase) => {
        const found = rows.filter((row) => row.route_path === testCase.routePath);
        expect(found, `release ${releaseId} pins one ${testCase.routePath} revision`).toHaveLength(1);
        const stored = storedSectionsOf(JSON.parse(String(found[0]!.document)) as StoredDocument);
        return [
          testCase.id,
          Object.fromEntries(testCase.slots.flatMap((slot) => (stored[slot] ? [[slot, stored[slot]]] : []))),
        ];
      }),
    );
  };

  /**
   * Storage isolation: each A3 case holds an edit in the one field Design
   * wrote, everything else (the other instance with the same text included)
   * is still the seed; each A4 case is exactly the seed.
   */
  const expectIsolated = (values: CaseValues) => {
    for (const testCase of EDITED) {
      const stored = values[testCase.id]!;
      const { section, field } = editedField(testCase);
      const edit = valueOf(stored, testCase);
      expect(edit, `${testCase.id} ${section}.${field} holds an edit`).not.toBe(
        valueOf(testCase.seed, testCase),
      );
      expect(stored, `${testCase.id} changed in ${section}.${field} only`).toEqual({
        ...testCase.seed,
        [section]: { ...testCase.seed[section], [field]: edit },
      });
    }
    for (const testCase of CODE) {
      expect(values[testCase.id], `${testCase.id} holds its seed only`).toEqual(testCase.seed);
    }
  };

  /** A4: no Document write since seeding, in content or in revision. */
  const expectCodeUnwritten = () => {
    expect(draftRevisions(CODE), "A4 route Documents keep their seed revision").toEqual(codeRevisions);
  };

  /** Everything a rollback must leave alone, read from D1. */
  const rollbackSnapshot = () => ({
    releases: queryD1(
      "SELECT COUNT(*) AS n FROM storefront_releases WHERE storefront_id = ?1",
      scope!.storefrontId,
    )[0]!.n,
    publications: queryD1(
      "SELECT COUNT(*) AS n FROM storefront_content_publications WHERE storefront_id = ?1",
      scope!.storefrontId,
    )[0]!.n,
    revisions: queryD1(
      `SELECT COUNT(*) AS n FROM storefront_theme_template_revisions r
         JOIN storefront_theme_templates t ON t.id = r.template_id WHERE t.theme_id = ?1`,
      scope!.themeId,
    )[0]!.n,
    theme: queryD1(
      `SELECT source_generation AS sourceGeneration, release_generation AS releaseGeneration
         FROM storefront_themes WHERE id = ?1`,
      scope!.themeId,
    )[0],
    templates: queryD1(
      `SELECT id, draft_generation AS g, draft_revision_id AS draft, published_revision_id AS published
         FROM storefront_theme_templates WHERE theme_id = ?1 AND deleted_at IS NULL ORDER BY id`,
      scope!.themeId,
    ),
  });

  /** A template row's ids: a route Document's, or the layout's. */
  const templateRow = (where: { routePath: string } | "layout") => {
    const select = `SELECT id, draft_revision_id AS draft, published_revision_id AS published
         FROM storefront_theme_templates
        WHERE theme_id = ?1 AND deleted_at IS NULL`;
    const rows =
      where === "layout"
        ? queryD1(`${select} AND type = 'layout'`, scope!.themeId)
        : queryD1(`${select} AND route_path = ?2`, scope!.themeId, where.routePath);
    expect(rows, `one ${where === "layout" ? "layout" : where.routePath} template`).toHaveLength(1);
    return {
      id: String(rows[0]!.id),
      draft: rows[0]!.draft == null ? null : String(rows[0]!.draft),
      published: rows[0]!.published == null ? null : String(rows[0]!.published),
    };
  };
  const routeRow = (testCase: BasCase) => templateRow({ routePath: testCase.routePath });
  const layoutRow = () => templateRow("layout");

  /** The layout revision a release's own content publication pins. */
  const pinnedLayout = (releaseId: string) =>
    queryD1(
      `SELECT i.revision_id AS id
         FROM storefront_releases rel
         JOIN storefront_content_publication_items i
           ON i.publication_id = rel.content_publication_id AND i.item_type = 'template' AND i.deleted_at IS NULL
         JOIN storefront_theme_templates t ON t.id = i.content_id
        WHERE rel.id = ?1 AND t.theme_id = ?2 AND t.type = 'layout'`,
      releaseId,
      scope!.themeId,
    ).map((row) => String(row.id));

  /** l1's sections in the layout revision a release pins. */
  const releaseLayout = (releaseId: string): StoredSections => {
    const rows = queryD1(
      `SELECT r.document AS document
         FROM storefront_releases rel
         JOIN storefront_content_publication_items i
           ON i.publication_id = rel.content_publication_id AND i.item_type = 'template' AND i.deleted_at IS NULL
         JOIN storefront_theme_template_revisions r ON r.id = i.revision_id
         JOIN storefront_theme_templates t ON t.id = r.template_id
        WHERE rel.id = ?1 AND t.theme_id = ?2 AND t.type = 'layout'`,
      releaseId,
      scope!.themeId,
    );
    expect(rows, `release ${releaseId} pins one layout revision`).toHaveLength(1);
    const stored = storedSectionsOf(JSON.parse(String(rows[0]!.document)) as StoredDocument);
    return Object.fromEntries(L1.slots.flatMap((slot) => (stored[slot] ? [[slot, stored[slot]]] : [])));
  };

  /** Every item a release pins, `<itemType>:<contentId>` to revision id. */
  const pinMap = (releaseId: string) => {
    const pins = evidence!.pins(releaseId);
    expect(pins.length, `release ${releaseId} pins its content`).toBeGreaterThan(0);
    const map: Record<string, string> = Object.fromEntries(
      pins.map((pin) => [`${pin.itemType}:${pin.contentId}`, pin.revisionId]),
    );
    expect(Object.keys(map), `release ${releaseId} pins each item once`).toHaveLength(pins.length);
    return map;
  };

  /**
   * The release Core serves on the home page and every route page, read from
   * the ETag of each content read: all of them must name `expected`.
   */
  const expectServed = async (expected: string) => {
    const named = new Set<string>();
    for (const pagePath of [HOME, ...ALL.map((testCase) => testCase.routePath)]) {
      const read = await servedRelease(origin, pagePath);
      expect(read, `${pagePath} is served from release ${expected}`).toBe(expected);
      named.add(read);
    }
    // What the ETags named, not what was expected: the ledger records this.
    expect(named.size, "every page names one release").toBe(1);
    return [...named][0]!;
  };

  /** A Design walk on the case's own route that must pass in full. */
  const designWalk = async (page: Page, testCase: BasCase, mode: "inspector" | "inline", step: string) => {
    evidence!.observePreviewStarts(page);
    const before = (await draftValues())[testCase.id];
    await walkCase(page, testCase, mode, fx!, ownRoute(testCase));
    expect(test.info().errors, `${testCase.id} ${mode} Design walk`).toEqual([]);
    const after = (await draftValues())[testCase.id];
    const writes = testCase.edit.inlineWrites || testCase.edit.inspector;
    if (EDITED.includes(testCase as (typeof EDITED)[number])) {
      expect(valueOf(after, testCase), `${testCase.id} ${mode} wrote a new value`).not.toBe(
        valueOf(before, testCase),
      );
    } else {
      expect(after, `${testCase.id} ${mode} wrote nothing`).toEqual(before);
      expectCodeUnwritten();
    }
    evidence!.ledger({
      case: testCase.id,
      step,
      action: EDITED.includes(testCase as (typeof EDITED)[number])
        ? `${mode === "inspector" ? "Inspector" : "canvas"} write`
        : `${mode === "inspector" ? "Inspector" : "canvas"} refused (no write${writes ? "" : ", none offered"})`,
      routePath: testCase.routePath,
    });
  };

  /**
   * l1's walk, from the home page: the layout Document holds a new value in
   * the one field Design wrote, the edit is shown on p1's page too, and no
   * route Document is written.
   */
  const layoutWalk = async (page: Page, mode: "inspector" | "inline", step: string) => {
    evidence!.observePreviewStarts(page);
    const before = await storedCaseSections(fx!, L1);
    const routes = await draftValues();
    await walkCase(page, L1, mode, fx!);
    expect(test.info().errors, `l1 ${mode} Design walk`).toEqual([]);
    const after = await storedCaseSections(fx!, L1);
    const { section, field } = editedField(L1);
    expect(valueOf(after, L1), `l1 ${mode} wrote a new value`).not.toBe(valueOf(before, L1));
    expect(after, `l1 changed in ${section}.${field} only`).toEqual({
      ...before,
      [section]: { ...before[section], [field]: valueOf(after, L1) },
    });
    expect(await draftValues(), "a layout walk writes no route Document").toEqual(routes);
    evidence!.ledger({
      case: "l1",
      step,
      action: `${mode === "inspector" ? "Inspector" : "canvas"} write (layout, from the home page)`,
      detail: { layout: layoutRow() },
    });
    return after;
  };

  /**
   * The public site shows `values`: on each route page the raw HTML carries
   * every element's value and `/_morph/content` every stored one; in a
   * browser with no cookie every element shows its value in place, on load
   * and after a reload. None of `absent` is anywhere, the home page included.
   */
  const expectPublic = async (
    browser: Browser,
    values: CaseValues,
    layout: StoredSections,
    absent: readonly string[],
    label: string,
  ) => {
    const storefront = storefrontFetcher(origin);
    const files: string[] = [];
    const home = await storefront(HOME);
    expect(home.status, "the home page is served").toBe(200);
    const homeContent = await storefront(`/_morph/content?path=${encodeURIComponent(HOME)}`);
    expect(homeContent.status, "home content is served").toBe(200);
    for (const element of L1.elements) {
      expect(home.body, `home HTML carries the layout's ${element.tag}[${element.nth}]`).toContain(element.text(layout));
    }
    for (const value of absent) {
      expect(home.body, "home HTML carries no other release's value").not.toContain(value);
      expect(homeContent.body, "home content carries no other release's value").not.toContain(value);
    }
    for (const testCase of ALL) {
      const html = await storefront(testCase.routePath);
      expect(html.status, `${testCase.routePath} is served`).toBe(200);
      const content = await storefront(`/_morph/content?path=${encodeURIComponent(testCase.routePath)}`);
      expect(content.status, `${testCase.routePath} content is served`).toBe(200);
      for (const element of L1.elements) {
        expect(html.body, `${testCase.routePath} HTML carries the layout's ${element.tag}[${element.nth}]`).toContain(
          element.text(layout),
        );
      }
      for (const element of testCase.elements) {
        const shown = element.text(values[testCase.id]!);
        expect(html.body, `${testCase.routePath} HTML carries ${element.tag}[${element.nth}]`).toContain(shown);
        if (element.target.kind === "field") {
          expect(content.body, `${testCase.routePath} content carries ${element.target.section}.${element.target.field}`).toContain(shown);
        }
      }
      for (const value of absent) {
        expect(html.body, `${testCase.routePath} HTML carries no other release's value`).not.toContain(value);
        expect(content.body, `${testCase.routePath} content carries no other release's value`).not.toContain(value);
      }
    }

    const context = await browser.newContext({ storageState: undefined });
    try {
      expect(await context.cookies(), "the shopper has no cookie").toEqual([]);
      const shopper = await context.newPage();
      for (const pagePath of [HOME, ...ALL.map((testCase) => testCase.routePath)]) {
        const cases = ALL.filter((testCase) => testCase.routePath === pagePath);
        const shown = async (when: string) => {
          // The layout's shared block, on every page.
          const shell = shopper.locator(`[data-bas-case="${L1.id}"]`);
          await expect(shell, `${pagePath} renders the layout's l1 ${when}`).toBeVisible({ timeout: 30_000 });
          for (const element of L1.elements) {
            await expect(
              shell.locator(element.tag).nth(element.nth),
              `${pagePath} l1 ${element.tag}[${element.nth}] ${when}`,
            ).toHaveText(element.text(layout), { timeout: 30_000 });
          }
          for (const testCase of cases) {
            const root = shopper.locator(`[data-bas-case="${testCase.id}"]`);
            await expect(root, `${pagePath} renders ${testCase.id} ${when}`).toBeVisible({ timeout: 30_000 });
            for (const element of testCase.elements) {
              await expect(
                root.locator(element.tag).nth(element.nth),
                `${pagePath} ${testCase.id} ${element.tag}[${element.nth}] ${when}`,
              ).toHaveText(element.text(values[testCase.id]!), { timeout: 30_000 });
            }
          }
          for (const value of absent) {
            await expect(shopper.getByText(value, { exact: false })).toHaveCount(0);
          }
        };
        const response = await shopper.goto(`${origin}${pagePath}`, { waitUntil: "domcontentloaded" });
        expect(response?.status(), `${pagePath} is served`).toBe(200);
        await shown("on load");
        const reloaded = await shopper.reload({ waitUntil: "domcontentloaded" });
        expect(reloaded?.status(), `${pagePath} is served after a reload`).toBe(200);
        await shown("after a reload");
        const shot = path.join(evidence!.evidenceDir(), `public-${label}-${slug(pagePath)}.png`);
        await shopper.screenshot({ path: shot, fullPage: true });
        files.push(path.basename(shot));
      }
      expect(await context.cookies(), "the public site set no session on the shopper").toEqual([]);
    } finally {
      await context.close();
    }
    return files;
  };

  const editorRouteUrl = (routePath: string) => {
    const url = new URL(EDITOR_PATH!, "http://placeholder");
    url.searchParams.set("routePath", routePath);
    return `${url.pathname}${url.search}`;
  };

  /** The revision of a route Document that a release's own content publication pins. */
  const pinnedRevisions = (releaseId: string, routePath: string) =>
    queryD1(
      `SELECT i.revision_id AS id
         FROM storefront_releases rel
         JOIN storefront_content_publication_items i
           ON i.publication_id = rel.content_publication_id AND i.item_type = 'template' AND i.deleted_at IS NULL
         JOIN storefront_theme_templates t ON t.id = i.content_id
        WHERE rel.id = ?1 AND t.theme_id = ?2 AND t.route_path = ?3`,
      releaseId,
      scope!.themeId,
      routePath,
    ).map((row) => String(row.id));

  /**
   * Publishes each page from the editor opened on it, the way the product
   * publishes: Publish seals the Document of the page open in the editor
   * (`publishMutation`'s `templateId` is the active template) and carries
   * every other Document's published revision forward
   * (`storefrontContentPublicationDal.resolveForTheme`). A route Document
   * that was never published from its own page is in no release. `null` is
   * the home page. Each publish must create a release, make it active and,
   * for a route page, pin that route Document's draft. Returns the last
   * release.
   */
  const publishPages = async (
    page: Page,
    pages: ReadonlyArray<BasCase | null>,
    step: string,
  ): Promise<string> => {
    let previous = (await publishedState()).active;
    for (const [index, testCase] of pages.entries()) {
      const activeBefore = evidence!.activeRelease();
      await openEditor(page, testCase ? editorRouteUrl(testCase.routePath) : EDITOR_PATH!);
      await (await publishShowingRelease(page)).close();
      const releaseId = await latestRelease(page, scope!);
      const where = testCase ? testCase.routePath : HOME;
      expect(releaseId, `publishing ${where} creates a release`).not.toBe(previous);
      expect((await publishedState()).active, `publishing ${where} activates its release`).toBe(releaseId);
      if (testCase) {
        const draft = queryD1(
          `SELECT draft_revision_id AS id FROM storefront_theme_templates
            WHERE theme_id = ?1 AND route_path = ?2 AND deleted_at IS NULL`,
          scope!.themeId,
          testCase.routePath,
        ).map((row) => String(row.id));
        expect(draft, `${testCase.routePath} has one route Document`).toHaveLength(1);
        expect(
          pinnedRevisions(releaseId, testCase.routePath),
          `publishing ${testCase.routePath} pins its draft`,
        ).toEqual(draft);
      }
      evidence!.ledger({
        case: testCase ? testCase.id : "home",
        step,
        action: `publish from the editor on ${where}`,
        routePath: testCase ? testCase.routePath : null,
        releaseId,
        activeBefore,
        activeAfter: evidence!.activeRelease(),
        // No ETag is read here: the public site is read once the round's last
        // release is active, on that step's own row.
        detail: {
          served:
            index < pages.length - 1
              ? `never served: an intermediate release of ${step}; the next publish replaced it before any public read`
              : `the round's last release: the public read and its served release id are on the step's own row`,
        },
      });
      previous = releaseId;
    }
    return previous!;
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    const page = await signedInPage(browser);
    try {
      await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
      // Q10: full Start recorded on the Theme itself, before any case preview.
      await evidence!.recordFullStartTheme(page);
      contentTsBefore = await evidence!.contentTsSha256(page);
      expect(contentTsBefore, "content.ts is hashed before the run").toMatch(/^[0-9a-f]{64}$/);
      // Each case on its own route of the run's Theme, seeded through the
      // editor's own writes.
      await seedRouteCases(page, fx!, ALL);
      // l1 becomes the Theme's root layout, its shared block on every page
      // (publish scope, S-b).
      await seedLayoutCase(page, fx!, L1);
      expect(await draftValues()).toEqual(Object.fromEntries(ALL.map((testCase) => [testCase.id, testCase.seed])));
      expect(await storedCaseSections(fx!, L1)).toEqual(L1.seed);
      codeRevisions = draftRevisions(CODE);
      for (const testCase of ALL) {
        evidence!.ledger({ case: testCase.id, step: "seed", action: "editor seed write", routePath: testCase.routePath });
      }
      evidence!.ledger({ case: "l1", step: "seed", action: "editor seed write (layout)", detail: { layout: layoutRow() } });

      const domain = (await serverFn(page, DOMAINS, "createStorefrontDomain", {
        storefrontId: scope!.storefrontId,
        hostname: HOST,
      })) as { success: boolean; message?: string; data?: { id: string } };
      expect(domain.success, domain.message).toBe(true);
      domainId = domain.data!.id;
      origin = `http://${HOST}:${new URL(test.info().project.use.baseURL!).port}`;
      evidence!.note({
        contentTsSha256: contentTsBefore,
        contentTsSha256Before: contentTsBefore,
        contentTsEdited: null,
        contentTsNote: "1a does not compare content.ts with the Starter's; the last test requires this spec left it unchanged",
      });
      evidence!.writeIdentity(false);
    } finally {
      await page.context().close();
    }
  });

  // Settle every start request before the page closes (Q10 counts every
  // answer): a start still in flight when a test body ends would otherwise
  // be answered while Playwright closes the context, and its read rejected
  // with "Test ended." (R-a, red2/green, 2026-11-22).
  test.afterEach(async () => {
    await evidence?.settlePreviewStarts();
  });

  test.afterAll(async ({ browser }) => {
    try {
      if (domainId) {
        const page = await signedInPage(browser);
        try {
          await page.goto("/", { waitUntil: "domcontentloaded" });
          // As in the lifecycle spec: the local stand-in domain has no
          // Cloudflare custom domain, and a primary domain cannot be deleted.
          await harness?.writeD1(
            "UPDATE storefront_domains SET is_primary = 0, cloudflare_domain_id = NULL WHERE id = ?1",
            domainId,
          );
          const removed = (await serverFn(page, DOMAINS, "deleteStorefrontDomains", {
            ids: [domainId],
          })) as { success: boolean; message?: string };
          expect(removed.success, removed.message).toBe(true);
        } finally {
          await page.context().close();
        }
      }
    } finally {
      evidence?.writeIdentity(true);
      await harness?.dispose();
    }
  });

  test("release 1: p1 per-field route desc edited in the Inspector through Design", async ({ page }) => {
    await designWalk(page, P1, "inspector", "R1/S1-S5");
  });

  test("release 1: p2 cross-name alias route heading edited on the canvas through Design", async ({ page }) => {
    await designWalk(page, P2, "inline", "R1/S1-S5");
  });

  test("release 1: p5 second same-text instance title edited in the Inspector through Design", async ({ page }) => {
    await designWalk(page, P5, "inspector", "R1/S1-S5");
  });

  test("release 1: p4a literal before the spread is shown as code and Design writes nothing", async ({ page }) => {
    await designWalk(page, P4A, "inspector", "R1/S1-S5");
  });

  test("release 1: p6 untraced value is refused on the canvas and Design writes nothing", async ({ page }) => {
    await designWalk(page, P6, "inline", "R1/S1-S5");
  });

  test("release 1: published, the public home and each route page show its values, code values unchanged", async ({ page, browser }) => {
    // Seven publishes, each from its own page, each possibly building.
    test.setTimeout(75 * 60_000);
    evidence!.observePreviewStarts(page);
    const values = await draftValues();
    expectIsolated(values);
    expectCodeUnwritten();
    // The seeded layout is pending: no release has sealed it yet.
    const layout0 = layoutRow();
    expect(layout0.draft, "the layout has a draft").toBeTruthy();
    expect(layout0.published, "the seeded layout is not published yet").not.toBe(layout0.draft);
    expect(await storedCaseSections(fx!, L1)).toEqual(L1.seed);

    // Connected but never published: nothing is served, the draft least of all.
    const storefront = storefrontFetcher(origin);
    const before = await storefront(HOME);
    expect(before.status).toBe(404);
    for (const value of editedValues(values)) expect(before.body).not.toContain(value);

    const { serveActiveRelease } = harness!;
    const state0 = await publishedState();
    const activeBefore = evidence!.activeRelease();
    // The home page, then every route page from its own editor: A3's edits
    // and A4's code-shown Documents alike. Release 1 is the last of these.
    const published = [null, ...ALL] as const;
    release1 = await publishPages(page, published, "R1/P1-publish");
    expect(release1).not.toBe(state0.active);
    const state1 = await publishedState();
    expect(state1.active).toBe(release1);
    expect(state1.releases).toBe(state0.releases + published.length);

    // P1: the release pins exactly the drafts, route Document by route Document.
    expect(releaseValues(release1)).toEqual(values);
    publication1 = (await releaseBuild(release1)).releaseContent;
    expect(publication1).toBeTruthy();
    expectCodeUnwritten();
    // The first publish sealed the pending layout; release 1 carries it.
    expect(layoutRow(), "the layout is published at its seeded draft").toEqual({
      ...layout0,
      published: layout0.draft,
    });
    expect(pinnedLayout(release1), "release 1 pins the seeded layout").toEqual([layout0.draft]);
    expect(releaseLayout(release1)).toEqual(L1.seed);

    const served = await serveActiveRelease(valueOf(values.p1, P1), release1, origin);
    expect(served.releaseId).toBe(release1);
    const servedId = await expectServed(release1);
    values1 = values;
    const shots = await expectPublic(browser, values1, L1.seed, [], "r1");
    evidence!.ledger({
      case: "p1,p2,p5,p3,p4a,p6,l1",
      step: "R1/P1-P2",
      action: "publish",
      releaseId: release1,
      activeBefore,
      activeAfter: evidence!.activeRelease(),
      evidence: shots,
      servedReleaseId: servedId,
      detail: { layout: layoutRow() },
    });
    evidence!.note({ release1, publication1 });
  });

  test("release 2: p1 per-field route desc edited on the canvas through Design", async ({ page }) => {
    await designWalk(page, P1, "inline", "R2/S1-S5");
  });

  test("release 2: p2 cross-name alias route heading edited in the Inspector through Design", async ({ page }) => {
    await designWalk(page, P2, "inspector", "R2/S1-S5");
  });

  test("release 2: p5 second same-text instance title edited on the canvas through Design", async ({ page }) => {
    await designWalk(page, P5, "inline", "R2/S1-S5");
  });

  test("release 2: the draft stays off the public site until published, then the public site shows release 2", async ({ page, browser }) => {
    // Three publishes, each from its own page, each possibly building.
    test.setTimeout(40 * 60_000);
    evidence!.observePreviewStarts(page);
    const values = await draftValues();
    expectIsolated(values);
    expectCodeUnwritten();
    const r1 = editedValues(values1!);
    const r2 = editedValues(values);
    for (const [index, value] of r2.entries()) expect(value).not.toBe(r1[index]);

    // The draft is not public while release 1 is active.
    expect(await expectServed(release1)).toBe(release1);
    const hidden = await expectPublic(browser, values1!, L1.seed, r2, "r2-draft-unpublished");

    const { serveActiveRelease } = harness!;
    const activeBefore = evidence!.activeRelease();
    const layout1 = layoutRow();
    // Only A3's pages changed: each is published from its own editor, and
    // release 2 (the last) carries A4's release 1 revisions forward.
    const before2 = await publishedState();
    release2 = await publishPages(page, EDITED, "R2/P1-publish");
    expect(release2).not.toBe(release1);
    const state2 = await publishedState();
    expect(state2.active).toBe(release2);
    expect(state2.releases).toBe(before2.releases + EDITED.length);

    expect(releaseValues(release2)).toEqual(values);
    // Release 1 still pins its own values: publishing again changed nothing in it.
    expect(releaseValues(release1)).toEqual(values1);
    const publication2 = (await releaseBuild(release2)).releaseContent;
    expect(publication2).toBeTruthy();
    expect(publication2).not.toBe(publication1);
    // No layout change was pending: release 2 carries release 1's layout.
    expect(layoutRow()).toEqual(layout1);
    expect(pinnedLayout(release2)).toEqual(pinnedLayout(release1));
    expect(releaseLayout(release2)).toEqual(L1.seed);

    const served = await serveActiveRelease(valueOf(values.p1, P1), release2, origin);
    expect(served.releaseId).toBe(release2);
    const servedId = await expectServed(release2);
    values2 = values;
    const shots = await expectPublic(browser, values2, L1.seed, r1, "r2");
    evidence!.ledger({
      case: "p1,p2,p5,p3,p4a,p6,l1",
      step: "R2/P1-P2",
      action: "publish",
      releaseId: release2,
      activeBefore,
      activeAfter: evidence!.activeRelease(),
      evidence: [...hidden, ...shots],
      servedReleaseId: servedId,
      detail: { layout: layoutRow() },
    });
    evidence!.note({ release2, publication2 });
  });

  test("publish scope: p1 per-field route desc edited in the Inspector and left unpublished", async ({ page }) => {
    await designWalk(page, P1, "inspector", "S-a/S1-S5");
  });

  test("publish scope: p2 cross-name alias route heading edited on the canvas, to be published on its own", async ({ page }) => {
    await designWalk(page, P2, "inline", "S-a/S1-S5");
  });

  test("publish scope: publishing p2 from its own editor seals p2 only, p1's unpublished draft stays off the public site", async ({ page, browser }) => {
    test.setTimeout(20 * 60_000);
    evidence!.observePreviewStarts(page);
    const drafts = await draftValues();
    // p1 and p2 hold new drafts; every other route Document is release 2's.
    expect(drafts).toEqual({ ...values2!, p1: drafts.p1, p2: drafts.p2 });
    expect(valueOf(drafts.p1, P1), "p1 holds a new draft").not.toBe(valueOf(values2!.p1, P1));
    expect(valueOf(drafts.p2, P2), "p2 holds a new draft").not.toBe(valueOf(values2!.p2, P2));
    expectCodeUnwritten();
    const p1Before = routeRow(P1);
    const p2Before = routeRow(P2);
    const layoutBefore = layoutRow();
    expect(p1Before.draft, "p1's draft is unpublished").not.toBe(p1Before.published);
    expect(pinnedRevisions(release2, P1.routePath), "p1's published revision is release 2's").toEqual([
      p1Before.published,
    ]);
    expect(p2Before.draft, "p2's draft is unpublished").not.toBe(p2Before.published);
    expect(layoutBefore.draft, "no layout change is pending").toBe(layoutBefore.published);
    const pinsBefore = pinMap(release2);
    // Neither draft is public while release 2 is active.
    const unpublished = [valueOf(drafts.p1, P1), valueOf(drafts.p2, P2)];
    expect(await expectServed(release2)).toBe(release2);
    const hidden = await expectPublic(browser, values2!, L1.seed, unpublished, "scope-a-before");

    const { serveActiveRelease } = harness!;
    const activeBefore = evidence!.activeRelease();
    const before3 = await publishedState();
    release3 = await publishPages(page, [P2], "S-a/P1-publish");
    const state3 = await publishedState();
    expect(state3.active).toBe(release3);
    expect(state3.releases).toBe(before3.releases + 1);

    // p2's draft is published; p1's row, draft and published revision alike,
    // and the layout's are exactly as they were.
    expect(routeRow(P2), "p2 is published at its draft").toEqual({ ...p2Before, published: p2Before.draft });
    expect(routeRow(P1), "publishing p2 leaves p1's row alone").toEqual(p1Before);
    expect(layoutRow(), "publishing p2 leaves the layout alone").toEqual(layoutBefore);
    // Release 3 pins release 2's items with exactly one change: p2's draft.
    expect(pinMap(release3), "release 3 = release 2 + p2's draft").toEqual({
      ...pinsBefore,
      [`template:${p2Before.id}`]: p2Before.draft,
    });
    expect(pinnedRevisions(release3, P1.routePath), "release 3 pins p1's published revision").toEqual([
      p1Before.published,
    ]);
    expect(pinnedRevisions(release3, P1.routePath)).not.toEqual([p1Before.draft]);
    expect(pinnedLayout(release3)).toEqual(pinnedLayout(release2));
    values3 = { ...values2!, p2: drafts.p2! };
    expect(releaseValues(release3)).toEqual(values3);
    expect(releaseLayout(release3)).toEqual(L1.seed);
    // The older releases are untouched.
    expect(releaseValues(release2)).toEqual(values2);
    expect(releaseValues(release1)).toEqual(values1);

    const served = await serveActiveRelease(valueOf(values3.p2, P2), release3, origin);
    expect(served.releaseId).toBe(release3);
    const servedId = await expectServed(release3);
    // p1's page shows p1's published value; its draft is nowhere.
    const p1Page = await storefrontFetcher(origin)(P1.routePath);
    expect(p1Page.status).toBe(200);
    expect(p1Page.body, "p1's page shows its published value").toContain(valueOf(values2!.p1, P1));
    expect(p1Page.body, "p1's page does not show its draft").not.toContain(valueOf(drafts.p1, P1));
    const shots = await expectPublic(
      browser,
      values3,
      L1.seed,
      [valueOf(drafts.p1, P1), valueOf(values2!.p2, P2), ...editedValues(values1!)],
      "scope-a",
    );
    evidence!.ledger({
      case: "p2 (p1 unpublished)",
      step: "S-a/P1-P2",
      action: "publish p2 alone",
      routePath: P2.routePath,
      releaseId: release3,
      activeBefore,
      activeAfter: evidence!.activeRelease(),
      evidence: [...hidden, ...shots],
      servedReleaseId: servedId,
      detail: {
        p1: { ...routeRow(P1), pinnedInRelease2: pinnedRevisions(release2, P1.routePath), pinnedInRelease3: pinnedRevisions(release3, P1.routePath) },
        p2: { ...routeRow(P2), pinnedInRelease2: pinnedRevisions(release2, P2.routePath), pinnedInRelease3: pinnedRevisions(release3, P2.routePath) },
        layout: { ...layoutRow(), pinnedInRelease2: pinnedLayout(release2), pinnedInRelease3: pinnedLayout(release3) },
      },
    });
    evidence!.note({ release3 });
  });

  test("publish scope: l1 layout-shared second instance edited on the canvas and left pending", async ({ page }) => {
    layoutSealed = await layoutWalk(page, "inline", "S-b/S1-S5");
  });

  test("publish scope: publishing p2 with a pending layout seals the layout too, p1's page shows the new shared block over its published body", async ({ page, browser }) => {
    test.setTimeout(20 * 60_000);
    evidence!.observePreviewStarts(page);
    const drafts = await draftValues();
    // p1 still holds its unpublished draft; everything else is release 3's.
    expect(drafts).toEqual({ ...values3!, p1: drafts.p1 });
    expect(valueOf(drafts.p1, P1), "p1 still holds its unpublished draft").not.toBe(valueOf(values3!.p1, P1));
    expectCodeUnwritten();
    const layoutDraft = await storedCaseSections(fx!, L1);
    expect(layoutDraft, "the layout draft is the walk's").toEqual(layoutSealed);
    expect(valueOf(layoutDraft, L1), "the layout holds a new draft").not.toBe(valueOf(L1.seed, L1));
    const p1Before = routeRow(P1);
    const p2Before = routeRow(P2);
    const layoutBefore = layoutRow();
    expect(layoutBefore.draft, "a layout change is pending").not.toBe(layoutBefore.published);
    expect(pinnedLayout(release3), "release 3 pins the layout's published revision").toEqual([layoutBefore.published]);
    expect(p1Before.draft, "p1's draft is still unpublished").not.toBe(p1Before.published);
    expect(p2Before.draft, "p2 has nothing new").toBe(p2Before.published);
    const pinsBefore = pinMap(release3);
    // Neither the layout draft nor p1's is public while release 3 is active.
    expect(await expectServed(release3)).toBe(release3);
    const hidden = await expectPublic(
      browser,
      values3!,
      L1.seed,
      [valueOf(layoutDraft, L1), valueOf(drafts.p1, P1)],
      "scope-b-before",
    );

    const { serveActiveRelease } = harness!;
    const activeBefore = evidence!.activeRelease();
    const before4 = await publishedState();
    release4 = await publishPages(page, [P2], "S-b/P1-publish");
    const state4 = await publishedState();
    expect(state4.active).toBe(release4);
    expect(state4.releases).toBe(before4.releases + 1);

    // Publishing p2 sealed the pending layout: the layout row is published at
    // its draft and release 4 pins that revision. p1's and p2's rows are as
    // they were.
    expect(layoutRow(), "the layout is published at its draft").toEqual({
      ...layoutBefore,
      published: layoutBefore.draft,
    });
    expect(routeRow(P1), "publishing p2 leaves p1's row alone").toEqual(p1Before);
    expect(routeRow(P2), "p2's row is unchanged").toEqual(p2Before);
    // Release 4 pins release 3's items with exactly one change: the layout.
    expect(pinMap(release4), "release 4 = release 3 + the layout's draft").toEqual({
      ...pinsBefore,
      [`template:${layoutBefore.id}`]: layoutBefore.draft,
    });
    expect(pinnedLayout(release4), "release 4 pins the layout draft").toEqual([layoutBefore.draft]);
    expect(pinnedRevisions(release4, P1.routePath), "release 4 pins p1's published revision").toEqual([
      p1Before.published,
    ]);
    expect(pinnedRevisions(release4, P2.routePath)).toEqual(pinnedRevisions(release3, P2.routePath));
    expect(releaseValues(release4)).toEqual(values3);
    expect(releaseLayout(release4)).toEqual(layoutDraft);
    // Release 3 still pins the layout it was published with.
    expect(pinnedLayout(release3)).toEqual([layoutBefore.published]);
    expect(releaseLayout(release3)).toEqual(L1.seed);

    const served = await serveActiveRelease(valueOf(layoutDraft, L1), release4, origin);
    expect(served.releaseId).toBe(release4);
    const servedId = await expectServed(release4);
    // p1's page: the new shared block, over p1's published body.
    const p1Page = await storefrontFetcher(origin)(P1.routePath);
    expect(p1Page.status).toBe(200);
    expect(p1Page.body, "p1's page shows the new shared block").toContain(valueOf(layoutDraft, L1));
    expect(p1Page.body, "p1's page shows its published value").toContain(valueOf(values3!.p1, P1));
    expect(p1Page.body, "p1's page does not show its draft").not.toContain(valueOf(drafts.p1, P1));
    const shots = await expectPublic(
      browser,
      values3!,
      layoutDraft,
      [valueOf(drafts.p1, P1), valueOf(values2!.p2, P2), ...editedValues(values1!)],
      "scope-b",
    );
    draftsLast = drafts;
    evidence!.ledger({
      case: "p2 + pending l1 (p1 unpublished)",
      step: "S-b/P1-P2",
      action: "publish p2 with a pending layout",
      routePath: P2.routePath,
      releaseId: release4,
      activeBefore,
      activeAfter: evidence!.activeRelease(),
      evidence: [...hidden, ...shots],
      servedReleaseId: servedId,
      detail: {
        p1: { ...routeRow(P1), pinnedInRelease3: pinnedRevisions(release3, P1.routePath), pinnedInRelease4: pinnedRevisions(release4, P1.routePath) },
        p2: { ...routeRow(P2), pinnedInRelease3: pinnedRevisions(release3, P2.routePath), pinnedInRelease4: pinnedRevisions(release4, P2.routePath) },
        layout: { ...layoutRow(), pinnedInRelease3: pinnedLayout(release3), pinnedInRelease4: pinnedLayout(release4) },
      },
    });
    evidence!.note({ release4 });
  });

  test("rollback to release 1 with expectedActiveReleaseId: a stale expectation is refused, then the public site is back to release 1 after a reload", async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);
    evidence!.observePreviewStarts(page);
    const { serveActiveRelease } = harness!;
    const before = await publishedState();
    // The last release made is S-b's.
    expect(before.active).toBe(release4);

    await openEditor(page);
    // Taken once the editor is open, so nothing opening it does is read as
    // a change the rollback made.
    const snapshot0 = rollbackSnapshot();
    // A stale expectation (release 1 is not active) is refused and moves nothing.
    const stale = (await serverFn(page, RELEASES, "activateStorefrontRelease", {
      storefrontId: scope!.storefrontId,
      releaseId: release1,
      expectedActiveReleaseId: release1,
    })) as { success: boolean; message?: string; error?: string };
    expect(stale.success, "a stale expectedActiveReleaseId is refused").toBe(false);
    expect(stale.error).toBe("RELEASE_ACTIVATION_CONFLICT");
    expect((await publishedState()).active).toBe(release4);
    expect(rollbackSnapshot(), "a refused rollback changes nothing").toEqual(snapshot0);
    evidence!.ledger({
      case: "p1,p2,p5,p3,p4a,p6,l1",
      step: "P3",
      action: "rollback refused (stale expectedActiveReleaseId)",
      releaseId: release1,
      activeBefore: release4,
      activeAfter: evidence!.activeRelease(),
      expectedActiveReleaseId: release1,
      result: stale.error ?? "refused",
      servedReleaseId: await expectServed(release4),
    });

    const activated = (await serverFn(page, RELEASES, "activateStorefrontRelease", {
      storefrontId: scope!.storefrontId,
      releaseId: release1,
      expectedActiveReleaseId: release4,
    })) as { success: boolean; message?: string };
    expect(activated.success, activated.message).toBe(true);

    const after = await publishedState();
    expect(after.active).toBe(release1);
    expect(after.releases).toBe(before.releases);
    // P3: only the active release moved. Release, publication and revision
    // counts, the theme's generations and every template row are unchanged;
    // the drafts keep their pre-rollback values and each release its own.
    expect(rollbackSnapshot(), "a rollback moves the active release only").toEqual(snapshot0);
    expect(await draftValues()).toEqual(draftsLast);
    expect(await storedCaseSections(fx!, L1)).toEqual(layoutSealed);
    expect(releaseValues(release1)).toEqual(values1);
    expect(releaseValues(release2)).toEqual(values2);
    expect(releaseValues(release3)).toEqual(values3);
    expect(releaseValues(release4)).toEqual(values3);
    expect(releaseLayout(release1)).toEqual(L1.seed);
    expect(releaseLayout(release4)).toEqual(layoutSealed);
    expectCodeUnwritten();

    // P4: the public site, reloaded, is back to release 1 everywhere, the
    // layout's seeded block included.
    const restored = await serveActiveRelease(valueOf(values1!.p1, P1), release1, origin);
    expect(restored.releaseId).toBe(release1);
    expect(restored.contentPublicationId).toBe(publication1);
    const servedId = await expectServed(release1);
    const shots = await expectPublic(
      browser,
      values1!,
      L1.seed,
      [...editedValues(values2!), ...editedValues(draftsLast!), valueOf(layoutSealed!, L1)],
      "rollback",
    );
    evidence!.ledger({
      case: "p1,p2,p5,p3,p4a,p6,l1",
      step: "P3-P4",
      action: "rollback",
      releaseId: release1,
      activeBefore: release4,
      activeAfter: evidence!.activeRelease(),
      expectedActiveReleaseId: release4,
      result: "activated",
      evidence: shots,
      servedReleaseId: servedId,
    });
  });

  test("after the rollback the editor reloads with the pre-rollback drafts on every route under full Start", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    evidence!.observePreviewStarts(page);
    // P5 (Q6): the rollback moved the public site only; the editor keeps the
    // drafts it had (S-b's: p1's unpublished draft, the sealed layout), in
    // storage and on the canvas, route by route.
    expect(await draftValues()).toEqual(draftsLast);
    expect(await storedCaseSections(fx!, L1)).toEqual(layoutSealed);
    const shots: string[] = [];
    for (const testCase of ALL) {
      await page.goto(editorRouteUrl(testCase.routePath), { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({ timeout: 45_000 });
      const root = previewFrame(page).locator(`[data-bas-case="${testCase.id}"]`);
      await expect(root, `${testCase.routePath} renders on the canvas`).toBeVisible({ timeout: 90_000 });
      for (const element of testCase.elements) {
        await expect(
          root.locator(element.tag).nth(element.nth),
          `canvas ${testCase.id} ${element.tag}[${element.nth}] shows the draft`,
        ).toHaveText(element.text(draftsLast![testCase.id]!), { timeout: 30_000 });
      }
      const shell = previewFrame(page).locator(`[data-bas-case="${L1.id}"]`);
      for (const element of L1.elements) {
        await expect(
          shell.locator(element.tag).nth(element.nth),
          `canvas ${testCase.routePath} l1 ${element.tag}[${element.nth}] shows the layout draft`,
        ).toHaveText(element.text(layoutSealed!), { timeout: 30_000 });
      }
      // Full Start served this canvas: Start's own router is the preview's.
      const frame = previewFrameOf(page);
      expect(frame, "the canvas frame is attached").toBeTruthy();
      const signal = await frame!.evaluate(() => {
        const w = window as unknown as { __TSR_ROUTER__?: unknown; __morphPreviewRouter?: unknown };
        return {
          hasTsrRouter: Boolean(w.__TSR_ROUTER__),
          routerMatchesTsr: Boolean(w.__morphPreviewRouter && w.__morphPreviewRouter === w.__TSR_ROUTER__),
        };
      });
      expect(signal, `${testCase.routePath} canvas runs under full Start`).toEqual({
        hasTsrRouter: true,
        routerMatchesTsr: true,
      });
      const shot = path.join(evidence!.evidenceDir(), `editor-after-rollback-${slug(testCase.routePath)}.png`);
      await page.screenshot({ path: shot, fullPage: true });
      shots.push(path.basename(shot));
    }
    expect(await draftValues(), "reloading wrote nothing").toEqual(draftsLast);
    expect(await storedCaseSections(fx!, L1), "reloading wrote nothing to the layout").toEqual(layoutSealed);
    expectCodeUnwritten();
    await evidence!.expectFullStartObserved();
    evidence!.ledger({
      case: "p1,p2,p5,p3,p4a,p6,l1",
      step: "P5",
      action: "editor reload after rollback",
      activeBefore: release1,
      activeAfter: evidence!.activeRelease(),
      evidence: shots,
      detail: { p1: routeRow(P1), layout: layoutRow() },
    });
    reloadedAfterRollback = true;
  });

  /**
   * R-a/R-b run only after the whole chain: a grep that selected them alone
   * left these unset, and that is a failure, never a pass.
   */
  const expectChainRan = () => {
    expect(
      {
        release1: Boolean(release1),
        release4: Boolean(release4),
        values1: Boolean(values1),
        draftsLast: Boolean(draftsLast),
        layoutSealed: Boolean(layoutSealed),
        reloadedAfterRollback,
      },
      "publish after rollback runs after its prerequisites (-g @publish-after-rollback)",
    ).toEqual({
      release1: true,
      release4: true,
      values1: true,
      draftsLast: true,
      layoutSealed: true,
      reloadedAfterRollback: true,
    });
  };

  test("publish after rollback: p2, whose published revision the rollback took off the storefront, shows unpublished changes and Publish is enabled", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    expectChainRan();
    evidence!.observePreviewStarts(page);
    // Release 1 is live; p2's row still names S-a's revision as published,
    // which release 4 pinned and release 1 does not.
    expect((await publishedState()).active).toBe(release1);
    const p2 = routeRow(P2);
    expect(p2.draft, "p2 has no unpublished draft of its own").toBe(p2.published);
    expect(pinnedRevisions(release4, P2.routePath), "release 4 pins p2's published revision").toEqual([p2.published]);
    const live = pinnedRevisions(release1, P2.routePath);
    expect(live, "release 1 pins one p2 revision").toHaveLength(1);
    expect(live[0], "the rollback took p2's published revision off the storefront").not.toBe(p2.published);
    const servedBefore = await expectServed(release1);

    await openEditor(page, editorRouteUrl(P2.routePath));
    const status = page.locator("[data-editor-save-status]");
    await expect(status, "p2's editor reports unpublished changes").toHaveAttribute(
      "data-publish-state",
      "unpublished",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("button", { name: /^Publish$/ }), "Publish is enabled on p2").toBeEnabled({
      timeout: 30_000,
    });
    const reason = await status.getAttribute("data-unpublished-reason");
    const shot = path.join(evidence!.evidenceDir(), "editor-after-rollback-publish-state-b1-p2.png");
    await page.screenshot({ path: shot, fullPage: true });
    evidence!.ledger({
      case: "p2",
      step: "R-a",
      action: "editor after rollback: unpublished changes, Publish enabled",
      routePath: P2.routePath,
      activeBefore: release1,
      activeAfter: evidence!.activeRelease(),
      evidence: [path.basename(shot)],
      servedReleaseId: servedBefore,
      detail: { p2: { ...p2, pinnedInRelease1: live }, unpublishedReason: reason },
    });
  });

  test("publish after rollback: publishing p2 alone pins its draft and release 1's revision for every other page and the layout", async ({ page, browser }) => {
    test.setTimeout(20 * 60_000);
    expectChainRan();
    evidence!.observePreviewStarts(page);
    expect((await publishedState()).active).toBe(release1);
    const p2Before = routeRow(P2);
    const pins1 = pinMap(release1);
    const layout1 = pinnedLayout(release1);
    const layout4 = pinnedLayout(release4);
    expect(layout1, "release 1 pins one layout revision").toHaveLength(1);
    expect(layout4, "release 4 pins another layout revision").not.toEqual(layout1);
    expect(await draftValues(), "the drafts are the pre-rollback ones").toEqual(draftsLast);

    const { serveActiveRelease } = harness!;
    const before5 = await publishedState();
    release5 = await publishPages(page, [P2], "R-b/P1-publish");
    const state5 = await publishedState();
    expect(state5.active).toBe(release5);
    expect(state5.releases).toBe(before5.releases + 1);
    expect(routeRow(P2), "p2 is published at its draft").toEqual({ ...p2Before, published: p2Before.draft });

    // Release 5 pins release 1's items with exactly one change: p2's draft.
    expect(pinMap(release5), "release 5 = release 1 + p2's draft").toEqual({
      ...pins1,
      [`template:${p2Before.id}`]: p2Before.draft,
    });
    expect(pinnedLayout(release5), "release 5 keeps release 1's layout, not release 4's").toEqual(layout1);
    for (const testCase of ALL.filter((candidate) => candidate !== P2)) {
      expect(
        pinnedRevisions(release5, testCase.routePath),
        `release 5 pins ${testCase.routePath} at release 1's revision`,
      ).toEqual(pinnedRevisions(release1, testCase.routePath));
    }
    values5 = { ...values1!, p2: draftsLast!.p2! };
    expect(releaseValues(release5)).toEqual(values5);
    expect(releaseLayout(release5)).toEqual(L1.seed);
    // Older releases are untouched.
    expect(releaseValues(release1)).toEqual(values1);
    expect(releaseLayout(release4)).toEqual(layoutSealed);

    const served = await serveActiveRelease(valueOf(values5.p2, P2), release5, origin);
    expect(served.releaseId).toBe(release5);
    const servedId = await expectServed(release5);
    const storefront = storefrontFetcher(origin);
    const p1Page = await storefront(P1.routePath);
    expect(p1Page.status).toBe(200);
    expect(p1Page.body, "p1's page shows release 1's value").toContain(valueOf(values1!.p1, P1));
    expect(p1Page.body, "p1's page shows release 1's layout, not release 4's").not.toContain(
      valueOf(layoutSealed!, L1),
    );
    const p2Page = await storefront(P2.routePath);
    expect(p2Page.status).toBe(200);
    expect(p2Page.body, "p2's page shows its new value").toContain(valueOf(values5.p2, P2));
    const absent = [
      valueOf(values2!.p1, P1),
      valueOf(values2!.p2, P2),
      valueOf(values2!.p5, P5),
      valueOf(draftsLast!.p1, P1),
      valueOf(layoutSealed!, L1),
    ];
    // The proof that every other page is release 1's is the pin-map equality
    // above; the public reads below show the same on the storefront.
    const shots = await expectPublic(browser, values5, L1.seed, absent, "after-rollback-publish");
    evidence!.ledger({
      case: "p2 (after rollback to release 1)",
      step: "R-b/P1-P2",
      action: "publish p2 alone after the rollback",
      routePath: P2.routePath,
      releaseId: release5,
      activeBefore: release1,
      activeAfter: evidence!.activeRelease(),
      evidence: shots,
      servedReleaseId: servedId,
      detail: {
        p1: { ...routeRow(P1), pinnedInRelease1: pinnedRevisions(release1, P1.routePath), pinnedInRelease5: pinnedRevisions(release5, P1.routePath) },
        p2: { ...routeRow(P2), pinnedInRelease1: pinnedRevisions(release1, P2.routePath), pinnedInRelease5: pinnedRevisions(release5, P2.routePath) },
        layout: { ...layoutRow(), pinnedInRelease1: layout1, pinnedInRelease4: layout4, pinnedInRelease5: pinnedLayout(release5) },
      },
    });
    evidence!.note({ release5 });

    // content.ts: this spec writes Documents only, never the content module.
    const contentTsAfter = await evidence!.contentTsSha256(page);
    evidence!.note({ contentTsSha256After: contentTsAfter, contentTsUnchangedByRun: contentTsAfter === contentTsBefore });
    expect(contentTsBefore, "content.ts was hashed before the run").toMatch(/^[0-9a-f]{64}$/);
    expect(contentTsAfter, "content.ts is unchanged by the run").toBe(contentTsBefore);
    // Q10 again, now over every preview start of the whole chain.
    await evidence!.expectFullStartObserved();
  });

  test("publish after rollback: a Build Preview on p1 leaves the untouched layout alone, and publishing p1 keeps release 1's layout revision", async ({ page, browser }) => {
    test.setTimeout(30 * 60_000);
    expectChainRan();
    expect({ release5: Boolean(release5), values5: Boolean(values5) }, "R-c runs after R-b").toEqual({
      release5: true,
      values5: true,
    });
    evidence!.observePreviewStarts(page);
    expect((await publishedState()).active).toBe(release5);
    const layout1 = pinnedLayout(release1);
    const layout4 = pinnedLayout(release4);
    // The layout is untouched since the rollback: its row still names release
    // 4's revision as draft and published, and the live release pins release 1's.
    const layoutBefore = layoutRow();
    expect(layoutBefore.draft, "no layout change is pending").toBe(layoutBefore.published);
    expect([layoutBefore.published], "the layout row names release 4's revision").toEqual(layout4);
    expect(pinnedLayout(release5), "release 5 pins release 1's layout").toEqual(layout1);
    const p1Before = routeRow(P1);
    expect(p1Before.draft, "p1 still holds its unpublished draft").not.toBe(p1Before.published);
    expect(await draftValues(), "the drafts are the pre-rollback ones, p2's published").toEqual(draftsLast);
    const pins5 = pinMap(release5);
    const servedBefore = await expectServed(release5);

    // The toolbar Build Preview on p1's editor: the same preparation over the
    // page and the layout as a publish that builds, then the build.
    await openEditor(page, editorRouteUrl(P1.routePath));
    const build = page.locator("button[data-editor-build-action]");
    await build.click();
    await expect(build).toHaveAttribute("data-build-pending", "true", { timeout: 30_000 });
    await expect(build).toHaveAttribute("data-build-pending", "false", { timeout: 9 * 60_000 });
    const buildPreview = page.locator('[aria-label="Build preview"]');
    await expect(buildPreview, "the Build Preview is shown").toBeVisible({ timeout: 60_000 });
    const buildShot = path.join(evidence!.evidenceDir(), "build-preview-after-rollback-b1-p1.png");
    await page.screenshot({ path: buildShot, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(buildPreview).toBeHidden({ timeout: 30_000 });

    // What the merchant sees: the editor does not list the shared layout as
    // a pending, unpublished change. p1's own toolbar cannot show it, since
    // p1's unpublished draft comes first in `describeContentChanges` and its
    // reason is "Page content edited" either way. p2 has nothing of its own
    // to publish (R-b published it at its draft, and release 5 serves that
    // draft), so on p2's editor the toolbar's publish state is the layout's
    // and the theme source's alone: "published" and "Nothing to publish"
    // when the layout row is untouched, "unpublished" and "Shared layout
    // edited" when preparing the build forked the layout's draft (draft !=
    // published, `hasUnpublishedDraft`). The fork is there from the first
    // render, so a forked layout never reads "published", even for a moment.
    await openEditor(page, editorRouteUrl(P2.routePath));
    const p2Status = page.locator("[data-editor-save-status]");
    const readP2Status = async () => ({
      publishState: await p2Status.getAttribute("data-publish-state"),
      unpublishedReason: await p2Status.getAttribute("data-unpublished-reason"),
    });
    const layoutNotPending = { publishState: "published", unpublishedReason: "Nothing to publish" };
    const statusShot = path.join(evidence!.evidenceDir(), "editor-after-build-preview-layout-not-pending-b1-p2.png");
    try {
      await expect
        .poll(readP2Status, {
          message: "after the Build Preview, p2's editor does not list the shared layout as an unpublished change",
          timeout: 30_000,
        })
        .toEqual(layoutNotPending);
      await expect(page.getByRole("button", { name: /^Publish$/ }), "Publish is disabled on p2").toBeDisabled({
        timeout: 30_000,
      });
    } finally {
      const observed = await readP2Status().catch(() => null);
      await page.screenshot({ path: statusShot, fullPage: true }).catch(() => undefined);
      evidence!.ledger({
        case: "l1 (after rollback, Build Preview on p1, read on p2)",
        step: "R-c/Build Preview/editor publish state",
        action: "p2's editor after the Build Preview on p1: the shared layout is not an unpublished change",
        routePath: P2.routePath,
        activeBefore: release5,
        activeAfter: evidence!.activeRelease(),
        evidence: [path.basename(statusShot)],
        servedReleaseId: servedBefore,
        detail: {
          editorPublishState: { expected: layoutNotPending, observed },
          p2: routeRow(P2),
          layout: layoutRow(),
        },
      });
    }

    // Preparing the untouched layout for the build wrote nothing to it.
    expect(layoutRow(), "the Build Preview leaves the untouched layout row alone").toEqual(layoutBefore);
    expect(await storedCaseSections(fx!, L1), "the layout draft is still release 4's").toEqual(layoutSealed);
    expect((await publishedState()).active, "a Build Preview activates nothing").toBe(release5);
    evidence!.ledger({
      case: "p1, l1 (after rollback, layout untouched)",
      step: "R-c/Build Preview",
      action: "toolbar Build Preview on p1 after the rollback",
      routePath: P1.routePath,
      activeBefore: release5,
      activeAfter: evidence!.activeRelease(),
      evidence: [path.basename(buildShot)],
      servedReleaseId: servedBefore,
      detail: { p1: routeRow(P1), layout: { ...layoutRow(), pinnedInRelease1: layout1, pinnedInRelease4: layout4, pinnedInRelease5: pinnedLayout(release5) } },
    });

    const { serveActiveRelease } = harness!;
    const before6 = await publishedState();
    release6 = await publishPages(page, [P1], "R-c/P1-publish");
    const state6 = await publishedState();
    expect(state6.active).toBe(release6);
    expect(state6.releases).toBe(before6.releases + 1);
    // The Build Preview's seal pins p1's draft, so a publish that prepares
    // again may fork it: read the row the publish left, not the one before.
    const p1After = routeRow(P1);
    expect(p1After.id).toBe(p1Before.id);
    expect(p1After.published, "p1 is published at its draft").toBe(p1After.draft);
    expect(layoutRow(), "publishing p1 leaves the untouched layout row alone").toEqual(layoutBefore);

    // Release 6 pins release 5's items with exactly one change: p1's draft.
    expect(pinMap(release6), "release 6 = release 5 + p1's draft").toEqual({
      ...pins5,
      [`template:${p1After.id}`]: p1After.draft,
    });
    expect(pinnedLayout(release6), "release 6 keeps release 1's layout, not release 4's").toEqual(layout1);
    const values6: CaseValues = { ...values5!, p1: draftsLast!.p1! };
    expect(releaseValues(release6)).toEqual(values6);
    expect(releaseLayout(release6)).toEqual(L1.seed);
    // Older releases are untouched.
    expect(releaseValues(release5)).toEqual(values5);
    expect(releaseLayout(release4)).toEqual(layoutSealed);

    const served = await serveActiveRelease(valueOf(values6.p1, P1), release6, origin);
    expect(served.releaseId).toBe(release6);
    const servedId = await expectServed(release6);
    const p1Page = await storefrontFetcher(origin)(P1.routePath);
    expect(p1Page.status).toBe(200);
    expect(p1Page.body, "p1's page shows its new value").toContain(valueOf(values6.p1, P1));
    expect(p1Page.body, "p1's page shows release 1's layout, not release 4's").not.toContain(
      valueOf(layoutSealed!, L1),
    );
    const absent = [
      valueOf(values2!.p1, P1),
      valueOf(values2!.p2, P2),
      valueOf(values2!.p5, P5),
      valueOf(layoutSealed!, L1),
    ];
    const shots = await expectPublic(browser, values6, L1.seed, absent, "after-rollback-build-preview-publish");
    evidence!.ledger({
      case: "p1 (after rollback, Build Preview, layout untouched)",
      step: "R-c/P1-P2",
      action: "publish p1 after a Build Preview, after the rollback",
      routePath: P1.routePath,
      releaseId: release6,
      activeBefore: release5,
      activeAfter: evidence!.activeRelease(),
      evidence: shots,
      servedReleaseId: servedId,
      detail: {
        p1: { ...routeRow(P1), pinnedInRelease5: pinnedRevisions(release5, P1.routePath), pinnedInRelease6: pinnedRevisions(release6, P1.routePath) },
        layout: { ...layoutRow(), pinnedInRelease1: layout1, pinnedInRelease4: layout4, pinnedInRelease6: pinnedLayout(release6) },
      },
    });
    evidence!.note({ release6 });

    // content.ts: a Build Preview writes no source either.
    const contentTsAfter = await evidence!.contentTsSha256(page);
    evidence!.note({ contentTsSha256After: contentTsAfter, contentTsUnchangedByRun: contentTsAfter === contentTsBefore });
    expect(contentTsAfter, "content.ts is unchanged by the run").toBe(contentTsBefore);
    await evidence!.expectFullStartObserved();
  });
});
