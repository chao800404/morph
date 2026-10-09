import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { EDITOR_PATH, isServerFunctionCall } from "./helpers";

/**
 * The platform's build files (`__entry.tsx`, the Start preview's Worker and
 * client modules) are refused by the server, not only by the editor's dialogs.
 * Unit tests call the handlers with the transport and the auth middleware
 * stood in for; this goes through the real thing — a signed-in browser, the
 * app's own client, Start's serialization — and checks the editor receives
 * the typed failure, and that nothing was written.
 *
 * The first test writes nothing when it passes. The second works on a Theme
 * of its own in the runner's throwaway database. Seeded store only.
 */
test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to a seeded editor store.");

const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

function editorScope() {
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(EDITOR_PATH!);
  expect(match, `no storefront or theme in ${EDITOR_PATH}`).not.toBeNull();
  return { storefrontId: match![1]!, themeId: match![2]! };
}

async function openSignedIn(page: Page) {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  // Signed in: a signed-out browser is sent to the sign-in page instead.
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));
  // The client's serializer is configured once the app has hydrated.
  await page.waitForFunction(() => Boolean(window.__TSR_ROUTER__));
}

/** SQL against the runner's own throwaway D1, as initial-code-publish does. */
async function executeSql(command: string) {
  await promisify(execFile)("npx", [
    "wrangler",
    "d1",
    "execute",
    "DATABASE",
    "--local",
    ...((process.env.MORPH_E2E_TRANSPORT ?? "local-sidecar") === "local-sidecar"
      ? ["--env", "local_preview_e2e"]
      : []),
    "--persist-to",
    process.env.MORPH_E2E_STATE_DIR!,
    "--command",
    command,
  ]);
}

test("a signed-in save onto a platform file reaches the browser as THEME_PATH_REFUSED", async ({
  page,
}) => {
  const { storefrontId, themeId } = editorScope();
  await openSignedIn(page);

  const sent = page.waitForRequest((request) =>
    isServerFunctionCall(request.url(), "saveStorefrontThemeFile"),
  );
  const outcome = await page.evaluate(
    async ({ storefrontId, themeId }) => {
      // A path, not a specifier: resolved by the dev server in the page.
      const load = (path: string) => import(/* @vite-ignore */ path);
      const {
        listStorefrontThemeFiles,
        saveStorefrontThemeFile,
        saveStorefrontThemeFilesBatch,
      } = await load(
        "/src/server/storefront/storefront-theme-files.serverFn.ts",
      );
      const listed = await listStorefrontThemeFiles({
        data: { storefrontId, themeId },
      });
      const generation: number = listed.data.sourceGeneration;
      const single = await saveStorefrontThemeFile({
        data: {
          storefrontId,
          themeId,
          path: "__entry.tsx",
          content: 'throw new Error("not the platform entry");',
          expectMissing: true,
          expectedSourceGeneration: generation,
        },
      });
      // One valid write beside the refused one: none of it may land.
      const batch = await saveStorefrontThemeFilesBatch({
        data: {
          storefrontId,
          themeId,
          files: [
            {
              path: "src/e2e-refused-path-probe.ts",
              content: "export {};",
              expectMissing: true,
            },
            {
              path: "__morph_preview_worker.ts",
              content: "export default {};",
              expectMissing: true,
            },
          ],
          expectedSourceGeneration: generation,
        },
      });
      const after = await listStorefrontThemeFiles({
        data: { storefrontId, themeId },
      });
      const paths = (files: { path: string }[]) => files.map((f) => f.path);
      return {
        single: { success: single.success, error: single.error },
        batch: { success: batch.success, error: batch.error },
        generationBefore: generation,
        generationAfter: after.data.sourceGeneration as number,
        written: paths(after.data.files).filter((path: string) =>
          [
            "__entry.tsx",
            "__morph_preview_worker.ts",
            "src/e2e-refused-path-probe.ts",
          ].includes(path),
        ),
      };
    },
    { storefrontId, themeId },
  );

  expect(outcome.single).toEqual({
    success: false,
    error: "THEME_PATH_REFUSED",
  });
  expect(outcome.batch).toEqual({
    success: false,
    error: "THEME_PATH_REFUSED",
  });
  expect(outcome.written).toEqual([]);
  expect(outcome.generationAfter).toBe(outcome.generationBefore);

  // Over the wire as a result, not an opaque 500.
  const response = await (await sent).response();
  expect(response!.status()).toBe(200);
  expect(await response!.text()).toContain("THEME_PATH_REFUSED");
});

