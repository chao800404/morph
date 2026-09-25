import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  clickExposedElement,
  enableSelection,
  openContentTab,
  previewFrame,
  settleSelection,
} from "./helpers";

/**
 * The publish loop.
 *
 * Publishing is not a read and it is not divisible: `publishTemplate` writes D1
 * activation and moves `active_release_id` before anything is sent to the
 * Worker, and the deployment lease is held around the whole sequence for exactly
 * that reason. There is no "publish without activating" to fall back on, so a
 * slice that tried to stop halfway would be testing a state the product never
 * enters.
 *
 * What makes that safe is not this file. `scripts/run-editor-e2e.mjs` refuses to
 * start when a Cloudflare credential is in scope, because credentials are what
 * `createServerThemeWorkerDeployer` actually reads when it decides between the
 * deployer that uploads and the one that does not. The database this publishes
 * into is created and deleted by that runner.
 *
 * So `MORPH_E2E_HANDOFF` — set by the runner, and where this spec leaves what the
 * runner verifies afterwards — is what says the loop may run. The flag remains
 * for running it by hand, without claiming to make anything safe.
 */
const EDITOR_PATH = process.env.E2E_EDITOR_PATH;
const HANDOFF_PATH = process.env.MORPH_E2E_HANDOFF;
const ALLOWED = Boolean(HANDOFF_PATH) || process.env.E2E_ALLOW_PUBLISH === "1";

test.skip(
  !EDITOR_PATH || !ALLOWED,
  "Run through scripts/run-editor-e2e.mjs, or set E2E_ALLOW_PUBLISH=1 to publish against whatever database this shell points at.",
);

/**
 * Only the container transport can run this.
 *
 * Publishing needs a succeeded build bound to the current source revision, and
 * the build runs in the Sandbox container — which named Wrangler environments do
 * not inherit, so the sidecar transport's environment has no container binding at
 * all. Stated as a skip because the alternative is what this cost to find out:
 * the build fails, publish is refused, and the suite spends three and a half
 * minutes watching `data-editor-save-status` stay "Unpublished" before reporting
 * a timeout that names neither the container nor the transport.
 */
const TRANSPORT = process.env.E2E_EXPECT_PREVIEW_TRANSPORT;
test.skip(
  Boolean(TRANSPORT) && TRANSPORT !== "cloudflare-sandbox",
  `The publish loop builds in the Sandbox container, which the "${TRANSPORT}" transport's environment does not bind. Run it with MORPH_E2E_TRANSPORT=cloudflare-sandbox.`,
);

