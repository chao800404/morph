// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseSecretApiKeyAuthorization } from "@/server/admin-api/secret-api-key-auth";
import {
  isSandboxPreviewRequest,
  previewRequestFor,
  previewRequestHeaders,
  withoutPlatformCookies,
} from "./preview-proxy-credentials";
import { finishPreviewResponse } from "./preview-proxy-response";

const ENV = { THEME_PREVIEW_HOSTNAME: "preview.example.net" };
const PREVIEW_URL = "https://5173-abc123-tok_en.preview.example.net/page";

describe("which requests go to a preview container", () => {
  it("is a <port>- label directly under the configured preview host", () => {
    expect(isSandboxPreviewRequest(new URL(PREVIEW_URL), ENV)).toBe(true);
  });

  it("is nothing else, so Morph's own requests keep their body", () => {
    for (const url of [
      "https://preview.example.net/",
      "https://admin.example.com/api/thing",
      "https://5173-abc-tok.admin.example.com/",
      "https://www.preview.example.net/",
      "https://5173-abc-tok.x.preview.example.net/",
      "http://localhost:3000/",
    ]) {
      expect(isSandboxPreviewRequest(new URL(url), ENV)).toBe(false);
    }
  });

  it("is nothing at all when no preview host is configured", () => {
    expect(isSandboxPreviewRequest(new URL(PREVIEW_URL), {})).toBe(false);
  });
});

describe("what of a request reaches Theme code", () => {
  it("removes the platform's credential cookies and keeps the Theme's", () => {
    const headers = previewRequestHeaders(
      new Headers({
        cookie:
          "cart=3; better-auth.session_token=secret; __Secure-better-auth.session_data=x; theme_session=abc; verify_access=y",
      }),
    );
    expect(headers.get("cookie")).toBe("cart=3; theme_session=abc");
  });

  it("drops the Cookie header when nothing in it is the Theme's", () => {
    const headers = previewRequestHeaders(
      new Headers({ cookie: "better-auth.session_token=secret" }),
    );
    expect(headers.has("cookie")).toBe(false);
  });

  it("removes x-morph- headers and keeps Authorization and the rest", () => {
    const headers = previewRequestHeaders(
      new Headers({
        authorization: "Bearer theme-token",
        "x-morph-storefront-id": "forged",
        "X-Morph-Release-Id": "forged",
        accept: "text/html",
      }),
    );
    expect(headers.get("authorization")).toBe("Bearer theme-token");
    expect(headers.get("accept")).toBe("text/html");
    expect(headers.has("x-morph-storefront-id")).toBe(false);
    expect(headers.has("x-morph-release-id")).toBe(false);
  });

  describe("Authorization", () => {
    const morphKey = `sk_123e4567-e89b-12d3-a456-426614174000_${"a".repeat(48)}`;
    const forwardedAuthorization = (value: string | null) =>
      previewRequestHeaders(
        new Headers(value === null ? {} : { authorization: value }),
      ).get("authorization");

    it("removes a Morph secret API key in each form the Admin API reads", () => {
      expect(forwardedAuthorization(`Basic ${morphKey}`)).toBeNull();
      expect(forwardedAuthorization(`Basic ${btoa(morphKey)}`)).toBeNull();
      expect(forwardedAuthorization(`Basic ${btoa(`${morphKey}:`)}`)).toBeNull();
    });

    it("matches the scheme case-insensitively, as the Admin API does", () => {
      expect(forwardedAuthorization(`basic ${morphKey}`)).toBeNull();
      expect(forwardedAuthorization(`BASIC ${morphKey}`)).toBeNull();
    });

    it("keeps a Theme's Bearer, even one carrying a Morph-shaped key", () => {
      expect(forwardedAuthorization("Bearer theme-token")).toBe(
        "Bearer theme-token",
      );
      expect(forwardedAuthorization(`Bearer ${morphKey}`)).toBe(
        `Bearer ${morphKey}`,
      );
    });

    it("keeps any other Basic credential", () => {
      const themeBasic = `Basic ${btoa("shopper:hunter2")}`;
      expect(forwardedAuthorization(themeBasic)).toBe(themeBasic);
    });

    it("keeps a malformed Basic value", () => {
      for (const value of [
        "Basic",
        "Basic not-a-key",
        `Basic ${morphKey}x`,
        "Basic %%%",
      ]) {
        expect(forwardedAuthorization(value)).toBe(value);
      }
    });

    it("adds none when the request had none", () => {
      expect(forwardedAuthorization(null)).toBeNull();
    });

    it("removes it from a whole forwarded request too", () => {
      const forwarded = previewRequestFor(
        new Request(PREVIEW_URL, {
          headers: { authorization: `Basic ${morphKey}`, accept: "text/html" },
        }),
      );
      expect(forwarded.headers.has("authorization")).toBe(false);
      expect(forwarded.headers.get("accept")).toBe("text/html");
    });

    // The filter removes exactly what the Admin API would authenticate, no
    // more and no less. `admitted` pins which forms the parser accepts today;
    // the forms it rejects reach Theme code with the key intact, by decision.
    const unpadded = (value: string) => btoa(value).replace(/=+$/, "");
    it.each<readonly [string, HeadersInit, boolean]>([
      ["a raw Basic key", { authorization: `Basic ${morphKey}` }, true],
      ["a base64 key", { authorization: `Basic ${btoa(morphKey)}` }, true],
      ["a base64 `key:`", { authorization: `Basic ${btoa(`${morphKey}:`)}` }, true],
      ["a lowercase scheme", { authorization: `basic ${morphKey}` }, true],
      ["an uppercase scheme", { authorization: `BASIC ${morphKey}` }, true],
      ["a mixed-case scheme", { authorization: `bAsIc ${morphKey}` }, true],
      ["two spaces after the scheme", { authorization: `Basic  ${morphKey}` }, true],
      ["a tab after the scheme", { authorization: `Basic\t${morphKey}` }, true],
      ["whitespace around the value", { authorization: `  Basic ${morphKey} \t` }, true],
      ["an unpadded base64 key", { authorization: `Basic ${unpadded(morphKey)}` }, true],
      [
        "an unpadded base64 `key:`",
        { authorization: `Basic ${unpadded(`${morphKey}:`)}` },
        true,
      ],
      ["over-padded base64", { authorization: `Basic ${btoa(morphKey)}=` }, false],
      [
        "the key as a Basic password",
        { authorization: `Basic ${btoa(`user:${morphKey}`)}` },
        false,
      ],
      [
        "the key as a password with no user",
        { authorization: `Basic ${btoa(`:${morphKey}`)}` },
        false,
      ],
      ["a Bearer key", { authorization: `Bearer ${morphKey}` }, false],
      ["a raw key with a trailing `:`", { authorization: `Basic ${morphKey}:` }, false],
      [
        "comma-joined, the key first",
        { authorization: `Basic ${morphKey}, Bearer x` },
        false,
      ],
      [
        "comma-joined, the key second",
        { authorization: `Bearer x, Basic ${morphKey}` },
        false,
      ],
      [
        "two Authorization headers",
        [
          ["authorization", `Basic ${morphKey}`],
          ["authorization", "Bearer x"],
        ],
        false,
      ],
      ["an empty value", { authorization: "" }, false],
      ["the scheme alone", { authorization: "Basic" }, false],
      ["a non-key credential", { authorization: "Basic not-a-key" }, false],
      ["a key with a trailing character", { authorization: `Basic ${morphKey}x` }, false],
      ["invalid base64", { authorization: "Basic %%%" }, false],
      ["an uppercased key", { authorization: `Basic ${morphKey.toUpperCase()}` }, false],
    ])(
      "drops exactly when the Admin API would accept it, given %s",
      (_case, init, admitted) => {
        const value = new Headers(init).get("authorization");
        const accepted = parseSecretApiKeyAuthorization(value) !== null;
        const dropped = !previewRequestHeaders(new Headers(init)).has(
          "authorization",
        );
        expect(dropped).toBe(accepted);
        expect(accepted).toBe(admitted);
        if (!dropped) {
          expect(previewRequestHeaders(new Headers(init)).get("authorization")).toBe(
            value,
          );
        }
      },
    );
  });

  it("carries the method and body of a Theme request", async () => {
    const forwarded = previewRequestFor(
      new Request(PREVIEW_URL, {
        method: "POST",
        headers: { cookie: "better-auth.session_token=s; cart=1" },
        body: "form=1",
      }),
    );
    expect(forwarded.method).toBe("POST");
    expect(forwarded.url).toBe(PREVIEW_URL);
    expect(forwarded.headers.get("cookie")).toBe("cart=1");
    expect(await forwarded.text()).toBe("form=1");
  });
});

