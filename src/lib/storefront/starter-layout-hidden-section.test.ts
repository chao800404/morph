/**
 * Hiding a layout section (Header, Footer) hides it in real React.
 *
 * The editor offers "Hide section" on the layout's rows too. Hiding one drops
 * its stored values and lists it in `hiddenSlots`; a layout that renders the
 * slot without asking `isSectionHidden` then shows it anyway, with the
 * component's own defaults in place of what the author wrote. That is what a
 * reload in Live Preview and the published site both did, while the bridge's
 * live toggle made the editor look right until the next load.
 *
 * Rendered through the product's own preview transform, real React, a real
 * router and the Starter's own `src/morph/content.ts`, answered from draft
 * Documents by the preview's own content resolver.
 */
import { describe, expect, it } from "vitest";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import { renderLivePreviewRoute } from "@/lib/test-utils/live-preview-render";
import { deriveThemeLayoutSections } from "./compiler/theme-route-sections";
import {
  createDefaultStorefrontHomeDocument,
  createDefaultStorefrontLayoutDocument,
  STOREFRONT_LAYOUT_FOOTER_SLOT_ID,
  STOREFRONT_LAYOUT_HEADER_SLOT_ID,
} from "./default-storefront-document";
import {
  createStarterThemeWorkspaceUpgradePlan,
  starterThemeWorkspaceFiles,
} from "./starter-theme-files";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE,
  LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
  STARTER_THEME_LAYOUT_SOURCE,
} from "./starter-theme-v3-files";

const LAYOUT = "src/layouts/StorefrontLayout.tsx";
const CONTENT = "src/morph/content.ts";

// Neither is any component's default, so seeing one proves the Document's
// value reached the component, and not seeing it proves nothing rendered it.
const AUTHORED_STORE_NAME = "Authored Header Store";
const AUTHORED_COPYRIGHT = "© Authored Footer";

type File = { id: string; path: string; content: string; version: number };

const workspace = (
  edit: (files: File[]) => File[] = (files) => files,
): File[] =>
  edit(
    starterThemeWorkspaceFiles().map((file, index) => ({
      id: `file-${index}`,
      path: file.path,
      content: file.content,
      version: 1,
    })),
  );
const setContent = (path: string, content: string) => (files: File[]) =>
  files.map((file) => (file.path === path ? { ...file, content } : file));
const without = (path: string) => (files: File[]) =>
  files.filter((file) => file.path !== path);
const compose =
  (...edits: Array<(files: File[]) => File[]>) =>
  (files: File[]) =>
    edits.reduce((current, edit) => edit(current), files);

function layoutDocument(hidden: readonly string[]): StorefrontPageDocument {
  const document = createDefaultStorefrontLayoutDocument();
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      enabled: !hidden.includes(section.id),
      props:
        section.id === STOREFRONT_LAYOUT_HEADER_SLOT_ID
          ? { ...section.props, storeName: AUTHORED_STORE_NAME }
          : { ...section.props, copyrightText: AUTHORED_COPYRIGHT },
    })),
  };
}

async function renderHome(
  hidden: readonly string[],
  files: readonly File[] = workspace(),
) {
  const { html } = await renderLivePreviewRoute({
    files: files.map((file) => ({ path: file.path, content: file.content })),
    documents: {
      index: createDefaultStorefrontHomeDocument(),
      layout: layoutDocument(hidden),
    },
  });
  return html;
}

describe("a hidden layout section in real React", () => {
  it("renders both with the author's values when neither is hidden", async () => {
    const html = await renderHome([]);
    expect(html).toContain('data-storefront-section-id="starter-header"');
    expect(html).toContain(AUTHORED_STORE_NAME);
    expect(html).toContain("Cart (0)");
    expect(html).toContain('data-storefront-section-id="starter-footer"');
    expect(html).toContain(AUTHORED_COPYRIGHT);
  });

  it("does not render a hidden Header at all, defaults included", async () => {
    const html = await renderHome([STOREFRONT_LAYOUT_HEADER_SLOT_ID]);
    expect(html).not.toContain('data-storefront-section-id="starter-header"');
    expect(html).not.toContain("<header");
    expect(html).not.toContain("Cart (0)");
    expect(html).not.toContain(AUTHORED_STORE_NAME);
    // The page and the Footer are untouched.
    expect(html).toContain('data-storefront-section-id="starter-hero"');
    expect(html).toContain(AUTHORED_COPYRIGHT);
  });

  it("does not render a hidden Footer at all, defaults included", async () => {
    const html = await renderHome([STOREFRONT_LAYOUT_FOOTER_SLOT_ID]);
    expect(html).not.toContain('data-storefront-section-id="starter-footer"');
    expect(html).not.toContain("<footer");
    expect(html).not.toContain("© Online Store");
    expect(html).not.toContain(AUTHORED_COPYRIGHT);
    expect(html).toContain(AUTHORED_STORE_NAME);
  });

  it("the always-visible layout is the bug: a hidden Header renders with its defaults", async () => {
    // Reverse check. If this stops failing the way it does, the tests above
    // no longer prove the guard is what hides the Header.
    const html = await renderHome(
      [STOREFRONT_LAYOUT_HEADER_SLOT_ID],
      workspace(
        setContent(LAYOUT, LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE),
      ),
    );
    expect(html).toContain("Cart (0)");
    expect(html).toContain("Online Store");
    expect(html).not.toContain(AUTHORED_STORE_NAME);
  });
});

