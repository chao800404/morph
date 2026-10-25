import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";
import { EDITOR_PATH } from "../helpers";
import { THEMES, serverFn } from "../native-acceptance";
import {
  themeScopeFromEditorPath,
  themeSourceGeneration,
  writeThemeFiles,
} from "../native-compat";
import { recordedPreviewRuntimeSql } from "./recorded-preview-runtime";

export const UNBOUND_ROUTE = "/unbound-preservation";
export const UNBOUND_TITLE = "Stored explicit-prop hero, not a default";
export const UNBOUND_DOCUMENT = {
  version: 1,
  sections: [
    {
      id: "a",
      type: "preserved-hero",
      componentRef: "src/components/PreservedHero.tsx",
      enabled: true,
      props: { title: "Other section", runtimeOnly: "retain" },
    },
    {
      id: "hero",
      type: "preserved-hero",
      componentRef: "src/components/PreservedHero.tsx",
      enabled: true,
      props: { title: UNBOUND_TITLE, desc: "Stored description" },
    },
    {
      id: "unrendered",
      type: "preserved-hero",
      enabled: true,
      props: { title: "Not rendered" },
    },
    {
      id: "hidden",
      type: "preserved-hero",
      enabled: false,
      props: { title: "Must stay hidden" },
    },
  ],
};

// Only the runner's disposable D1, never the developer's .wrangler or remote.
async function localSql(command: string) {
  const state = process.env.MORPH_E2E_STATE_DIR;
  if (!state) throw new Error("Runner-owned database required");
  const { stdout } = await promisify(execFile)("npx", [
    "wrangler",
    "d1",
    "execute",
    "DATABASE",
    "--local",
    ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
      ? ["--env", "local_preview_e2e"]
      : []),
    "--persist-to",
    state,
    "--json",
    "--command",
    command,
  ]);
  return JSON.parse(stdout) as Array<{
    success: boolean;
    results: Record<string, unknown>[];
  }>;
}
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

export async function unboundSectionsFixture(page: Page) {
  if (!EDITOR_PATH) throw new Error("Disposable editor store required");
  await page.goto(EDITOR_PATH, { waitUntil: "domcontentloaded" });
  const scope = {
    ...themeScopeFromEditorPath(EDITOR_PATH),
    themeId: randomUUID(),
  };
  const now = new Date().toISOString();
  const inserted = await localSql(`INSERT INTO storefront_themes
    (id, storefront_id, name, metadata, preview_runtime, created_at, updated_at)
    VALUES (${literal(scope.themeId)}, ${literal(scope.storefrontId)}, 'unbound-content', '{"starterTemplateVersion":1}',
      ${recordedPreviewRuntimeSql()}, '${now}', '${now}');`);
  expect(inserted.every((result) => result.success)).toBe(true);
  const initialized = (await serverFn(
    page,
    THEMES,
    "getStorefrontThemeEditor",
    scope,
  )) as { success: boolean };
  expect(initialized.success).toBe(true);
  const saved = await writeThemeFiles(page, scope, [
    {
      path: "src/components/PreservedHero.tsx",
      content: `export const contentFields = {
  title: { type: "text", label: "Preserved title" }, desc: { type: "text", label: "Description" },
} as const;
export default function PreservedHero({ title = "Default", desc = "" }) { return <section><h2>{title}</h2><p>{desc}</p></section>; }`,
    },
    {
      path: "src/routes/unbound-preservation.tsx",
      content: `import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { morph } from "../morph/content";
import PreservedHero from "../components/PreservedHero";
const getPage = createServerFn().handler(() => morph.pages.get("${UNBOUND_ROUTE}"));
export const Route = createFileRoute("${UNBOUND_ROUTE}")({ loader: () => getPage(), component: Page });
function Page() {
  const { a, hero, _hidden } = Route.useLoaderData();
  const { title, desc } = hero;
  return <main data-hidden-slots={_hidden.join(",")}><PreservedHero {...a} /><PreservedHero title={title} desc={desc} /></main>;
}`,
    },
  ]);
  expect(saved.success, JSON.stringify(saved)).toBe(true);
  const ensured = (await serverFn(
    page,
    THEMES,
    "ensureStorefrontThemeRouteTemplate",
    { ...scope, routePath: UNBOUND_ROUTE },
  )) as {
    success: boolean;
    data?: { id: string; draftGeneration: number };
  };
  expect(ensured.success).toBe(true);
  const templateId = ensured.data!.id;
  // Fixture from before the route changed to explicit props. No fallback in
  // the Theme hides a missing hero; the first browser render must read it.
  await localSql(`UPDATE storefront_theme_templates SET document = ${literal(JSON.stringify(UNBOUND_DOCUMENT))}
    WHERE id = ${literal(templateId)} AND theme_id = ${literal(scope.themeId)} AND draft_revision_id IS NULL;`);
  const readStored = async () => {
    const result =
      await localSql(`SELECT CASE WHEN t.draft_revision_id IS NULL THEN t.document ELSE r.document END AS document
      FROM storefront_theme_templates t LEFT JOIN storefront_theme_template_revisions r
      ON r.id = t.draft_revision_id AND r.template_id = t.id
      WHERE t.id = ${literal(templateId)} AND t.theme_id = ${literal(scope.themeId)};`);
    expect(result[0]!.results).toHaveLength(1);
    return JSON.parse(
      result[0]!.results[0]!.document as string,
    ) as typeof UNBOUND_DOCUMENT;
  };
  expect(await readStored()).toEqual(UNBOUND_DOCUMENT);
  return {
    editorPath: `/store/${scope.storefrontId}/themes/${scope.themeId}/editor?templateId=${templateId}&routePath=${UNBOUND_ROUTE}`,
    readStored,
    async editOtherSection() {
      const written = (await serverFn(
        page,
        THEMES,
        "updateStorefrontThemeSectionProps",
        {
          ...scope,
          templateId,
          sectionId: "a",
          props: { title: "Other section edited" },
          expectedDraftGeneration: ensured.data!.draftGeneration,
          expectedSourceGeneration: await themeSourceGeneration(page, scope),
          routePath: UNBOUND_ROUTE,
        },
      )) as { success: boolean };
      expect(written.success, JSON.stringify(written)).toBe(true);
      const stored = await readStored();
      expect(stored.sections[0]!.props).toMatchObject({
        title: "Other section edited",
        runtimeOnly: "retain",
      });
      expect(stored.sections.slice(1)).toEqual(
        UNBOUND_DOCUMENT.sections.slice(1),
      );
    },
  };
}
