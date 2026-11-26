import {
  expect,
  type Frame,
  type Page,
  type Request,
  type Response,
} from "@playwright/test";
import {
  EDITOR_PATH,
  assertServerFnSuccess,
  clickExposedElement,
  decodeServerFnResult,
  enableSelection,
  isServerFunctionCall,
  openContentTab,
  previewFrame,
  settleSelection,
} from "../helpers";
import { execLocalD1, queryLocalD1 } from "./editor-writes-paused";
import { expectHydrated, savedField } from "../native-acceptance";
import { themeScopeFromEditorPath, writeThemeFiles } from "../native-compat";
import {
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE,
  STARTER_THEME_CONTENT_MODULE_SOURCE,
} from "../../src/lib/storefront/starter-theme-v3-files";
import { THEME_PREVIEW_SERVER_BASE_PATH } from "../../src/lib/storefront/compiler/theme-preview-dev-server";
import { STOREFRONT_STARTER_TEMPLATE_VERSION } from "../../src/lib/storefront/default-storefront-document";
import {
  laneStarterContentModule,
  laneStarterVersion,
} from "./client-lane-theme";

/**
 * What the Starter upgrade specs share: starter-upgrade.spec.ts (the cases
 * both lanes run, and E) and starter-upgrade-start.spec.ts (the cases that
 * apply the current Starter, run by the full Start job only). Both work on
 * the run's shared editor Theme, which they put back afterwards.
 */

/** The content module and Starter version the shared Theme holds on this lane. */
export const LANE_CONTENT_MODULE = laneStarterContentModule(
  STARTER_THEME_CONTENT_MODULE_SOURCE,
);
export const LANE_STARTER = laneStarterVersion(
  STOREFRONT_STARTER_TEMPLATE_VERSION,
);

export const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
export const CONTAINERS = TRANSPORT === "cloudflare-sandbox";
/**
 * Which Live Preview runtime the run expects. The full Start job sets it;
 * `expectLiveProbe` checks the page it gets really came from that runtime.
 */
export const START_PREVIEW = process.env.MORPH_E2E_PREVIEW_RUNTIME === "start";
export const STATE_DIR = process.env.MORPH_E2E_STATE_DIR;
export const scope = EDITOR_PATH ? themeScopeFromEditorPath(EDITOR_PATH) : null;
export const SERVER_FN_MODULE =
  "/src/server/storefront/storefront-theme-files.serverFn.ts";

export const CONTENT_MODULE = "src/morph/content.ts";
export const PACKAGE = "package.json";
export const PROBE_ROUTE = "src/routes/pages-probe.tsx";
export const PROBE_FILE = {
  path: PROBE_ROUTE,
  content: `import { createFileRoute } from "@tanstack/react-router";
import { morph } from "../morph/content";

export const Route = createFileRoute("/pages-probe")({
  loader: async () => {
    try {
      return { read: JSON.stringify(await morph.pages.get("/")) };
    } catch (error) {
      return { read: "PAGES_GET_FAILED " + String((error as { code?: string }).code ?? error) };
    }
  },
  component: () => (
    <pre data-pages-probe="">{"pages-probe-loader:" + Route.useLoaderData().read}</pre>
  ),
});
`,
};
export const OLD_PATH_COMPONENTS = [
  "src/components/EditorialIntro.tsx",
  "src/components/CategoryShowcase.tsx",
  "src/components/ImageWithText.tsx",
  "src/components/Newsletter.tsx",
];
export const UPLOADED_IMAGE = "public/starter-upgrade-check.png";
export const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
export const EDITED_PRE_PAGES_MODULE =
  LEGACY_STARTER_THEME_CONTENT_MODULE_V14_SOURCE +
  "\n// edited by the author\n";

/** The local D1 the run's dev server uses, read from its SQLite file. */
export function d1(sql: string): Array<Record<string, unknown>> {
  return queryLocalD1<Record<string, unknown>>(sql);
}

export function setStarterVersion(version: number) {
  execLocalD1(
    `UPDATE storefront_themes SET metadata = json_set(COALESCE(metadata, '{}'), '$.starterTemplateVersion', ${Number(version)}) WHERE id = '${scope!.themeId}'`,
  );
}

export const starterVersion = () =>
  Number(
    d1(
      `SELECT json_extract(metadata, '$.starterTemplateVersion') AS version FROM storefront_themes WHERE id = '${scope!.themeId}'`,
    )[0]?.version,
  );

export const latestBuild = () =>
  d1(
    `SELECT status, error_message FROM storefront_theme_builds WHERE theme_id = '${scope!.themeId}' ORDER BY created_at DESC LIMIT 1`,
  )[0] as { status: string; error_message: string | null } | undefined;

