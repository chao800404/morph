// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PREVIEW_EGRESS_DENIED,
  PREVIEW_EGRESS_HEADER,
  refusePreviewEgress,
  resetPreviewEgressTallies,
} from "./preview-egress-policy";

afterEach(() => resetPreviewEgressTallies());

const refuse = (url: string, init: RequestInit = {}, containerId = "c1") => {
  const lines: string[] = [];
  const response = refusePreviewEgress(
    new Request(url, init),
    containerId,
    (line) => lines.push(line),
  );
  return { response, lines };
};

describe("the Live Preview's outbound refusal", () => {
  it("refuses with the preview policy's own answer, for HTTP and HTTPS alike", async () => {
    for (const url of ["http://api.example.com/x", "https://api.example.com/x"]) {
      const { response } = refuse(url);
      expect(response.status).toBe(403);
      expect(response.headers.get(PREVIEW_EGRESS_HEADER)).toBe(PREVIEW_EGRESS_DENIED);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain(PREVIEW_EGRESS_DENIED);
      // It is the preview's policy, and it says so.
      expect(body).toContain("not a limit of TanStack Start");
    }
  });

  it("names only the method, scheme, host and port — never the path, query or credentials", async () => {
    const { response, lines } = refuse(
      "https://API.Example.com:8443/secret/path?token=abc#frag",
      {
        method: "POST",
        headers: { authorization: "Bearer theme-secret" },
        body: "card=4242",
      },
    );
    const body = await response.text();
    for (const text of [body, ...lines]) {
      expect(text).toContain("https://api.example.com:8443");
      for (const leaked of ["secret", "path", "token", "abc", "frag", "Bearer", "4242"]) {
        expect(text).not.toContain(leaked);
      }
    }
    expect(JSON.parse(lines[0])).toMatchObject({
      scope: "storefront.preview.egress",
      code: PREVIEW_EGRESS_DENIED,
      containerId: "c1",
      method: "POST",
      destination: "https://api.example.com:8443",
    });
  });

  it("keeps a host from writing anything but host characters into the log", () => {
    const { lines } = refuse("http://xn--80ak6aa92e.com/");
    expect(JSON.parse(lines[0]).destination).toBe("http://xn--80ak6aa92e.com");
  });

  it("logs a bounded number of refusals per container, and says how many it skipped", () => {
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    for (let index = 0; index < 500; index += 1) {
      const response = refusePreviewEgress(
        new Request(`http://flood-${index}.example.com/`),
        "flooding",
        log,
      );
      // Every request is still refused, logged or not.
      expect(response.status).toBe(403);
    }
    expect(lines).toHaveLength(20);
    // Another container has its own allowance.
    refusePreviewEgress(new Request("http://a.example.com/"), "other", log);
    expect(lines).toHaveLength(21);
  });

  it("says how many refusals went unrecorded once the window has passed", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
      const lines: string[] = [];
      const log = (line: string) => lines.push(line);
      for (let index = 0; index < 25; index += 1) {
        refusePreviewEgress(new Request("http://x.example.com/"), "c", log);
      }
      expect(lines).toHaveLength(20);
      vi.setSystemTime(new Date("2026-09-30T00:01:01Z"));
      refusePreviewEgress(new Request("http://x.example.com/"), "c", log);
      expect(JSON.parse(lines[20])).toMatchObject({ suppressed: 5 });
      expect(JSON.parse(lines[21])).toMatchObject({ method: "GET" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops recording a container altogether after its total allowance", () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const log = (line: string) => lines.push(line);
      let now = new Date("2026-09-30T00:00:00Z").getTime();
      for (let minute = 0; minute < 30; minute += 1) {
        vi.setSystemTime(now);
        for (let index = 0; index < 20; index += 1) {
          refusePreviewEgress(new Request("http://x.example.com/"), "c", log);
        }
        now += 61_000;
      }
      // 600 refusals, 20 a minute: recorded until the total of 200, then none.
      expect(lines).toHaveLength(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
