import type { HideRefusalReason } from "@/lib/storefront/ast/theme-hide-capability";

/**
 * The structured half of a publish refused for hidden sections (M3 stage 1,
 * `PUBLISH_HIDDEN_SECTION_UNSUPPORTED`), carried as `ServerFailure.details`
 * beside the unchanged `message` and `error`, so the editor can name each
 * document and section and offer "Show again" on exactly that draft.
 *
 * Names documents and sections only: no section content travels here.
 */
export type PublishHiddenSectionDetail = Readonly<{
  itemType: "template" | "page";
  /** The template id, or the CMS Page id. */
  contentId: string;
  /** The template type the publication sealed it under; `"page"` for a CMS Page. */
  templateType: string;
  sectionId: string;
  reason: HideRefusalReason;
  /**
   * Which way out applies: a CMS Page on Start, a Theme that is not Start,
   * a Start section no route is found to render, or the Start source check.
   */
  refusedAs: "page" | "framework" | "unlisted" | "source";
  /**
   * What must be published after the section is shown again: the CMS Page
   * first (a Theme publish carries its published revision, not its draft),
   * or only the Theme.
   */
  mustPublish: "page" | "theme";
  /** How the author knows the document, as the message names it. */
  label: string;
}>;

export type PublishHiddenSectionsDetails = Readonly<{
  kind: "publish-hidden-sections";
  /** At most `PUBLISH_HIDDEN_SECTIONS_DETAIL_LIMIT` problems. */
  problems: readonly PublishHiddenSectionDetail[];
  /** True when there were more problems than the list carries. */
  truncated: boolean;
}>;

/** The bound on `problems`, so one refusal cannot grow without limit. */
export const PUBLISH_HIDDEN_SECTIONS_DETAIL_LIMIT = 50;
