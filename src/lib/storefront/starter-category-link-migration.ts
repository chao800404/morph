import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  assertThemeContentFieldValue,
  arrayRowFields,
  isArrayContentField,
  type ThemeContentFieldDefinition,
} from "./theme-content-capabilities";

/**
 * The Starter's category cards, moved from `href` to `link`.
 *
 * Every Starter through v30 seeded the home's category cards with a bare
 * `href` on each row, the shape the card grid read before links were unified.
 * Since then the Starter's `CategoryShowcase` declares and renders only
 * `link`, so a stored `href` is neither shown nor editable: the card renders
 * with no destination at all. The upgrade's file plan moved the component;
 * nothing moved the content, which is what this does.
 *
 * Only a Starter section is touched, and only a row in the old shape:
 *
 * - the section is the Starter's category grid (`category-showcase`), on a
 *   Theme whose recorded Starter version is one Morph shipped (checked by the
 *   caller, which runs this only inside an applied upgrade);
 * - the component that now renders it declares `items[].link` as a link field
 *   and no `items[].href`, judged from the upgraded source, so a grid the
 *   author kept on its own `href` is left alone;
 * - the row holds an `href` string and no `link`. That `href` becomes
 *   `link: { href }`, in the place `href` held, validated exactly as an edit to
 *   that field would be. A `link` already there is never overwritten.
 *
 * Every other row is left byte for byte and reported with why. Row ids and row
 * order are never touched, so a migrated row keeps its identity: the caller
 * runs this on a document whose rows already carry the ids the editor showed.
 *
 * Idempotent: a migrated row has no `href`, so a second run changes nothing.
 */

export const STARTER_CATEGORY_SECTION_TYPE = "category-showcase";
export const STARTER_CATEGORY_LIST_FIELD = "items";

export type StarterCategoryLinkKeptReason =
  /** The row already holds a `link`; it is never overwritten. */
  | "link-present"
  /** `href` is not an address the link field would accept. */
  | "href-not-a-link"
  /** The component rendering the section still reads `href`, or no `link`. */
  | "component-reads-href"
  /** The source does not say which component renders the section. */
  | "component-unconfirmed";

export type StarterCategoryLinkKept = {
  templateId: string;
  sectionId: string;
  field: string;
  /** The row's position, or null when the whole section was kept. */
  row: number | null;
  reason: StarterCategoryLinkKeptReason;
};

export type StarterCategoryLinkMigrated = {
  templateId: string;
  sectionId: string;
  field: string;
  /** How many rows had their `href` moved into `link`. */
  rows: number;
};

/** What an applied Starter upgrade moves in the Theme's content, for its review. */
export type StarterContentMigrationPreview = {
  sections: Array<StarterCategoryLinkMigrated & { templateName: string }>;
  kept: StarterCategoryLinkKept[];
};

export type StarterCategoryLinkMigrationResult = {
  changed: boolean;
  document: StorefrontPageDocument;
  migrated: StarterCategoryLinkMigrated[];
  kept: StarterCategoryLinkKept[];
};

/**
 * What the section's rendering component declares, as the caller resolved it
 * from the upgraded source: the list field's definition, or `null` when the
 * source did not confirm the component.
 */
export type CategoryListDefinitionFor = (
  section: StorefrontPageDocument["sections"][number],
) => ThemeContentFieldDefinition | null | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a row still carries the old destination. */
function rowNeedsMigration(row: unknown): boolean {
  return (
    isPlainObject(row) && Object.prototype.hasOwnProperty.call(row, "href")
  );
}

/** `href` replaced by `link` in the position it held; every other key kept. */
function withLinkInPlace(
  row: Record<string, unknown>,
  href: string,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "href") next.link = { href };
    else next[key] = value;
  }
  return next;
}

export function migrateStarterCategoryLinks(
  document: StorefrontPageDocument,
  templateId: string,
  listDefinitionFor: CategoryListDefinitionFor,
): StarterCategoryLinkMigrationResult {
  const migrated: StarterCategoryLinkMigrated[] = [];
  const kept: StarterCategoryLinkKept[] = [];
  const field = STARTER_CATEGORY_LIST_FIELD;
  let changed = false;

  const sections = document.sections.map((section) => {
    if (section.type !== STARTER_CATEGORY_SECTION_TYPE) return section;
    const rows = section.props?.[field];
    if (!Array.isArray(rows) || !rows.some(rowNeedsMigration)) return section;

    const definition = listDefinitionFor(section);
    if (definition === null || definition === undefined) {
      kept.push({
        templateId,
        sectionId: section.id,
        field,
        row: null,
        reason: "component-unconfirmed",
      });
      return section;
    }
    const rowFields = isArrayContentField(definition)
      ? arrayRowFields(definition)
      : null;
    const linkField = rowFields?.link;
    if (!rowFields || linkField?.type !== "link" || rowFields.href) {
      kept.push({
        templateId,
        sectionId: section.id,
        field,
        row: null,
        reason: "component-reads-href",
      });
      return section;
    }

    let moved = 0;
    const nextRows = rows.map((row, index) => {
      if (!rowNeedsMigration(row)) return row;
      const record = row as Record<string, unknown>;
      const keep = (reason: StarterCategoryLinkKeptReason) => {
        kept.push({
          templateId,
          sectionId: section.id,
          field,
          row: index,
          reason,
        });
        return row;
      };
      if (Object.prototype.hasOwnProperty.call(record, "link")) {
        return keep("link-present");
      }
      const href = record.href;
      if (typeof href !== "string") return keep("href-not-a-link");
      const link = { href };
      try {
        assertThemeContentFieldValue(`${field}.${index}.link`, linkField, link);
      } catch {
        return keep("href-not-a-link");
      }
      moved += 1;
      return withLinkInPlace(record, href);
    });
    if (moved === 0) return section;
    changed = true;
    migrated.push({ templateId, sectionId: section.id, field, rows: moved });
    return {
      ...section,
      props: { ...section.props, [field]: nextRows },
    } as StorefrontPageDocument["sections"][number];
  });

  return {
    changed,
    document: changed ? { ...document, sections } : document,
    migrated,
    kept,
  };
}