/** Every text file, path → content. */
export async function workspace(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    async ({ module, scope }) => {
      const fns = await import(/* @vite-ignore */ module);
      const listed = await fns.listStorefrontThemeFiles({ data: scope });
      return Object.fromEntries(
        (listed?.data?.files ?? []).map(
          (file: { path: string; content: string }) => [
            file.path,
            file.content,
          ],
        ),
      );
    },
    { module: SERVER_FN_MODULE, scope: scope! },
  );
}

export async function save(
  page: Page,
  files: Array<{ path: string; content: string }>,
) {
  const saved = await writeThemeFiles(page, scope!, files);
  expect(saved.success, JSON.stringify(saved)).toBe(true);
}

/** The Starter version below the current one, which the cases start from. */
export const OLDER = STOREFRONT_STARTER_TEMPLATE_VERSION - 1;

export function clearStarterVersion() {
  execLocalD1(
    `UPDATE storefront_themes SET metadata = json_remove(COALESCE(metadata, '{}'), '$.starterTemplateVersion') WHERE id = '${scope!.themeId}'`,
  );
}

export const upgradeNotice = (page: Page) =>
  page.locator("[data-editor-starter-upgrade]");

/** The author opens the review from the notice. */
export async function openReview(page: Page) {
  // The notice is server-rendered: a click before React has hydrated it is
  // received by nothing and no review is ever asked for (seen on 0d9fc38,
  // case E: the click landed about 1.6 s before the editor mounted). The
  // button itself must be hydrated before it is clicked.
  const review = upgradeNotice(page).getByRole("button", {
    name: "Review upgrade",
  });
  await expectHydrated(review);
  await review.click();
  const dialog = page.getByRole("dialog", {
    name: "Review the Starter upgrade",
  });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  return dialog;
}

/** Applies what the dialog shows, and waits for the apply to answer. */
export async function applyReview(
  page: Page,
  dialog: Awaited<ReturnType<typeof openReview>>,
  label: RegExp,
) {
  const applied = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      isServerFunctionCall(response.url(), "applyStorefrontStarterUpgrade"),
    { timeout: 60_000 },
  );
  // Only the Starter part: the catalog, if it is waiting too, is the
  // catalog spec's to apply.
  const catalog = dialog.getByRole("checkbox", {
    name: "Apply the product catalog changes",
  });
  if ((await catalog.count()) > 0 && (await catalog.isChecked())) {
    await catalog.click();
  }
  await dialog.getByRole("button", { name: label }).click();
  const response = await applied;
  expect(response.ok()).toBe(true);
  // A refused apply still answers 200; the refusal is in the body.
  assertServerFnSuccess(await response.text());
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