/**
 * A Theme saved before the refusal can already hold one of these files, and
 * no build accepts it while it does. Deleting it is the way back, so the
 * deletion stays open: through the same transport, session, generation and
 * version checks as any other. That the next revision then builds is shown by
 * storefront-theme-files-platform-recovery.test.ts, with a real local build;
 * a build here needs the Sandbox container.
 */
test("a stale platform file can be deleted through the real API", async ({
  page,
}) => {
  test.skip(
    !process.env.MORPH_E2E_STATE_DIR,
    "Needs the runner-owned throwaway store.",
  );
  const { storefrontId } = editorScope();
  // A Theme of its own, so the suite's shared Theme never holds the file.
  const themeId = randomUUID();
  const fileId = randomUUID();
  const now = new Date().toISOString();
  await executeSql(
    `INSERT INTO storefront_themes
      (id, storefront_id, name, metadata, created_at, updated_at)
      VALUES ('${themeId}', '${storefrontId}', 'stale-platform-${themeId}',
        '{}', '${now}', '${now}');
     INSERT INTO storefront_theme_files
      (id, storefront_id, theme_id, path, content, mime_type, is_entry,
        version, created_at, updated_at)
      VALUES ('${fileId}', '${storefrontId}', '${themeId}', '__entry.tsx',
        'throw new Error("stale");', 'text/tsx', 0, 1, '${now}', '${now}');`,
  );

  await openSignedIn(page);
  const outcome = await page.evaluate(
    async ({ module, scope, fileId }) => {
      const fns = await import(/* @vite-ignore */ module);
      const list = async () => {
        const listed = await fns.listStorefrontThemeFiles({ data: scope });
        return {
          generation: listed.data.sourceGeneration as number,
          entry: (
            listed.data.files as { path: string; version: number }[]
          ).find((file) => file.path === "__entry.tsx"),
        };
      };
      const before = await list();
      const target = { ...scope, path: "__entry.tsx", expectedFileId: fileId };
      // Still held to the file's version, like any deletion.
      const wrongVersion = await fns.deleteStorefrontThemeFile({
        data: {
          ...target,
          expectedVersion: before.entry!.version + 1,
          expectedSourceGeneration: before.generation,
        },
      });
      // Editing it in place stays refused.
      const edit = await fns.saveStorefrontThemeFile({
        data: {
          ...target,
          content: "export {};",
          expectedVersion: before.entry!.version,
          expectedSourceGeneration: before.generation,
        },
      });
      const deleted = await fns.deleteStorefrontThemeFile({
        data: {
          ...target,
          expectedVersion: before.entry!.version,
          expectedSourceGeneration: before.generation,
        },
      });
      const after = await list();
      return {
        listedBefore: Boolean(before.entry),
        wrongVersion: wrongVersion.error,
        edit: edit.error,
        deleted: deleted.success,
        listedAfter: Boolean(after.entry),
        generationBefore: before.generation,
        generationAfter: after.generation,
      };
    },
    { module: SERVER_FN_MODULE, scope: { storefrontId, themeId }, fileId },
  );

  expect(outcome).toEqual({
    listedBefore: true,
    wrongVersion: "FILE_VERSION_CONFLICT",
    edit: "THEME_PATH_REFUSED",
    deleted: true,
    listedAfter: false,
    generationBefore: outcome.generationBefore,
    generationAfter: outcome.generationBefore + 1,
  });
});