describe("what of a response reaches the browser", () => {
  const response = (setCookies: string[], init: ResponseInit = {}) => {
    const headers = new Headers(init.headers);
    for (const value of setCookies) headers.append("set-cookie", value);
    return new Response("body", { ...init, headers });
  };

  it("removes a Set-Cookie under a platform credential's name", () => {
    const result = withoutPlatformCookies(
      response([
        "better-auth.session_token=planted; Path=/",
        "__Host-better-auth.session_data=planted; Path=/; Secure",
        "verify_access=planted",
      ]),
    );
    expect(result.headers.getSetCookie()).toEqual([]);
  });

  it("keeps every other Set-Cookie, separately and in order", () => {
    const theme = [
      "a=1; Path=/; HttpOnly",
      "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT",
      "c=3; SameSite=None; Secure",
    ];
    const result = withoutPlatformCookies(
      response([theme[0], "better-auth.session_token=x", theme[1], theme[2]]),
    );
    expect(result.headers.getSetCookie()).toEqual(theme);
  });

  it("returns a response with nothing to remove as it is", () => {
    const original = response(["a=1", "b=2"]);
    expect(withoutPlatformCookies(original)).toBe(original);
  });

  it("keeps the Theme's cookies through the whole proxy finish", () => {
    // The finish rebuilds a response for errors and for SVG; neither may
    // join or lose a Set-Cookie.
    const theme = ["a=1; Path=/", "b=2; Expires=Wed, 21 Oct 2037 07:28:00 GMT"];
    for (const init of [
      { status: 500 },
      { status: 200, headers: { "content-type": "image/svg+xml" } },
      { status: 200 },
    ]) {
      const result = finishPreviewResponse(
        response([...theme, "better-auth.session_token=x"], init),
      );
      expect(result.headers.getSetCookie()).toEqual(theme);
    }
  });
});