/** Opening the editor. Since the reviewed upgrade, it upgrades nothing. */
export async function openEditor(page: Page, routePath?: string) {
  const url = new URL(EDITOR_PATH!, "http://placeholder");
  if (routePath) url.searchParams.set("routePath", routePath);
  await page.goto(`${url.pathname}${url.search}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
    timeout: 45_000,
  });
  // The toolbar renders before the page hydrates; see build-preview-isolated.
  await page.waitForTimeout(4_000);
}

/** Types a marker into the hero, as build-preview-isolated.spec.ts does. */
export async function typeHeroMarker(page: Page, marker: string) {
  await enableSelection(page);
  const field = page
    .locator('[data-slot="inspector-content-field"] input')
    .first();
  const section = page.getByRole("button", { name: "hero", exact: true });
  if (await section.isVisible().catch(() => false)) {
    await section.click();
    await settleSelection(page);
    await openContentTab(page);
  }
  if (!(await field.isVisible().catch(() => false))) {
    const selected = await clickExposedElement(
      page,
      previewFrame(page).locator(
        "h1[data-storefront-field], h2[data-storefront-field], p[data-storefront-field]",
      ),
    );
    expect(
      selected,
      "neither the section tree nor the canvas exposed an editable text field",
    ).not.toBeNull();
    await openContentTab(page);
  }
  await expect(field).toBeVisible({ timeout: 30_000 });
  // The edit is saved after the editor's debounce, not when the canvas shows
  // it. "Unpublished" is no evidence either: the save status already says so
  // before the edit and does not show Saving… while the debounce runs. A
  // test that navigates on either leaves before the save is sent, and the
  // marker never reaches the server (CI run 37964261465). So it waits for
  // the save carrying the marker, and reads the draft back.
  //
  // "After" is event order, not the clocks in Request.timing(): startTime is
  // wall-clock at coarse resolution and responseStart is relative and leaves
  // out queueing, so at a few milliseconds they can put a sync that really
  // followed the save before it (CI run 45819532709). The page's own request
  // and response events fire in the order the browser saw them, so every
  // request is numbered as it is sent and the save's answer is numbered when
  // it arrives.
  let eventSeq = 0;
  let saveAnsweredSeq: number | null = null;
  const requestSeq = new WeakMap<Request, number>();
  let saveRequest: Request | null = null;
  const isSaveResponse = (response: Response) =>
    response.request().method() === "POST" &&
    isServerFunctionCall(response.url(), "updateStorefrontThemeSectionProps") &&
    (response.request().postData() ?? "").includes(marker);
  const onRequest = (request: Request) => {
    requestSeq.set(request, ++eventSeq);
  };
  const onResponse = (response: Response) => {
    if (saveAnsweredSeq === null && isSaveResponse(response)) {
      saveAnsweredSeq = ++eventSeq;
    }
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    const saved = page.waitForResponse(
      (response) => {
        const hit = isSaveResponse(response);
        if (hit) saveRequest = response.request();
        return hit;
      },
      { timeout: 30_000 },
    );
    // Under the full Start preview the server reads its own content snapshot,
    // which only the sync after this save updates (preview-content-sync.ts).
    // Leaving before it answers can leave that server on the older snapshot,
    // and a later document request would not carry the marker. So it also
    // waits for that sync: this Theme's, sent after this save was answered
    // (by event order, above), and answering that the preview reads it.
    let syncRequest: Request | null = null;
    const synced = START_PREVIEW
      ? page.waitForResponse(
          (response) => {
            const request = response.request();
            if (
              request.method() !== "POST" ||
              !isServerFunctionCall(
                response.url(),
                "syncThemePreviewContent",
              ) ||
              !saveRequest
            ) {
              return false;
            }
            const body = request.postData() ?? "";
            const sentAt = requestSeq.get(request);
            const hit =
              body.includes(scope!.storefrontId) &&
              body.includes(scope!.themeId) &&
              saveAnsweredSeq !== null &&
              sentAt !== undefined &&
              sentAt > saveAnsweredSeq;
            if (hit) syncRequest = request;
            return hit;
          },
          { timeout: 30_000 },
        )
      : null;
    // A sync can also be refused with one of the two answers the editor then
    // confirms instead of writing again (CONFIRMABLE_REFUSALS in
    // preview-content-sync.ts): it asks confirmThemePreviewContent whether the
    // preview reads the ticket the sync was written under. That confirmation
    // is this Theme's, sent after the sync. Waited for only on such a refusal.
    const confirmed = START_PREVIEW
      ? page.waitForResponse(
          (response) => {
            const request = response.request();
            if (
              request.method() !== "POST" ||
              !isServerFunctionCall(
                response.url(),
                "confirmThemePreviewContent",
              ) ||
              !syncRequest
            ) {
              return false;
            }
            const body = request.postData() ?? "";
            return (
              body.includes(scope!.storefrontId) &&
              body.includes(scope!.themeId) &&
              requestSeq.has(request) &&
              requestSeq.has(syncRequest) &&
              requestSeq.get(request)! > requestSeq.get(syncRequest)!
            );
          },
          { timeout: 30_000 },
        )
      : null;
    // Not awaited when the sync applies; its timeout then rejects unobserved.
    confirmed?.catch(() => {});
    await field.fill(marker);
    await field.press("Tab");
    await expect(
      previewFrame(page).getByText(marker, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });
    const response = await saved;
    expect(response.ok()).toBe(true);
    // A refused write still answers 200; the refusal is in the body.
    assertServerFnSuccess(await response.text());
    await savedField(page, scope!, marker);
    if (synced) {
      const answer = await synced;
      expect(answer.ok()).toBe(true);
      // A refused sync still answers 200; the refusal is in the body.
      const decoded = decodeServerFnResult(await answer.text());
      expect(
        typeof decoded === "object" &&
          decoded !== null &&
          !Array.isArray(decoded),
        `the sync answer is an object (got ${decoded === null ? "null" : typeof decoded})`,
      ).toBe(true);
      const result = decoded as {
        success?: unknown;
        error?: unknown;
        data?: { ticket?: unknown };
        sentTicket?: unknown;
      };
      const isTicket = (value: unknown): value is number =>
        typeof value === "number" && Number.isSafeInteger(value) && value > 0;
      if (result.success === true) {
        expect(
          isTicket(result.data?.ticket),
          `the sync names the ticket the preview reads (got ${typeof result.data?.ticket})`,
        ).toBe(true);
      } else {
        const code =
          typeof result.error === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/.test(result.error)
            ? result.error
            : `(${typeof result.error})`;
        expect(
          ["PREVIEW_CONTENT_SUPERSEDED", "PREVIEW_CONTENT_NOT_CONFIRMED"],
          `the sync was refused with ${code}, which the editor does not confirm`,
        ).toContain(code);
        const sent = result.sentTicket;
        expect(
          isTicket(sent),
          `the refused sync names the ticket it was written under (got ${typeof sent})`,
        ).toBe(true);
        const confirmation = await confirmed!;
        expect(confirmation.ok()).toBe(true);
        const confirmedResult = assertServerFnSuccess(
          await confirmation.text(),
        );
        const read = (confirmedResult.data as { ticket?: unknown } | undefined)
          ?.ticket;
        // The preview reads that ticket or a later one. Whether a later one
        // carries this save is the document's to show, below.
        expect(
          isTicket(read) && read >= (sent as number),
          `the confirmation names a ticket the preview reads, at or after the sync's (got ${typeof read})`,
        ).toBe(true);
      }
    }
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}

