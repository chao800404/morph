import { expect, test } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";
import {
  queryLocalD1,
  runSql,
  restoreHero,
  restoreHeroAfterFailure,
  pausedNotice,
  editAndSave,
  readSource,
  openHeroInCode,
  sharedEditor,
  signIn,
  email,
  MARKER,
  SECOND_EMAIL,
} from "./helpers/editor-writes-paused";
import { expectClosedToAnotherAccount } from "./helpers/editor-writes-account-change";

// Part of the former editor-writes-auth.spec.ts, split for CI shard balance.

test.skip(!EDITOR_PATH, "Set E2E_EDITOR_PATH to open the editor.");

test.describe("unsaved work when the signed-in account changes", () => {
  restoreHeroAfterFailure();

  /**
   * The ordering behind PR #372's failure (run 41496671159), made
   * deterministic instead of waiting for a cookie to expire at the right
   * moment: a response to a request this browser sent as the editor's account
   * is held until another account has signed in, in another tab, and only
   * then delivered. Whatever Set-Cookie it carries lands after the sign-in's.
   *
   * With Better Auth's cookie cache on, that response carried the first
   * account's `session_data` and the next save ran as the first account;
   * with renewal on and the session due, it carried the first account's
   * `session_token`. Neither may change who this browser is.
   */
  for (const renewal of [false, true]) {
    test(`a response sent as this account arrives after another account signed in${renewal ? ", session due for renewal" : ""}: the browser stays the new account and the save is refused`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      const { context, page } = await sharedEditor(browser);
      const hero = await openHeroInCode(page);
      const original = await readSource(page, hero);
      const quotedEmail = email().replace(/'/g, "''");
      const stored = () =>
        queryLocalD1<{ content: string; version: number }>(
          `SELECT content, version FROM storefront_theme_files WHERE path = '${hero.replace(/'/g, "''")}' AND deleted_at IS NULL ORDER BY id`,
        );
      const sessionUser = () =>
        page.evaluate(async () => {
          const response = await fetch("/api/auth/get-session");
          const body = (await response.json()) as {
            user?: { email: string };
          } | null;
          return body?.user?.email ?? null;
        });
      const order: string[] = [];
      const note = (line: string) =>
        order.push(`${new Date().toISOString()} ${line}`);
      try {
        if (renewal) {
          // Older than updateAge (1 day), still valid: a session read would
          // renew it if renewal were on.
          runSql(
            `UPDATE sessions SET expires_at = ${Date.now() + (6 * 24 - 1) * 3_600_000} WHERE user_id = (SELECT id FROM users WHERE email = '${quotedEmail}');`,
          );
        }
        // With a cookie cache on, a session read sent without the cache
        // cookie answers with a fresh one; dropped so that the held response
        // would carry it. Nothing to drop while the cache is off.
        await context.clearCookies({ name: /session_data/ });

        const PROBE = "x-morph-e2e-late-probe";
        let release!: () => Promise<void>;
        const held = new Promise<void>((resolve) => {
          void page.route("**/api/auth/get-session*", async (route) => {
            if (!route.request().headers()[PROBE]) return route.fallback();
            // Sent now, as this account; delivered later.
            const response = await route.fetch();
            const setCookies = response
              .headersArray()
              .filter(({ name }) => name.toLowerCase() === "set-cookie")
              .map(({ value }) => value.slice(0, value.indexOf("=")));
            note(
              `first account's get-session answered by the server, held; Set-Cookie: [${setCookies.join(", ")}]`,
            );
            release = () => route.fulfill({ response });
            resolve();
          });
        });
        // The browser's own session read, as useSession sends it.
        const asked = page.evaluate(async (probe) => {
          const response = await fetch("/api/auth/get-session", {
            headers: { [probe]: "1" },
          });
          const body = (await response.json()) as {
            user?: { email: string };
          } | null;
          return body?.user?.email ?? null;
        }, PROBE);
        await held;

        await signIn(context, SECOND_EMAIL);
        note("second account signed in (its Set-Cookie applied)");
        await release();
        expect(await asked).toBe(email());
        note("first account's held response delivered to the page");
        await page.unroute("**/api/auth/get-session*");
        await test.info().attach("cookie-order", {
          body: order.join("\n"),
          contentType: "text/plain",
        });

        // Who the browser is now: the second account.
        expect(await sessionUser()).toBe(SECOND_EMAIL);

        const before = stored();
        expect(before.length).toBeGreaterThan(0);
        await editAndSave(page, hero, `${original}\n/* ${MARKER} held */`);
        await expect(pausedNotice(page)).toContainText(
          "A different account is signed in",
        );
        await expectClosedToAnotherAccount(page);
        // The refused save changed nothing stored: content and version.
        expect(stored()).toEqual(before);
        expect(await readSource(page, hero)).toContain(`${MARKER} held`);
      } finally {
        await context.close();
      }
      const check = await sharedEditor(browser);
      try {
        await openHeroInCode(check.page);
        expect(await readSource(check.page, hero)).not.toContain(MARKER);
      } finally {
        await check.context.close();
        await restoreHero(browser);
      }
    });
  }
});