describe("the editor still reads the guarded layout's slots", () => {
  it("derives both slots, in place around the page", () => {
    const result = deriveThemeLayoutSections(workspace());
    expect(result.diagnostics).toEqual([]);
    expect(
      result.sections.map((section) => [
        section.slotId,
        section.layoutPlacement,
      ]),
    ).toEqual([
      [STOREFRONT_LAYOUT_HEADER_SLOT_ID, "before-page"],
      [STOREFRONT_LAYOUT_FOOTER_SLOT_ID, "after-page"],
    ]);
  });
});

describe("the Starter upgrade to the guarded layout", () => {
  const plan = (files: File[]) => createStarterThemeWorkspaceUpgradePlan(files);
  const plannedLayout = (files: File[]) =>
    plan(files).files.find((file) => file.path === LAYOUT);

  it("replaces an untouched always-visible layout, guarded by its id and version", () => {
    const files = workspace(
      setContent(LAYOUT, LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE),
    );
    const layout = files.find((file) => file.path === LAYOUT)!;
    const result = plan(files);
    expect(result.files).toEqual([
      expect.objectContaining({
        path: LAYOUT,
        content: STARTER_THEME_LAYOUT_SOURCE,
        expectedFileId: layout.id,
        expectedVersion: layout.version,
      }),
    ]);
    expect(result.deletions).toEqual([]);
  });

  it("plans nothing for the current layout", () => {
    expect(plan(workspace())).toEqual({ files: [], deletions: [] });
  });

  it("leaves a layout the author edited alone, even by one byte", () => {
    const edited = `${LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE}\n`;
    expect(
      plannedLayout(workspace(setContent(LAYOUT, edited))),
    ).toBeUndefined();
  });

  it("replaces it together with an untouched content module the same plan upgrades", () => {
    // The oldest module has no isSectionHidden; the plan's own replacement
    // of it is what makes the new layout's import safe.
    expect(LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE).not.toContain(
      "isSectionHidden",
    );
    const result = plan(
      workspace(
        compose(
          setContent(LAYOUT, LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE),
          setContent(CONTENT, LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE),
        ),
      ),
    );
    expect(result.files.map((file) => [file.path, file.content])).toEqual(
      expect.arrayContaining([
        [CONTENT, STARTER_THEME_CONTENT_MODULE_SOURCE],
        [LAYOUT, STARTER_THEME_LAYOUT_SOURCE],
      ]),
    );
    // One plan, saved as one batch (`saveFilesBatch`, a single D1 batch under
    // the expected source generation), each file guarded by the id and
    // version it was read at: either both land or neither does.
    const files = workspace();
    for (const path of [CONTENT, LAYOUT]) {
      const before = files.find((file) => file.path === path)!;
      expect(result.files.find((file) => file.path === path)).toMatchObject({
        expectedFileId: before.id,
        expectedVersion: before.version,
      });
    }
  });

  it("replaces it when the author's edited content module still declares both functions", () => {
    const authored = `${STARTER_THEME_CONTENT_MODULE_SOURCE}
// edited by the author
`;
    const result = plan(
      workspace(
        compose(
          setContent(LAYOUT, LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE),
          setContent(CONTENT, authored),
        ),
      ),
    );
    // The author's module is not touched; only the untouched layout is.
    expect(result.files.map((file) => file.path)).toEqual([LAYOUT]);
  });

  for (const [name, declaration] of [
    ["a value that is not a function", "export const isSectionHidden = true;"],
    [
      "a re-export it cannot follow",
      'export { isSectionHidden } from "./visibility";',
    ],
    ["a factory's result", "export const isSectionHidden = makeVisibility();"],
  ] as const) {
    it(`leaves it when isSectionHidden is ${name}`, () => {
      // A name alone is not enough: the check is the shape the parser can
      // confirm, the same one Design writes rely on.
      const authored = `${LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE}
${declaration}
`;
      expect(
        plannedLayout(
          workspace(
            compose(
              setContent(
                LAYOUT,
                LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE,
              ),
              setContent(CONTENT, authored),
            ),
          ),
        ),
      ).toBeUndefined();
    });
  }

  it("leaves it when the author's content module has no isSectionHidden", () => {
    // The author's module (rule 01 §4.4). Importing a function it does not
    // declare would break a workspace that builds today.
    const authored = LEGACY_STARTER_THEME_CONTENT_MODULE_SOURCE.concat(
      "\n// edited by the author\n",
    );
    expect(authored).not.toContain("isSectionHidden");
    expect(
      plannedLayout(
        workspace(
          compose(
            setContent(
              LAYOUT,
              LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE,
            ),
            setContent(CONTENT, authored),
          ),
        ),
      ),
    ).toBeUndefined();
  });

  it("leaves it when the author deleted a component it imports", () => {
    // Every relative import must resolve as the plan leaves the workspace
    // (`starterSourceImportsSatisfied`, the check the home route uses too).
    const footer = workspace().find((file) =>
      /^src\/components\/Footer\.tsx?$/.test(file.path),
    );
    expect(footer).toBeDefined();
    expect(
      plannedLayout(
        workspace(
          compose(
            setContent(
              LAYOUT,
              LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE,
            ),
            without(footer!.path),
          ),
        ),
      ),
    ).toBeUndefined();
  });

  it("leaves it when the author deleted the content module", () => {
    expect(
      plannedLayout(
        workspace(
          compose(
            setContent(
              LAYOUT,
              LEGACY_STARTER_THEME_LAYOUT_ALWAYS_VISIBLE_SOURCE,
            ),
            without(CONTENT),
          ),
        ),
      ),
    ).toBeUndefined();
  });
});