test.describe("publish loop", () => {
  // A theme build compiles the whole workspace in a container; minutes, not
  // seconds, and nothing is gained by cutting it short.
  test.setTimeout(10 * 60_000);

  test("builds the theme and publishes it as a new release", async ({
    page,
  }) => {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    // The toolbar renders before the page finishes hydrating, and a click in
    // that window is received by nothing at all.
    await page.waitForTimeout(4_000);

    const releasesBefore = await listReleaseLabels(page);

    // A binary file in public/, uploaded through the ordinary write, so the
    // release this run publishes has to carry its exact bytes to the served
    // storefront. Only under the runner: it owns a throwaway database and is
    // what opens the upload entry, so a run by hand never writes an image into
    // whatever store the shell points at.
    const image = HANDOFF_PATH ? await uploadRunImage(page) : null;
    if (image) {
      // The editor holds the source generation it loaded with, and building
      // freezes a revision against it. Reloading takes the one the upload
      // left, instead of a build refused as out of date.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible(
        { timeout: 45_000 },
      );
      await page.waitForTimeout(4_000);
    }

    // The marker does one job: it puts a value in this run's content that can be
    // looked for in what the published artifact renders.
    //
    // It used to claim a second one — moving the draft revision past the
    // published one, so that Publish would be offered at all. That premise was
    // wrong on this theme. Publish is not refused server-side for having nothing
    // to publish; it is a client-side `disabled` on `hasUnpublishedChanges`, and
    // a theme that has never shipped reports `never-published` deliberately, so
    // everything it holds counts as unpublished (`unpublished-changes.ts`, whose
    // docblock records the `version > 1` test this replaced and why it was wrong
    // in both directions). The seeded theme has never been published, so Publish
    // is lit before anything is edited.
    //
    // It replaces a hide-then-show, which moved the revision while leaving the
    // document identical. That was enough to publish and nothing more — a run
    // could then only check that *a* release appeared, never that the release
    // carried this run's work. Generated per run, because a fixed string would
    // also be found in an artifact left behind by the previous one, which is
    // precisely when this check is needed and precisely when it would lie.
    const marker = `morph-e2e-${randomUUID()}`;
    await enableSelection(page);

    // Selected from the section tree first, and only then from the canvas.
    //
    // The canvas path is `clickExposedElement`, which samples for a point that is
    // both uncovered by the editor's panels and resolves to the element itself.
    // That is the right tool for tests about canvas behaviour, and the wrong
    // dependency for this one: when the preview is slow to lay out, no candidate
    // qualifies and the run fails with "nothing was selectable" — which happened,
    // and has nothing to do with publishing. The tree is plain DOM in the parent
    // document, so it selects without hit-testing anything.
    //
    // The canvas remains as a fallback rather than being dropped, because the
    // tree selects a section and a section does not always expose a text field.
    const field = page
      .locator('[data-slot="inspector-content-field"] input')
      .first();

    // Located the way `accessibility.spec.ts` locates it, against the same seeded
    // theme, rather than by a tree attribute. The first spelling of this used
    // `[data-editor-tree-node]`, which no element carries — the attribute is
    // `data-editor-tree-node-id` — so the tree branch could never have run and
    // every run would have taken the canvas fallback while appearing to prefer
    // the tree.
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
    await field.fill(marker);
    await field.press("Tab");

    // Confirmed in the preview before going any further. An edit that never
    // reached the document would still let the build and the publish succeed,
    // and the failure would then surface minutes later as a missing marker with
    // nothing left to point at.
    await expect(
      previewFrame(page).getByText(marker, { exact: false }).first(),
    ).toBeVisible({ timeout: 30_000 });
    // Waits for the save to settle, and catches a save that did not. It is not
    // evidence the edit registered as a draft change: on a never-published theme
    // this label reads "Unpublished" before and after any edit, so that much is
    // indistinguishable here. What it does discriminate is the status line's
    // other states — the label passes through "Saving…" and resolves to
    // "Out of date" on a conflict or "Save failed" on a write error
    // (`visual-editor-shell.tsx`). Those are worth failing on for the same reason
    // the preview check above exists: otherwise a lost write surfaces minutes
    // later as a missing marker, with nothing left to point at.
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Unpublished",
      { timeout: 30_000 },
    );

    // Publish refuses without a succeeded build bound to the current source
    // revision, so the build is part of the loop rather than a precondition
    // someone is expected to have arranged.
    // Addressed by a stable attribute: the same control becomes the build's
    // cancel action while it runs, so its label, title and accessible name all
    // change underneath a locator that matched any of them.
    const build = page.locator("button[data-editor-build-action]");
    await build.click();
    await expect(build).toHaveAttribute("data-build-pending", "true", {
      timeout: 30_000,
    });
    await expect(build).toHaveAttribute("data-build-pending", "false", {
      timeout: 9 * 60_000,
    });

    // A finished build opens its own preview over the whole editor, which is
    // what a person is meant to see — and it covers the Publish button. Closed
    // the way the surface itself offers, with Escape: its own header shows that
    // hint. Without this the click below retries against an overlay until the
    // test times out, reporting ten minutes of "waiting for Publish" for a
    // button that was visible and enabled the entire time.
    const buildPreview = page.locator('[aria-label="Build preview"]');
    if (await buildPreview.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await expect(buildPreview).toBeHidden({ timeout: 30_000 });
    }

    const publish = page.getByRole("button", { name: /^Publish$/ });
    await expect(publish).toBeEnabled({ timeout: 30_000 });
    // Publishing asks for an optional description first, so the release is
    // recognisable in history later. Left blank here: the point of this test is
    // the release, and the note must not be required to create one.
    await publish.click();
    await page.locator("[data-publish-confirm]").click();

    // The status line is the editor's own answer to "is anything unpublished",
    // which is what a person reads before walking away from the screen.
    // Located by the attribute rather than the words: the label is shortened
    // for the toolbar and hidden entirely below a wide viewport, so asserting
    // on either would tie this to a layout decision.
    await expect(page.locator("[data-editor-save-status]")).toHaveAttribute(
      "aria-label",
      "Published",
      { timeout: 3 * 60_000 },
    );

    // Read from a fresh page: the panel keeps what it fetched last time it was
    // opened, and a release created seconds ago can be missing from a list that
    // is still catching up. Reloading asks the server rather than the cache.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^Publish$/ })).toBeVisible({
      timeout: 45_000,
    });
    await page.waitForTimeout(4_000);

    const releasesAfter = await listReleaseLabels(page);
    expect(
      releasesAfter.length,
      "publishing did not add a release",
    ).toBeGreaterThan(releasesBefore.length);
    expect(
      releasesAfter[0],
      "the newest release is not at the top of the list",
    ).not.toBe(releasesBefore[0]);
    // The pointer moved with it: the release just created is the live one.
    //
    // Asserted on the row carrying that release's id rather than on whichever
    // element happens to come first. This read `li:first` and could not have
    // passed: release history is a table, and the first `li` in the dialog
    // belongs to its pagination control — so the assertion compared "Live"
    // against an empty string. Nobody saw it because the spec was gated off and
    // had never run this far.
    await page.getByRole("button", { name: "Release history" }).click();
    const liveRow = page
      .getByRole("dialog")
      .first()
      .locator("tr")
      .filter({ hasText: releasesAfter[0] });
    await expect(liveRow).toHaveCount(1);
    await expect(liveRow).toContainText("Live");

    // The uploaded image is listed in the Code workspace's Explorer and opens
    // read-only: its details, from metadata, in place of an editor.
    if (image) {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /^Code$/ }).click();
      const row = page.locator(`[data-file-tree-file="${image.path}"]`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await expect(
        page.locator(`[data-code-binary-file="${image.path}"]`),
      ).toContainText(image.sha256);
    }

    await writeHandoff(page, {
      marker,
      releaseLabel: releasesAfter[0],
      image,
    });
  });
});

