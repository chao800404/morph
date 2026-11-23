/**
 * What one Inspector write (or its restore) may change in the stored
 * Documents, compared in full.
 *
 * The editor reads every Document with its rows given ids
 * (`normalizeDocumentRowIds` in `storefrontThemeDal.findEditorContext`), in
 * memory only; the first real edit to a Document persists that read. So a
 * Document whose rows were stored without an `id` (1b v20 rolled back: the
 * layout's navItems / exploreItems / helpItems) gains those ids with the
 * first edit, alongside the edited value.
 *
 * Allowed differences from the Document as D1 held it before the write
 * (user decision 2026-11-23, narrow):
 *   (a) the edited leaf, holding the written value;
 *   (b) a row that had no `id` key, in the Document the write went to, now
 *       holding exactly the id the editor's read immediately before the write
 *       showed for that row: same section, same array, same index, and the
 *       read's row otherwise equal to the stored row.
 * Anything else fails: an existing id changed, an id on a different row or
 * on something that is not a row, rows reordered, added or removed, a link
 * or any other leaf changed, a section-level key changed. After the restore
 * the Document must be the pre-write one plus exactly the ids the write
 * filled.
 */

/** A template's Document as D1 holds it, or as the editor read it. */
export type StoredDocument = {
  templateId: string;
  sections: Array<{ id: string; props?: Record<string, unknown> | null }>;
};

/** A row id the write stored that the Document did not hold before. */
export type FilledRowId = {
  /** `template/section/<row path>.id`, the leaf the id is stored at. */
  key: string;
  templateId: string;
  sectionId: string;
  /** The row's path in the section's props, e.g. `navItems.0`. */
  path: string;
  id: string;
};

/**
 * One section's componentRef as a fixed, hand-checked expectation: the
 * legacy registry ref the Document stores and the route-derived source path
 * the first write may store instead.
 */
export type ComponentRefRewrite = {
  sectionId: string;
  from: string;
  to: string;
};

/** A componentRef the write changed, as allowed by a ComponentRefRewrite. */
export type RewrittenComponentRef = ComponentRefRewrite & {
  /** `template/section/componentRef`. */
  key: string;
  templateId: string;
};

export type WriteComparison = {
  problems: string[];
  filledRowIds: FilledRowId[];
  componentRefRewrites: RewrittenComponentRef[];
};

