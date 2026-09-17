import { describe, expect, it } from "vitest";

import {
  STALE_SERVER_FN_HEADER,
  isOpaqueUnhandledBody,
  describeServerFnId,
  isHtmlDocumentRequest,
  isServerFnRequest,
  recoverDevDocumentResponse,
  recoverServerFnResponse,
  serverFnIdFromRequest,
} from "./server-fn-recovery";

const req = (url: string) => new Request(url, { method: "POST" });
const OPAQUE = '{"status":500,"unhandled":true,"message":"HTTPError"}';
const opaque500 = () => new Response(OPAQUE, { status: 500 });
const dev = { dev: true };

describe("isServerFnRequest", () => {
  it("recognises a server function post", () => {
    expect(isServerFnRequest(req("https://x.test/_serverFn/abc123"))).toBe(
      true,
    );
  });

  it("leaves every other route alone", () => {
    // This gate keeps the recovery from touching unrelated failures, so a page
    // or API error still surfaces as itself.
    for (const url of [
      "https://x.test/dashboard/orders",
      "https://x.test/api/auth/session",
      "https://x.test/",
      "https://x.test/preview-build/b/t/",
    ]) {
      expect(isServerFnRequest(req(url))).toBe(false);
    }
  });
});

describe("isHtmlDocumentRequest", () => {
  it("recognises an HTML page navigation", () => {
    expect(
      isHtmlDocumentRequest(
        new Request("https://x.test/dashboard", {
          headers: { accept: "text/html,application/xhtml+xml" },
        }),
      ),
    ).toBe(true);
  });

  it("refuses mutations, server functions, and non-HTML reads", () => {
    expect(
      isHtmlDocumentRequest(
        new Request("https://x.test/dashboard", {
          method: "POST",
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(false);
    expect(
      isHtmlDocumentRequest(
        new Request("https://x.test/_serverFn/abc", {
          headers: { accept: "text/html" },
        }),
      ),
    ).toBe(false);
    expect(
      isHtmlDocumentRequest(
        new Request("https://x.test/api/data", {
          headers: { accept: "application/json" },
        }),
      ),
    ).toBe(false);
  });
});

describe("isOpaqueUnhandledBody", () => {
  it("matches h3's catch-all exactly", () => {
    expect(isOpaqueUnhandledBody(OPAQUE)).toBe(true);
  });

  it("does not match a failure that reported a reason", () => {
    // Over-matching would replace real messages with a generic one — the
    // failure mode this whole change exists to prevent.
    for (const body of [
      '{"success":false,"message":"Version conflict detected","data":null}',
      '{"status":500,"message":"D1_ERROR: no such table"}',
      '{"unhandled":true,"status":404,"message":"HTTPError"}',
      '{"t":25,"i":0,"s":{"message":"Seroval caught an error"}}',
      "Internal Server Error",
      "",
    ]) {
      expect(isOpaqueUnhandledBody(body)).toBe(false);
    }
  });

  it("does not buffer a large body looking for a short signature", () => {
    expect(isOpaqueUnhandledBody("x".repeat(5000))).toBe(false);
  });
});

describe("serverFnIdFromRequest", () => {
  it("reads the id so the message can name it", () => {
    expect(
      serverFnIdFromRequest(req("https://x.test/_serverFn/eyJhIjoxfQ")),
    ).toBe("eyJhIjoxfQ");
  });

  it("has no id to report for a bare prefix or another route", () => {
    expect(
      serverFnIdFromRequest(req("https://x.test/_serverFn/")),
    ).toBeUndefined();
    expect(
      serverFnIdFromRequest(req("https://x.test/dashboard")),
    ).toBeUndefined();
  });
});

describe("describeServerFnId", () => {
  const id = btoa(
    JSON.stringify({
      file: "/src/server/storefront/storefront-comments.serverFn.ts?tss-serverfn-split",
      export: "listStorefrontCommentGroups_createServerFn_handler",
    }),
  );

  it("names the function and its file", () => {
    // Printed raw the id is a wall of base64 that has to be decoded by hand
    // before the log says which function failed.
    expect(describeServerFnId(id)).toBe(
      "listStorefrontCommentGroups (/src/server/storefront/storefront-comments.serverFn.ts)",
    );
  });

  it("falls back to the raw id rather than losing it", () => {
    expect(describeServerFnId("notbase64")).toBe("notbase64");
    expect(describeServerFnId(btoa('{"file":"a"}'))).toBe(btoa('{"file":"a"}'));
    expect(describeServerFnId(undefined)).toBe("unknown");
  });
});

describe("recoverServerFnResponse", () => {
  it("replaces the blank 500 on a server function", async () => {
    const out = await recoverServerFnResponse(
      req("https://x.test/_serverFn/abc"),
      opaque500(),
      dev,
    );

    expect(out.headers.get(STALE_SERVER_FN_HEADER)).toBe("1");
    const body = (await out.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      error: "SERVER_FN_UNHANDLED",
      functionId: "abc",
    });
    expect(body.message).toMatch(/reload/i);
  });

  it("keeps the 500, because a crashed handler really did fail", async () => {
    // A stale id and a genuine crash land in the same catch-all. Rewriting to
    // 404 would replace one wrong answer with another.
    const out = await recoverServerFnResponse(
      req("https://x.test/_serverFn/abc"),
      opaque500(),
      dev,
    );
    expect(out.status).toBe(500);
  });

  it("does not claim the id was stale", async () => {
    // Naming it "not found" would send people to debug the wrong thing when a
    // handler actually threw.
    const body = (await (
      await recoverServerFnResponse(
        req("https://x.test/_serverFn/abc"),
        opaque500(),
        dev,
      )
    ).json()) as { message: string };
    expect(body.message).not.toMatch(/not found/i);
  });

  it("passes through a 500 that carried a reason", async () => {
    const original = new Response(
      '{"success":false,"message":"D1_ERROR: no such table","data":null}',
      { status: 500 },
    );
    const out = await recoverServerFnResponse(
      req("https://x.test/_serverFn/abc"),
      original,
      dev,
    );

    expect(out).toBe(original);
    await expect(out.text()).resolves.toContain("D1_ERROR");
  });

  it("passes through the same blank 500 on any other route", async () => {
    const original = opaque500();
    expect(
      await recoverServerFnResponse(
        req("https://x.test/dashboard/orders"),
        original,
        dev,
      ),
    ).toBe(original);
  });

  it("passes through every non-500 untouched and unread", async () => {
    for (const status of [200, 302, 401, 404]) {
      const original = new Response("body", { status });
      const out = await recoverServerFnResponse(
        req("https://x.test/_serverFn/abc"),
        original,
        dev,
      );
      expect(out).toBe(original);
      // Reading the original must still be possible: consuming a response on
      // the way out would break every successful server function call.
      await expect(out.text()).resolves.toBe("body");
    }
  });

  it("omits dev-only advice in production", async () => {
    const body = (await (
      await recoverServerFnResponse(
        req("https://x.test/_serverFn/abc"),
        opaque500(),
        { dev: false },
      )
    ).json()) as { message: string };
    expect(body.message).not.toMatch(/reload|dev server/i);
  });
});

describe("recoverDevDocumentResponse", () => {
  const htmlRequest = () =>
    new Request("https://x.test/dashboard", {
      headers: { accept: "text/html,application/xhtml+xml" },
    });

  it("retries the exact opaque document failure once in development", async () => {
    let calls = 0;
    const recovered = new Response("recovered", { status: 200 });
    const out = await recoverDevDocumentResponse(htmlRequest(), opaque500(), {
      dev: true,
      retry: async () => {
        calls += 1;
        return recovered;
      },
    });

    expect(calls).toBe(1);
    expect(out).toBe(recovered);
  });

  it("does not loop when the replacement handler also fails opaquely", async () => {
    let calls = 0;
    const secondFailure = opaque500();
    const out = await recoverDevDocumentResponse(htmlRequest(), opaque500(), {
      dev: true,
      retry: async () => {
        calls += 1;
        return secondFailure;
      },
    });

    expect(calls).toBe(1);
    expect(out).toBe(secondFailure);
  });

  it("does not replay production, mutations, APIs, or explained failures", async () => {
    let calls = 0;
    const retry = async () => {
      calls += 1;
      return new Response("unexpected");
    };
    const explained = new Response(
      '{"status":500,"message":"database unavailable"}',
      { status: 500 },
    );
    const post = new Request("https://x.test/dashboard", {
      method: "POST",
      headers: { accept: "text/html" },
    });
    const json = new Request("https://x.test/api/data", {
      headers: { accept: "application/json" },
    });
    const productionFailure = opaque500();
    const mutationFailure = opaque500();
    const apiFailure = opaque500();

    expect(
      await recoverDevDocumentResponse(htmlRequest(), productionFailure, {
        dev: false,
        retry,
      }),
    ).toBe(productionFailure);
    expect(
      await recoverDevDocumentResponse(post, mutationFailure, {
        dev: true,
        retry,
      }),
    ).toBe(mutationFailure);
    expect(
      await recoverDevDocumentResponse(json, apiFailure, {
        dev: true,
        retry,
      }),
    ).toBe(apiFailure);
    expect(
      await recoverDevDocumentResponse(htmlRequest(), explained, {
        dev: true,
        retry,
      }),
    ).toBe(explained);
    expect(calls).toBe(0);
  });
});
