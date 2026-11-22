import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  assertThemeContentFieldValue,
  arrayRowFields,
  isArrayContentField,
  type ThemeContentFieldDefinition,
} from "./theme-content-capabilities";

/**
 * Starter destinations, moved from the shape they were seeded in to the one
 * the upgraded Starter reads.
 *
 * Links were unified in the Starter's components, not in the content those
 * components had been given. Every Starter through v30 seeded
 *
 * - the category cards (`category-showcase`) with a bare `href` on each row,
 *   where `CategoryShowcase` now declares and renders only `items[].link`;
 * - the hero and the image-with-text section with a top-level `actionHref`
 *   (beside `actionTarget`, which their old Inspector could write), where
 *   `Hero` and `ImageWithText` now declare and render only `action`.
 *
 * A stored old destination is neither shown nor editable: the card or button
 * renders with the component's own default, or with none. The upgrade's file
 * plan moved the components; this moves the content.
 *
 * Only a Starter section is touched, and only a value in the old shape:
 *
 * - the section is one of the Starter's types above, on a Theme whose recorded
 *   Starter version is one Morph shipped (checked by the caller, which runs
 *   this only inside an applied upgrade);
 * - the component that now renders it declares the new field as a link and
 *   none of the old ones, judged from the upgraded source, so a section whose
 *   component still reads the old shape is left alone;
 * - the old value is there and the new one is not. It becomes `{ href }` (with
 *   `target` when `actionTarget` was set), in the place the old key held,
 *   validated exactly as an edit to that field would be. A new value already
 *   there is never overwritten. `rel` is not written: Morph derives it from
 *   the target before a value reaches a component.
 *
 * Every other value is left byte for byte and reported with why. Row ids and
 * row order are never touched, so a migrated row keeps its identity: the
 * caller runs this on a document whose rows already carry the ids the editor
 * showed. The label (`actionLabel`) is its own declared field and stays.
 *
 * Idempotent: a migrated value has no old key, so a second run changes nothing.
 */

export const STARTER_CATEGORY_SECTION_TYPE = "category-showcase";
export const STARTER_CATEGORY_LIST_FIELD = "items";
/** Sections whose Starter component moved `actionHref` into `action`. */
export const STARTER_ACTION_SECTION_TYPES = ["hero", "image-with-text"];
export const STARTER_ACTION_FIELD = "action";

export type StarterCategoryLinkKeptReason =
  /** The new link field already holds a value; it is never overwritten. */
  | "link-present"
  /** The old value is not one the link field would accept. */
  | "href-not-a-link"
  /** The component rendering the section still reads the old shape. */
  | "component-reads-href"
  /** The source does not say which component renders the section. */
  | "component-unconfirmed";

export type StarterCategoryLinkKept = {
  templateId: string;
  sectionId: string;
  field: string;
  /** The row's position, or null for the section's own prop or whole list. */
  row: number | null;
  reason: StarterCategoryLinkKeptReason;
};

export type StarterCategoryLinkMigrated = {
  templateId: string;
  sectionId: string;
  /** The field the destination now lives in. */
  field: string;
  /** How many rows were moved; null when the field is the section's own. */
  rows: number | null;
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
 * The fields the section's rendering component declares, as the caller
 * resolved them from the upgraded source, or `null` when the source did not
 * confirm the component.
 */
export type SectionFieldsFor = (
  section: StorefrontPageDocument["sections"][number],
) => Readonly<Record<string, ThemeContentFieldDefinition>> | null | undefined;

type Section = StorefrontPageDocument["sections"][number];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const has = (record: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

/**
 * `record` with `oldKeys` removed and `value` under `newKey`, in the place the
 * first old key held; every other key kept in order.
 */
function replaceInPlace(
  record: Record<string, unknown>,
  oldKeys: readonly string[],
  newKey: string,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, existing] of Object.entries(record)) {
    if (key === oldKeys[0]) next[newKey] = value;
    else if (!oldKeys.includes(key)) next[key] = existing;
  }
  return next;
}

/** Whether `value` passes the field's own validator. */
function validLink(
  fieldPath: string,
  definition: ThemeContentFieldDefinition,
  value: unknown,
): boolean {
  try {
    assertThemeContentFieldValue(fieldPath, definition, value);
    return true;
  } catch {
    return false;
  }
}

