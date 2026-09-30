import { expect, test } from "@playwright/test";

/**
 * A server function's refusal, as the browser actually receives it.
 *
 * Start serializes a thrown error with a plugin that keeps only its message,
 * so the code that tells "signed out" from "not allowed" is carried by a
 * serialization adapter registered in `src/start.ts`. Unit tests cover the
 * adapter in Start's plugin order; this goes through the real thing — the
 * app's client calling a real server function on the dev server, with the
 * auth middleware refusing it.
 *
 * `src/start.ts` also has to restate Start's CSRF middleware, because having a
 * start instance at all replaces the default. The last part checks that a
 * cross-site call to the same server function is still refused.
 */
test("a signed-out call reaches the browser as AUTH_REQUIRED, and cross-site calls stay refused", async ({
  browser,
}) => {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  // The client's serializer is configured once the app has hydrated.
  await page.waitForFunction(() => Boolean(window.__TSR_ROUTER__));

  const sent = page.waitForRequest((request) =>
    request.url().includes("/_serverFn/"),
  );
  const outcome = await page.evaluate(async () => {
    // Paths, not specifiers: resolved by the dev server in the page, and kept
    // out of the test's own type-checking of module names.
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { listSessions } = await load(
      "/src/server/auth/list-sessions.serverFn.ts",
    );
    const { classifyAuthFailure } = await load("/src/lib/auth/auth-failure.ts");
    try {
      await listSessions();
      return { threw: false };
    } catch (error) {
      return {
        threw: true,
        code: classifyAuthFailure(error),
        name: (error as Error)?.name,
        message: (error as Error)?.message,
      };
    }
  });

  expect(outcome).toEqual({
    threw: true,
    code: "AUTH_REQUIRED",
    name: "AuthFailure",
    message: "Unauthorized: Please sign in to continue",
  });

  const request = await sent;
  const body = await (await request.response())!.text();
  expect(body).toContain("morph-auth-failure");
  expect(body).toContain("AUTH_REQUIRED");
  // Code and message only: no stack frames cross.
  expect(body).not.toMatch(/\bat .+:\d+:\d+/);

  // Replayed with the client's own headers, so the only difference between
  // the two calls is where they claim to come from.
  const url = request.url();
  const clientHeaders = Object.fromEntries(
    Object.entries(await request.allHeaders()).filter(
      ([name]) =>
        !name.startsWith(":") &&
        !["origin", "referer", "sec-fetch-site", "cookie"].includes(name),
    ),
  );
  const foreign = await context.request.get(url, {
    headers: { ...clientHeaders, origin: "https://evil.example" },
  });
  expect(foreign.status()).toBe(403);

  const sameOrigin = await context.request.get(url, {
    headers: { ...clientHeaders, origin: new URL(url).origin },
  });
  expect(sameOrigin.status()).not.toBe(403);
  expect(await sameOrigin.text()).toContain("AUTH_REQUIRED");

  await context.close();
});