export type StoredWriteInput = {
  /** D1, read before the write. */
  before: StoredDocument[];
  /** The editor's read of the Documents immediately before the write. */
  normalizedRead: StoredDocument[];
  /** D1, read now. */
  after: StoredDocument[];
  /** The Document the write goes to. */
  templateId: string;
  /** The edited leaf and its written value; null for the restore. */
  edit: { sectionId: string; location: string; value: unknown } | null;
  /** The restore: exactly the ids the write filled must still be there. */
  expectedFills?: FilledRowId[];
  /**
   * The fixed expectation for the edited section's componentRef, when it has
   * one; for the write it must name the edited section.
   */
  componentRefRewrite?: ComponentRefRewrite | null;
  /** The restore: exactly the componentRef rewrites the write made. */
  expectedRewrites?: RewrittenComponentRef[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const has = (object: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

function valueAt(root: unknown, parts: readonly string[]): unknown {
  let value = root;
  for (const part of parts) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const show = (value: unknown) =>
  value === undefined ? "nothing" : JSON.stringify(value).slice(0, 120);

/**
 * `read` is `stored` with ids the editor's repair added: equal, except that a
 * row (an object in an array) the store holds without an `id` key may carry
 * one in the read.
 */
function equalButRepairedIds(stored: unknown, read: unknown, row: boolean): boolean {
  if (Array.isArray(stored) || Array.isArray(read)) {
    return (
      Array.isArray(stored) &&
      Array.isArray(read) &&
      stored.length === read.length &&
      stored.every((item, index) => equalButRepairedIds(item, read[index], true))
    );
  }
  if (isPlainObject(stored) && isPlainObject(read)) {
    const storedKeys = Object.keys(stored).sort();
    const readKeys = Object.keys(read)
      .filter((key) => !(row && key === "id" && !has(stored, "id")))
      .sort();
    return (
      JSON.stringify(storedKeys) === JSON.stringify(readKeys) &&
      storedKeys.every((key) => equalButRepairedIds(stored[key], read[key], false))
    );
  }
  return Object.is(stored, read);
}

export function compareStoredWrite(input: StoredWriteInput): WriteComparison {
  const problems: string[] = [];
  const filledRowIds: FilledRowId[] = [];
  const expected = JSON.parse(JSON.stringify(input.before)) as StoredDocument[];

  if (input.edit) {
    const { sectionId, location, value } = input.edit;
    const props = expected
      .find((doc) => doc.templateId === input.templateId)
      ?.sections.find((section) => section.id === sectionId)?.props;
    const parts = location.split(".");
    const parent = valueAt(props, parts.slice(0, -1));
    const last = parts[parts.length - 1]!;
    if (
      (!isPlainObject(parent) && !Array.isArray(parent)) ||
      !has(parent as Record<string, unknown>, last)
    ) {
      problems.push(
        `${input.templateId}/${sectionId}/${location}: no stored value there before the write`,
      );
    } else {
      (parent as Record<string, unknown>)[last] = value;
    }
  }

  const sectionOf = (docs: StoredDocument[], templateId: string, sectionId: string) =>
    docs
      .find((doc) => doc.templateId === templateId)
      ?.sections.find((section) => section.id === sectionId);

  const checkFill = (
    templateId: string,
    sectionId: string,
    path: string[],
    id: unknown,
  ) => {
    const rowPath = path.slice(1).join(".");
    const where = `${templateId}/${sectionId}/${rowPath}`;
    if (path[0] !== "props") {
      problems.push(`${where}: id ${show(id)} added outside the section's props`);
      return;
    }
    if (templateId !== input.templateId) {
      problems.push(
        `${where}: id ${show(id)} added in a Document the write did not go to`,
      );
      return;
    }
    const storedRow = valueAt(
      sectionOf(input.before, templateId, sectionId)?.props,
      path.slice(1),
    );
    const readRow = valueAt(
      sectionOf(input.normalizedRead, templateId, sectionId)?.props,
      path.slice(1),
    );
    if (!isPlainObject(storedRow) || has(storedRow, "id")) {
      problems.push(`${where}: id ${show(id)} added to a row that was not stored without one`);
      return;
    }
    if (!isPlainObject(readRow) || typeof readRow.id !== "string") {
      problems.push(`${where}: id ${show(id)} added, the editor read showed no id for this row`);
      return;
    }
    if (!equalButRepairedIds(storedRow, readRow, true)) {
      problems.push(
        `${where}: the editor read's row ${show(readRow)} is not the stored row ${show(storedRow)}`,
      );
      return;
    }
    if (id !== readRow.id) {
      problems.push(
        `${where}: id ${show(id)} stored, the editor read showed ${show(readRow.id)}`,
      );
      return;
    }
    filledRowIds.push({
      key: `${where}.id`,
      templateId,
      sectionId,
      path: rowPath,
      id: readRow.id,
    });
  };

  const walk = (
    templateId: string,
    sectionId: string,
    want: unknown,
    got: unknown,
    path: string[],
    row: boolean,
  ) => {
    const where = `${templateId}/${sectionId}/${path.join(".")}`;
    if (Array.isArray(want) || Array.isArray(got)) {
      if (!Array.isArray(want) || !Array.isArray(got)) {
        problems.push(`${where}: ${show(want)} -> ${show(got)}`);
        return;
      }
      if (want.length !== got.length) {
        problems.push(`${where}: ${want.length} rows expected, ${got.length} stored`);
        return;
      }
      want.forEach((item, index) =>
        walk(templateId, sectionId, item, got[index], [...path, String(index)], true),
      );
      return;
    }
    if (isPlainObject(want) && isPlainObject(got)) {
      const keys = [...new Set([...Object.keys(want), ...Object.keys(got)])].sort();
      for (const key of keys) {
        if (row && key === "id" && !has(want, "id") && has(got, "id")) {
          checkFill(templateId, sectionId, path, got.id);
          continue;
        }
        if (!has(want, key) || !has(got, key)) {
          problems.push(
            `${where}.${key}: ${show(want[key])} -> ${has(got, key) ? show(got[key]) : "removed"}`,
          );
          continue;
        }
        walk(templateId, sectionId, want[key], got[key], [...path, key], false);
      }
      return;
    }
    if (!Object.is(want, got)) {
      problems.push(`${where}: ${show(want)} -> ${show(got)}`);
    }
  };

  const ids = (docs: StoredDocument[]) => docs.map((doc) => doc.templateId).sort();
  if (JSON.stringify(ids(expected)) !== JSON.stringify(ids(input.after))) {
    problems.push(
      `templates ${JSON.stringify(ids(expected))} -> ${JSON.stringify(ids(input.after))}`,
    );
  }
  for (const want of expected) {
    const got = input.after.find((doc) => doc.templateId === want.templateId);
    if (!got) continue;
    const wantIds = want.sections.map((section) => section.id);
    const gotIds = got.sections.map((section) => section.id);
    if (JSON.stringify(wantIds) !== JSON.stringify(gotIds)) {
      problems.push(
        `${want.templateId}: sections ${JSON.stringify(wantIds)} -> ${JSON.stringify(gotIds)}`,
      );
      continue;
    }
    want.sections.forEach((section, index) =>
      walk(want.templateId, section.id, section, got.sections[index], [], false),
    );
  }

  filledRowIds.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (input.expectedFills) {
    const pairs = (fills: FilledRowId[]) =>
      JSON.stringify(fills.map((fill) => [fill.key, fill.id]).sort());
    if (pairs(filledRowIds) !== pairs(input.expectedFills)) {
      problems.push(
        `filled row ids ${pairs(input.expectedFills)} after the write, ${pairs(filledRowIds)} now`,
      );
    }
  }
  return { problems, filledRowIds, componentRefRewrites: [] };
}
