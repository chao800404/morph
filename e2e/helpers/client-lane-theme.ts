import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { test } from "@playwright/test";
import {
  CLIENT_LANE_STARTER_FIXTURE,
  CLIENT_LANE_STARTER_VERSION,
  CLIENT_LANE_THEMES_VAR,
  CLIENT_LANE_THEME_SLOTS,
  CLIENT_LANE_THROWAWAY_VAR,
  CLIENT_LANE_USES_VAR,
  type ClientLaneSlot,
} from "../../scripts/e2e-client-lane-guard.mjs";

/**
 * The client lane's dedicated Starter 31 Themes
 * (`scripts/e2e-client-lane-guard.mjs`).
 *
 * Only active when the runner sets `MORPH_E2E_CLIENT_LANE_THEMES`, which it
 * does on a client-lane run and nowhere else. Everywhere else
 * `clientLaneTheme` returns null and a spec keeps its own Theme: the shared
 * one `E2E_EDITOR_PATH` opens, or a throwaway one.
 *
 * On the lane those are Starter 31 Themes too: `E2E_EDITOR_PATH` is the
 * shared slot the runner allocated and `seedClientLaneThemes` seeds, and
 * `insertThrowawayTheme` seeds each Starter-backed throwaway through
 * `seedClientLaneThrowaway`.
 */

export type ClientLaneTheme = {
  slot: ClientLaneSlot;
  storefrontId: string;
  themeId: string;
  indexTemplateId: string;
  /** The editor on the Theme's index template. */
  editorPath: string;
};

/**
 * Seeds the Themes: the shared slot `E2E_EDITOR_PATH` names, then the
 * dedicated slots. Called by `auth.setup.ts` once the store exists and
 * before any editor has opened (the transport check opens the shared slot
 * next), with no page of the run open; does nothing off the client lane. The
 * seed refuses, and so does this, unless every Theme read back is exactly
 * Starter 31 with no recorded runtime.
 */
export function seedClientLaneThemes(): void {
  if (!process.env[CLIENT_LANE_THEMES_VAR]) return;
  // On top of sign-in's budget, not out of it: the seed waits up to a minute
  // for the store's own provisioning and is given up to three to finish.
  test.setTimeout(test.info().timeout + 180_000);
  const seeded = spawnSync(process.execPath, SEED_COMMAND, {
    stdio: ["ignore", "inherit", "pipe"],
    encoding: "utf8",
    timeout: 180_000,
  });
  if (seeded.status !== 0) {
    throw new Error(
      `The client lane's Starter 31 Themes were not seeded (exit ${seeded.status ?? seeded.signal}): ${seeded.stderr?.trim() || seeded.error?.message || "no output"}`,
    );
  }
}

const SEED_COMMAND = [
  "--import",
  "tsx",
  "--import",
  "./scripts/client-lane-theme/register.mjs",
  "scripts/client-lane-theme/seed.ts",
];

/** Whether this is a client-lane run (the runner set the Themes file). */
export function onClientLane(): boolean {
  return Boolean(process.env[CLIENT_LANE_THEMES_VAR]);
}

/**
 * Seeds one throwaway on the pinned Starter 31 workspace, through the same
 * Node seed as the slots, before any editor reads it; called by
 * `insertThrowawayTheme` on the lane only. The seed verifies what it wrote
 * and records it for the guard; this throws unless it did.
 */
export function seedClientLaneThrowaway(input: {
  storefrontId: string;
  themeId: string;
  name: string;
}): { indexTemplateId: string } {
  let title = "";
  try {
    title = test.info().titlePath.join(" > ");
  } catch {
    // Outside a test or hook: the seed is still recorded.
  }
  // Inside the caller's own budget: the seed starts a D1 proxy and usually
  // takes a few seconds; a busy database is retried within it.
  const seeded = spawnSync(process.execPath, SEED_COMMAND, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      [CLIENT_LANE_THROWAWAY_VAR]: JSON.stringify({ ...input, test: title }),
    },
  });
  if (seeded.status !== 0) {
    throw new Error(
      `The client lane's throwaway Theme ${input.themeId} was not seeded on Starter 31 (exit ${seeded.status ?? seeded.signal}): ${seeded.stderr?.trim() || seeded.error?.message || "no output"}`,
    );
  }
  const last = seeded.stdout.trim().split("\n").pop() ?? "";
  const answer = JSON.parse(last) as { themeId?: string; indexTemplateId?: string };
  if (answer.themeId !== input.themeId || typeof answer.indexTemplateId !== "string") {
    throw new Error(`The client lane's seed answered for another Theme: ${last}`);
  }
  return { indexTemplateId: answer.indexTemplateId };
}

/**
 * The Starter content module a spec's Theme holds on this lane: on the
 * client lane the pinned Starter 31 fixture's bytes (the module every seeded
 * Theme starts with), elsewhere the current Starter's.
 */
export function laneStarterContentModule(current: string): string {
  if (!onClientLane()) return current;
  const fixture = JSON.parse(
    readFileSync(CLIENT_LANE_STARTER_FIXTURE, "utf8"),
  ) as { files: { path: string; content: string }[] };
  const module = fixture.files.find((file) => file.path === "src/morph/content.ts");
  if (!module) {
    throw new Error(`${CLIENT_LANE_STARTER_FIXTURE} holds no src/morph/content.ts.`);
  }
  return module.content;
}

/**
 * The Starter version a spec's shared Theme records on this lane: the
 * pinned Starter 31 on the client lane, elsewhere the current one.
 */
export function laneStarterVersion(current: number): number {
  return onClientLane() ? CLIENT_LANE_STARTER_VERSION : current;
}

/**
 * The slot's dedicated Theme on a client-lane run, or null elsewhere. Taking
 * it records the use, which the runner checks against the seeded Theme. A
 * client-lane run whose Themes cannot be read fails here rather than falling
 * back to a Theme the lane does not check.
 */
export function clientLaneTheme(slot: ClientLaneSlot): ClientLaneTheme | null {
  const themesFile = process.env[CLIENT_LANE_THEMES_VAR];
  if (!themesFile) return null;
  if (!CLIENT_LANE_THEME_SLOTS.includes(slot)) {
    throw new Error(`No client lane slot is named ${slot}.`);
  }
  const usesFile = process.env[CLIENT_LANE_USES_VAR];
  if (!usesFile) {
    throw new Error(
      `${CLIENT_LANE_THEMES_VAR} is set without ${CLIENT_LANE_USES_VAR}, so a use of the client lane's Theme would go unrecorded.`,
    );
  }
  let record: { themes?: unknown };
  try {
    record = JSON.parse(readFileSync(themesFile, "utf8"));
  } catch (error) {
    throw new Error(
      `The client lane's Themes could not be read from ${themesFile}; was the seed run by auth.setup? ${error instanceof Error ? error.message : error}`,
    );
  }
  const themes = Array.isArray(record.themes)
    ? (record.themes as ClientLaneTheme[])
    : [];
  const theme = themes.find((entry) => entry.slot === slot);
  if (!theme) {
    throw new Error(`The client lane seeded no Theme for slot ${slot}.`);
  }
  let title = "";
  try {
    title = test.info().titlePath.join(" > ");
  } catch {
    // Outside a test or hook: the use is still recorded.
  }
  appendFileSync(
    usesFile,
    `${JSON.stringify({ slot, themeId: theme.themeId, test: title })}\n`,
  );
  return {
    slot: theme.slot,
    storefrontId: theme.storefrontId,
    themeId: theme.themeId,
    indexTemplateId: theme.indexTemplateId,
    editorPath: theme.editorPath,
  };
}
