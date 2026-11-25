import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page } from "@playwright/test";

/**
 * An admin write sent from a page that is same-site with the CMS but not the
 * CMS, as a real browser sends it.
 *
 * The storefront (`stg.showtrue.com.tw`) and the CMS
 * (`admin-stg.showtrue.com.tw`) are one site, so the browser attaches the
 * CMS's SameSite=Lax session cookie to a request a storefront page makes to
 * the CMS. A `text/plain` POST needs no preflight. What refuses it is the
 * origin check on `/api/admin/*` (src/server/same-origin-write.ts).
 *
 * The other page is the same host on another port: `http://localhost:<port>`
 * is same-site with `http://localhost:3000` (a site ignores the port) and a
 * different origin, which is exactly the storefront/CMS relation. It is used
 * rather than two `*.localhost` names because the dev server routes any host
 * it is not told is a platform host to the storefront, so a second hostname
 * for the CMS would need `MORPH_PLATFORM_HOSTNAMES` set on the dev server.
 * The test asserts the browser itself called the request `same-site`, so it
 * cannot pass by the cookie simply not being sent.
 *
 * The signed-in CMS session is the suite's own (`e2e/.auth/user.json`).
 */

let server: Server;
let siblingOrigin = "";

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Same-site page</title><p>storefront");
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  siblingOrigin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const adminOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/** How many API keys the signed-in admin has, asked by the CMS itself. */
async function apiKeyCount(cms: Page): Promise<number> {
  return cms.evaluate(async () => {
    const response = await fetch("/api/admin/api-keys?limit=1", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`listing failed: ${response.status}`);
    return ((await response.json()) as { count: number }).count;
  });
}

test("a same-site page cannot create an admin API key; the CMS can", async ({
  page,
  context,
}) => {
  await page.goto("/dashboard/settings", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/dashboard\/settings\//);
  const before = await apiKeyCount(page);

  // The attack: from the sibling origin, a credentialed text/plain POST,
  // which a browser sends without a preflight.
  const sibling = await context.newPage();
  await sibling.goto(siblingOrigin);
  const target = `${adminOrigin()}/api/admin/api-keys`;
  const sent = sibling.waitForRequest(
    (request) => request.url() === target && request.method() === "POST",
  );
  const answered = sibling.waitForResponse(
    (response) =>
      response.url() === target && response.request().method() === "POST",
  );
  await sibling.evaluate(async (url) => {
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      credentials: "include",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ title: "same-site attack", type: "secret" }),
    }).catch(() => undefined);
  }, target);
  const request = await sent;
  const headers = await request.allHeaders();
  // The request is what the threat model says it is: same-site, with the
  // CMS session cookie attached.
  expect(headers["sec-fetch-site"]).toBe("same-site");
  expect(headers["origin"]).toBe(siblingOrigin);
  expect(headers["cookie"] ?? "").toMatch(/better-auth\.session_token=/);
  expect((await answered).status()).toBe(403);
  expect(await apiKeyCount(page)).toBe(before);

  // The control: the CMS's own page, the same request but as JSON.
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/admin/api-keys", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "same-site control", type: "secret" }),
    });
    return {
      status: response.status,
      id: ((await response.json()) as { api_key?: { id: string } }).api_key
        ?.id,
    };
  });
  expect(created.status).toBe(201);
  expect(await apiKeyCount(page)).toBe(before + 1);

  // And the CMS's own text/plain is refused too, as a body type.
  const plain = await page.evaluate(async () => {
    const response = await fetch("/api/admin/api-keys", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ title: "plain", type: "secret" }),
    });
    return response.status;
  });
  expect(plain).toBe(415);
  expect(await apiKeyCount(page)).toBe(before + 1);

  // Revoke and delete the control's key, so it is not left usable.
  const cleanup = await page.evaluate(async (id) => {
    const key = `/api/admin/api-keys/${encodeURIComponent(id)}`;
    const revoked = await fetch(`${key}/revoke`, {
      method: "POST",
      credentials: "same-origin",
    });
    const deleted = await fetch(key, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return [revoked.status, deleted.status];
  }, created.id!);
  expect(cleanup).toEqual([200, 200]);
});