export async function expectLiveProbe(page: Page, marker: string) {
  await openEditor(page, "/pages-probe");
  const probe = previewFrame(page).locator("[data-pages-probe]");
  await expect(probe).toContainText(marker, { timeout: 90_000 });
  await expect(probe).not.toContainText("PAGES_GET_FAILED");
  // Which runtime served it, from the page's own document asked again: the
  // full Start preview renders the loader's answer on the server, the
  // client-only preview sends a shell the browser fills in. Not the
  // environment settings: what the runtime actually returned.
  const served = await previewFrame(page)
    .locator("body")
    .evaluate(async () => {
      const response = await fetch(location.pathname, { cache: "no-store" });
      return {
        path: location.pathname,
        status: response.status,
        html: await response.text(),
      };
    });
  // The probe's own page, answered. The full Start preview serves each
  // route at its own path; the client-only preview serves one shell at its
  // base path and routes inside the page, so its address stays there.
  if (START_PREVIEW) {
    expect(served.path).toMatch(/\/pages-probe$/);
  } else {
    expect(served.path).toBe(THEME_PREVIEW_SERVER_BASE_PATH);
  }
  expect(served.status).toBe(200);
  if (START_PREVIEW) {
    // The probe's loader rendered it on the server, and its answer, inside
    // the probe, is this test's marker, which no other page or run can
    // carry. Markers are letters, digits and hyphens, so the marker is its
    // own pattern.
    expect(served.html).toMatch(
      new RegExp(`data-pages-probe=""[^>]*>pages-probe-loader:[^<]*${marker}`),
    );
  } else {
    // A shell: neither the loader's prefix nor the marker.
    expect(served.html).not.toContain("pages-probe-loader:");
    expect(served.html).not.toContain(marker);
  }
}

export async function build(page: Page) {
  const action = page.locator("button[data-editor-build-action]");
  await expect(action).toBeEnabled({ timeout: 30_000 });
  // Enabled is not hydrated: the server-rendered button is enabled too, and
  // a click before React attaches its handler reaches nothing (e3106ab, case
  // E: clicked 1.3 s before the editor's modules finished loading, no build
  // request, no toast). The button itself must be hydrated before the click.
  await expectHydrated(action);
  await action.click();
  await expect(action).toHaveAttribute("data-build-pending", "true", {
    timeout: 30_000,
  });
  await expect(action).toHaveAttribute("data-build-pending", "false", {
    timeout: 9 * 60_000,
  });
}

/** Builds and checks the isolated Build Preview against the sealed snapshot. */
export async function expectBuildPreview(
  page: Page,
  marker: string,
  withProbe: boolean,
) {
  await openEditor(page);
  await build(page);
  const frameElement = page.locator('iframe[data-build-preview="isolated"]');
  await expect(frameElement).toBeVisible({ timeout: 60_000 });
  const address = new URL((await frameElement.getAttribute("src"))!);
  expect(address.hostname).toMatch(/^bp-[0-9a-f]{40}\./);
  let preview: Frame | null = null;
  await expect
    .poll(
      () =>
        (preview = page.frame({
          url: (url) => url.hostname === address.hostname,
        })),
      { timeout: 120_000 },
    )
    .toBeTruthy();
  await expect(preview!.locator("body")).not.toBeEmpty({ timeout: 120_000 });
  const content = await preview!.evaluate(async () => {
    const response = await fetch("/_morph/content?path=/");
    return { status: response.status, body: await response.text() };
  });
  expect(content.status).toBe(200);
  expect(content.body).toContain(marker);
  await expect(
    preview!.getByText(marker, { exact: false }).first(),
  ).toBeVisible({ timeout: 60_000 });
  const probed = withProbe
    ? await preview!.evaluate(async () => {
        const response = await fetch("/pages-probe");
        return { status: response.status, html: await response.text() };
      })
    : null;
  expect(probed === null || probed.status === 200).toBe(true);
  expect(probed === null || probed.html.includes(marker)).toBe(true);
  expect(probed === null || !probed.html.includes("PAGES_GET_FAILED")).toBe(
    true,
  );
}
