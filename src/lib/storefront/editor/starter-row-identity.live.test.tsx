/**
 * Every repeated row the Starter Theme shows on the canvas can be confirmed
 * by an id.
 *
 * The Inspector refuses to write to a row it cannot confirm by its id (no id,
 * a shared id, or one no longer present). That rule must not take away
 * editing the Starter already had: a Store begins with these rows, and a row
 * the canvas shows without an id would become uneditable from the canvas.
 *
 * Rendered with real React after the Live Preview's source pass, in the two
 * states a Store is in: content stored and read the way the editor reads it
 * (`normalizeDocumentRowIds`, as `findEditorContext` applies), and nothing
 * stored at all, where the canvas shows the components' own defaults.
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
} from "@/lib/storefront/default-storefront-document";
import { resolveSelectable } from "@/lib/storefront/editor/preview-dom";
import { normalizeDocumentRowIds } from "@/lib/storefront/editor/normalize-row-ids";
import { STARTER_THEME_FILES } from "@/lib/storefront/starter-theme-files";
import {
  mountLivePreview,
  renderLivePreviewRoute,
  type LivePreviewDocuments,
} from "@/lib/test-utils/live-preview-render";

beforeAll(() => {
  // Every browser this runs in has CSS.escape; this jsdom does not.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as { CSS?: unknown }).CSS = {
      escape: (value: string) => value.replace(/([^\w-])/g, "\\$1"),
    };
  }
});

const ROW_FIELD_PATH = /^[^.]+\.\d+(\..+)?$/;

/** Row paths on the canvas whose selection would carry no confirmable id. */
async function rowsWithoutId(documents: LivePreviewDocuments) {
  const { html } = await renderLivePreviewRoute({
    files: STARTER_THEME_FILES.map((file) => ({
      path: file.path,
      content: file.content,
    })),
    documents,
  });
  const root = mountLivePreview(html);
  const rows = [
    ...root.querySelectorAll<HTMLElement>("[data-storefront-field-path]"),
  ].filter((element) =>
    ROW_FIELD_PATH.test(element.dataset.storefrontFieldPath ?? ""),
  );
  // Guards the check itself: a Starter with no rows on the canvas would pass
  // it without having checked anything.
  expect(rows.length).toBeGreaterThan(0);
  return rows
    .filter((element) => !resolveSelectable(element)?.itemId)
    .map((element) => {
      const section = element.closest<HTMLElement>(
        "[data-storefront-section-id]",
      )?.dataset.storefrontSectionId;
      return `${section}:${element.dataset.storefrontFieldPath}`;
    });
}

describe("the Starter's repeated rows on the canvas", () => {
  it("all carry an id when their content is stored", async () => {
    expect(
      await rowsWithoutId({
        index: normalizeDocumentRowIds(
          createDefaultStorefrontHomeDocument(),
          "home-template",
        ).value,
        layout: normalizeDocumentRowIds(
          createDefaultStorefrontLayoutDocument(),
          "layout-template",
        ).value,
      }),
    ).toEqual([]);
  });

  it("all carry an id when nothing is stored and the defaults show", async () => {
    expect(await rowsWithoutId({})).toEqual([]);
  });
});