type SectionStep = {
  section: Section;
  migrated: StarterCategoryLinkMigrated[];
  kept: StarterCategoryLinkKept[];
};

function migrateCategoryRows(
  section: Section,
  templateId: string,
  fieldsFor: SectionFieldsFor,
): SectionStep {
  const field = STARTER_CATEGORY_LIST_FIELD;
  const none: SectionStep = { section, migrated: [], kept: [] };
  const rows = section.props?.[field];
  const needs = (row: unknown) => isPlainObject(row) && has(row, "href");
  if (!Array.isArray(rows) || !rows.some(needs)) return none;
  const kept: StarterCategoryLinkKept[] = [];
  const keepAll = (reason: StarterCategoryLinkKeptReason): SectionStep => ({
    section,
    migrated: [],
    kept: [{ templateId, sectionId: section.id, field, row: null, reason }],
  });

  const fields = fieldsFor(section);
  if (!fields) return keepAll("component-unconfirmed");
  const definition = fields[field];
  const rowFields = isArrayContentField(definition)
    ? arrayRowFields(definition)
    : null;
  const linkField = rowFields?.link;
  if (!rowFields || linkField?.type !== "link" || rowFields.href) {
    return keepAll("component-reads-href");
  }

  let moved = 0;
  const nextRows = rows.map((row, index) => {
    if (!needs(row)) return row;
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
    if (has(record, "link")) return keep("link-present");
    if (typeof record.href !== "string") return keep("href-not-a-link");
    const link = { href: record.href };
    if (!validLink(`${field}.${index}.link`, linkField, link)) {
      return keep("href-not-a-link");
    }
    moved += 1;
    return replaceInPlace(record, ["href"], "link", link);
  });
  if (moved === 0) return { section, migrated: [], kept };
  return {
    section: {
      ...section,
      props: { ...section.props, [field]: nextRows },
    } as Section,
    migrated: [{ templateId, sectionId: section.id, field, rows: moved }],
    kept,
  };
}

function migrateSectionAction(
  section: Section,
  templateId: string,
  fieldsFor: SectionFieldsFor,
): SectionStep {
  const field = STARTER_ACTION_FIELD;
  const none: SectionStep = { section, migrated: [], kept: [] };
  const props = section.props as Record<string, unknown> | undefined;
  if (!props || !has(props, "actionHref")) return none;
  const keep = (reason: StarterCategoryLinkKeptReason): SectionStep => ({
    section,
    migrated: [],
    kept: [{ templateId, sectionId: section.id, field, row: null, reason }],
  });

  const fields = fieldsFor(section);
  if (!fields) return keep("component-unconfirmed");
  const linkField = fields[field];
  if (linkField?.type !== "link" || fields.actionHref || fields.actionTarget) {
    return keep("component-reads-href");
  }
  if (has(props, field)) return keep("link-present");
  if (typeof props.actionHref !== "string") return keep("href-not-a-link");
  const link: Record<string, unknown> = { href: props.actionHref };
  if (has(props, "actionTarget")) link.target = props.actionTarget;
  if (!validLink(field, linkField, link)) return keep("href-not-a-link");
  return {
    section: {
      ...section,
      props: replaceInPlace(props, ["actionHref", "actionTarget"], field, link),
    } as Section,
    migrated: [{ templateId, sectionId: section.id, field, rows: null }],
    kept: [],
  };
}

/** Every Starter destination migration over one template Document. */
export function migrateStarterDocumentLinks(
  document: StorefrontPageDocument,
  templateId: string,
  fieldsFor: SectionFieldsFor,
): StarterCategoryLinkMigrationResult {
  const migrated: StarterCategoryLinkMigrated[] = [];
  const kept: StarterCategoryLinkKept[] = [];
  let changed = false;
  const sections = document.sections.map((section) => {
    const step =
      section.type === STARTER_CATEGORY_SECTION_TYPE
        ? migrateCategoryRows(section, templateId, fieldsFor)
        : STARTER_ACTION_SECTION_TYPES.includes(section.type)
          ? migrateSectionAction(section, templateId, fieldsFor)
          : null;
    if (!step) return section;
    migrated.push(...step.migrated);
    kept.push(...step.kept);
    if (step.section !== section) changed = true;
    return step.section;
  });
  return {
    changed,
    document: changed ? { ...document, sections } : document,
    migrated,
    kept,
  };
}
