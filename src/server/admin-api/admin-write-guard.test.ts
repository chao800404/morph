// @vitest-environment node
import { describe, expect, it } from "vitest";
import { refuseUnsafeAdminWrite } from "./admin-write-guard";

const ADMIN = "https://admin-stg.showtrue.com.tw";

const request = (
  method: string,
  headers: Record<string, string>,
  body?: BodyInit,
) =>
  new Request(`${ADMIN}/api/admin/api-keys`, {
    method,
    headers: { cookie: "__Host-better-auth.session_token=s", ...headers },
    ...(body === undefined ? {} : { body }),
  });

const sameOrigin = { "sec-fetch-site": "same-origin", origin: ADMIN };

describe("refuseUnsafeAdminWrite", () => {
  it("passes reads without looking at them", async () => {
    expect(
      await refuseUnsafeAdminWrite(request("GET", {}), "api-keys", ADMIN),
    ).toBeNull();
  });

  it("refuses a cookie write from a same-site storefront", async () => {
    const response = await refuseUnsafeAdminWrite(
      request(
        "POST",
        {
          "sec-fetch-site": "same-site",
          origin: "https://stg.showtrue.com.tw",
          "content-type": "application/json",
        },
        "{}",
      ),
      "api-keys",
      ADMIN,
    );
    expect(response?.status).toBe(403);
  });

  it("refuses an Origin that extends the admin origin", async () => {
    const response = await refuseUnsafeAdminWrite(
      request(
        "POST",
        { origin: `${ADMIN}.evil.com`, "content-type": "application/json" },
        "{}",
      ),
      "api-keys",
      ADMIN,
    );
    expect(response?.status).toBe(403);
  });

  it("lets a Basic secret-key request through with no Origin", async () => {
    expect(
      await refuseUnsafeAdminWrite(
        request(
          "POST",
          {
            authorization: "Basic sk_test",
            "content-type": "application/json",
          },
          "{}",
        ),
        "api-keys",
        ADMIN,
      ),
    ).toBeNull();
  });

  it("refuses a text/plain body from the CMS itself with 415", async () => {
    const response = await refuseUnsafeAdminWrite(
      request(
        "POST",
        { ...sameOrigin, "content-type": "text/plain;charset=UTF-8" },
        '{"title":"x"}',
      ),
      "api-keys",
      ADMIN,
    );
    expect(response?.status).toBe(415);
  });

  it("refuses an untyped body with 415", async () => {
    const response = await refuseUnsafeAdminWrite(
      request("POST", sameOrigin, new Blob(['{"title":"x"}'])),
      "api-keys",
      ADMIN,
    );
    expect(response?.status).toBe(415);
  });

  it("refuses a non-JSON body on a Basic-key request too", async () => {
    const response = await refuseUnsafeAdminWrite(
      request(
        "POST",
        { authorization: "Basic sk_test", "content-type": "text/plain" },
        "{}",
      ),
      "api-keys",
      ADMIN,
    );
    expect(response?.status).toBe(415);
  });

  it("passes a bodyless write (a confirm, an export start)", async () => {
    expect(
      await refuseUnsafeAdminWrite(
        request("POST", sameOrigin),
        "products/import/x/confirm",
        ADMIN,
      ),
    ).toBeNull();
  });

  it("leaves the CSV import's body type to the import itself", async () => {
    expect(
      await refuseUnsafeAdminWrite(
        request(
          "POST",
          { ...sameOrigin, "content-type": "text/csv; charset=utf-8" },
          "handle\nx\n",
        ),
        "products/import",
        ADMIN,
      ),
    ).toBeNull();
  });

  it("still checks the origin of the CSV import", async () => {
    const response = await refuseUnsafeAdminWrite(
      request(
        "POST",
        { "sec-fetch-site": "same-site", "content-type": "text/csv" },
        "handle\nx\n",
      ),
      "products/import",
      ADMIN,
    );
    expect(response?.status).toBe(403);
  });
});