/**
 * What the runner needs to check the half of publishing a browser cannot see.
 *
 * A named file, not "the newest build directory": newest is an implicit signal,
 * and a second theme or an artifact left by an earlier run would silently
 * redirect the verification while it still passed.
 *
 * `releaseLabel` is a prefix, not an id, and is named for what it is. The history
 * panel renders the first eight characters of a release id and nothing in the UI
 * exposes the rest, so the runner asserts that D1's `active_release_id` begins
 * with what the panel showed as live. That still ties the pointer to what a
 * person would have read off the screen, which is the claim worth making;
 * pretending a full id was available would only move the guesswork into the
 * verifier.
 *
 * `schemaVersion` costs a line and gives the two sides something to disagree
 * about loudly when this contract changes.
 */
async function writeHandoff(
  page: import("@playwright/test").Page,
  details: {
    marker: string;
    releaseLabel: string;
    image: RunImage | null;
  },
) {
  if (!HANDOFF_PATH) return;

  // The editor's own URL is the authority on which storefront and theme this
  // run touched. Reading it back beats threading ids through the environment,
  // which could name a theme the suite never opened.
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(page.url());
  if (!match) {
    throw new Error(
      `Could not read a storefront and theme from the editor URL: ${page.url()}`,
    );
  }
  const [, storefrontId, themeId] = match;

  await mkdir(path.dirname(HANDOFF_PATH), { recursive: true });
  await writeFile(
    HANDOFF_PATH,
    JSON.stringify(
      {
        schemaVersion: 2,
        marker: details.marker,
        releaseLabel: details.releaseLabel,
        storefrontId,
        themeId,
        image: details.image,
      },
      null,
      2,
    ),
  );
}

/** Release ids as the history panel lists them, newest first. */
async function listReleaseLabels(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Release history" }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/No releases yet|[0-9a-f]{8}/).first(),
  ).toBeVisible({ timeout: 30_000 });

  const labels = await dialog.locator("code").allInnerTexts();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  return labels.map((label) => label.trim());
}

type RunImage = {
  /** Where it lives in the Theme. */
  path: string;
  /** Where the storefront serves it. */
  urlPath: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
};

const RUN_IMAGE_PATH = "public/images/e2e-run.png";

/**
 * Uploads a PNG unique to this run through `/api/dev/theme-binary-file`, as
 * the signed-in editor.
 *
 * A PNG signature and then random bytes: the format check reads the
 * signature, the build copies the file without decoding it, and bytes no
 * earlier run produced mean an artifact left behind cannot pass for this one.
 *
 * The write names the source generation it expects, like every write. The
 * editor does not show it, so the first attempt says 0 and a conflict, which
 * reports the current one, is answered once with that.
 */
async function uploadRunImage(
  page: import("@playwright/test").Page,
): Promise<RunImage> {
  const match = /\/store\/([^/]+)\/themes\/([^/]+)/.exec(page.url());
  if (!match) {
    throw new Error(
      `Could not read a storefront and theme from the editor URL: ${page.url()}`,
    );
  }
  const [, storefrontId, themeId] = match;
  const bytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    randomBytes(256 * 1024),
  ]);

  const send = (expectedSourceGeneration: number) =>
    page.request.post(
      `/api/dev/theme-binary-file?${new URLSearchParams({
        storefrontId,
        themeId,
        path: RUN_IMAGE_PATH,
        expectedSourceGeneration: String(expectedSourceGeneration),
        expectMissing: "1",
      })}`,
      {
        headers: { "content-type": "application/octet-stream" },
        data: bytes,
      },
    );

  let response = await send(0);
  if (response.status() === 409) {
    const { message } = (await response.json()) as { message: string };
    const current = /source generation is (\d+)/.exec(message);
    expect(
      current,
      `a conflict that names no generation: ${message}`,
    ).not.toBeNull();
    response = await send(Number(current![1]));
  }
  expect(response.status(), await response.text()).toBe(200);
  const saved = (
    (await response.json()) as {
      data: { blobDigest: string; sizeBytes: number; mimeType: string };
    }
  ).data;

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // What was stored is what was sent, before anything downstream is judged.
  expect(saved.blobDigest).toBe(sha256);
  expect(saved.sizeBytes).toBe(bytes.byteLength);
  expect(saved.mimeType).toBe("image/png");

  return {
    path: RUN_IMAGE_PATH,
    urlPath: `/${RUN_IMAGE_PATH.slice("public/".length)}`,
    sha256,
    sizeBytes: bytes.byteLength,
    mimeType: "image/png",
  };
}
