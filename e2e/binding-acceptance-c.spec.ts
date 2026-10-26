import { test } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";
import { B1_INTEGRATION_CASES, NEW_SECTION_CASES } from "../src/lib/test-utils/binding-acceptance-b1-cases";
import { ensureFixture, walkCase } from "./binding-acceptance-helpers";

const RUNTIME =
  process.env.MORPH_E2E_PREVIEW_RUNTIME === "start" ? "start" : "client";

test.skip(
  !EDITOR_PATH || !process.env.MORPH_E2E_STATE_DIR,
  "Needs the runner-owned throwaway store.",
);

for (const testCase of [
  ...B1_INTEGRATION_CASES.filter((entry) => entry.id.startsWith("c")),
  ...NEW_SECTION_CASES,
]) {
  test.describe(`binding acceptance (${RUNTIME}) ${testCase.id}: ${testCase.verifies}`, () => {
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(600_000);
      await ensureFixture(browser);
    });

    test(`${testCase.id} Inspector edit walks S1-S5`, async ({ page }) => {
      await walkCase(page, testCase, "inspector");
    });

    test(`${testCase.id} inline canvas edit walks S1-S5`, async ({ page }) => {
      await walkCase(page, testCase, "inline");
    });
  });
}
