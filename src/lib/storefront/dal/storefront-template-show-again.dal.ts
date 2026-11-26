import { env } from "cloudflare:workers";
import {
  showSectionAgainInDocument,
  type ShowSectionAgainOutcome,
} from "../content/show-section-again";
import { TEMPLATE_DRAFT_GENERATION_MISMATCH } from "../theme-write-errors";
import {
  assertShownSectionMatchesSource,
  writeTemplateDocument,
} from "./storefront-theme.dal";

/**
 * "Show again" (M3 stage 1) for a Theme template or the shared layout (a
 * template of type `layout`): one hidden section of its draft back to
 * shown, and nothing else (`showSectionAgainInDocument`).
 *
 * The write is every template write's own, `writeTemplateDocument`: the
 * compare-and-set over the draft generation, the draft revision and the
 * Theme's source generation inside one batch, an unreferenced draft updated
 * in place and anything else branched into a new revision, the generation
 * bumped. The ownership join (storefront → Theme → template, none deleted)
 * is the one that guard repeats.
 *
 * Unlike every other section write it asks the source no question about
 * *showing* (`designWritesUnavailableReason`, the Astro field proof, the
 * hide classifier): shown is the state every renderer draws without asking
 * the Document, and requiring such a proof would refuse exactly the Themes
 * whose hidden sections block a publish. This is why an Astro Theme, whose
 * general field write refuses `enabled` (`updateSectionProps`), takes this
 * one visibility change. It does ask the one question showing raises: that
 * the stored props were written for the component rendering the slot now
 * (`assertShownSectionMatchesSource`), since showing hands them to it.
 *
 * Never publishes and touches no release. Null when the template is not
 * that Theme's, or the Theme not that storefront's, or any is deleted.
 */
export async function showTemplateSectionAgain(data: {
  storefrontId: string;
  themeId: string;
  templateId: string;
  sectionId: string;
  expectedDraftGeneration: number;
  createdBy: string;
}): Promise<
  | null
  | Readonly<{ kind: "section-not-found"; reason: "missing" | "ambiguous" }>
  | Readonly<{
      kind: "document-refused";
      code: Extract<ShowSectionAgainOutcome, { kind: "refused" }>["code"];
    }>
  | Readonly<{
      kind: "unchanged" | "shown";
      draftGeneration: number;
      draftRevisionId: string | null;
    }>
> {
  const template = await env.DATABASE.prepare(
    `SELECT t.type AS type,
            t.route_path AS routePath,
            t.draft_revision_id AS draftRevisionId,
            t.published_revision_id AS publishedRevisionId,
            t.draft_generation AS draftGeneration,
            th.source_generation AS sourceGeneration,
            th.framework AS framework,
            COALESCE(r.document, t.document) AS document
       FROM storefront_theme_templates t
       INNER JOIN storefront_themes th ON th.id = t.theme_id
       INNER JOIN storefronts s ON s.id = th.storefront_id
       LEFT JOIN storefront_theme_template_revisions r
         ON r.id = t.draft_revision_id AND r.template_id = t.id
      WHERE s.id = ?1 AND th.id = ?2 AND t.id = ?3
        AND s.deleted_at IS NULL AND th.deleted_at IS NULL
        AND t.deleted_at IS NULL
      LIMIT 1`,
  )
    .bind(data.storefrontId, data.themeId, data.templateId)
    .first<{
      type: string;
      routePath: string | null;
      draftRevisionId: string | null;
      publishedRevisionId: string | null;
      draftGeneration: number;
      sourceGeneration: number;
      framework: string | null;
      document: string;
    }>();
  if (!template) return null;

  // The draft the editor reads (`findEditorContext`): the draft revision's
  // document, or the row's own when it has none.
  const outcome = showSectionAgainInDocument(template.document, data.sectionId);
  if (outcome.kind === "refused") {
    return { kind: "document-refused", code: outcome.code };
  }
  if (outcome.kind === "not-found") {
    return { kind: "section-not-found", reason: outcome.reason };
  }
  if (outcome.kind === "already-shown") {
    return {
      kind: "unchanged",
      draftGeneration: template.draftGeneration,
      draftRevisionId: template.draftRevisionId,
    };
  }
  if (template.draftGeneration !== data.expectedDraftGeneration) {
    throw new Error(
      `${TEMPLATE_DRAFT_GENERATION_MISMATCH}: Template was modified concurrently.`,
    );
  }
  await assertShownSectionMatchesSource({
    storefrontId: data.storefrontId,
    themeId: data.themeId,
    framework: template.framework,
    templateType: template.type,
    templateRoutePath: template.routePath,
    sectionId: data.sectionId,
    storedComponentRef: outcome.section.componentRef,
  });

  // The source generation read with the draft: the write's guard repeats
  // it, so a source saved since the comparison above refuses the write.
  const written = await writeTemplateDocument({
    storefrontId: data.storefrontId,
    themeId: data.themeId,
    templateId: data.templateId,
    document: outcome.document,
    sourceGeneration: template.sourceGeneration,
    draftRevisionId: template.draftRevisionId,
    publishedRevisionId: template.publishedRevisionId,
    expectedDraftGeneration: data.expectedDraftGeneration,
    createdBy: data.createdBy,
  });
  return {
    kind: "shown",
    draftGeneration: written.draftGeneration,
    draftRevisionId: written.draftRevisionId,
  };
}
