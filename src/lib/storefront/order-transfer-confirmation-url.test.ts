import { describe, expect, it } from "vitest";
import { buildOrderTransferConfirmationUrl } from "./order-transfer-confirmation-url";

describe("buildOrderTransferConfirmationUrl", () => {
  it("keeps the transfer token in the fragment and scopes the link to the store", () => {
    const token = "a".repeat(64);
    const result = buildOrderTransferConfirmationUrl(
      "shop.example.com",
      "ord_123",
      token,
    );

    expect(result).not.toBeNull();
    const url = new URL(result!);
    expect(url.origin).toBe("https://shop.example.com");
    expect(url.pathname).toBe("/order-transfer");
    expect(url.searchParams.get("order_id")).toBe("ord_123");
    expect(url.search).not.toContain(token);
    expect(new URLSearchParams(url.hash.slice(1)).get("token")).toBe(token);
  });

  it("uses HTTP only for localhost preview hosts", () => {
    expect(
      buildOrderTransferConfirmationUrl(
        "store.localhost:5173",
        "ord_123",
        "a".repeat(64),
      ),
    ).toMatch(/^http:\/\/store\.localhost:5173\//);
  });

  it.each([
    null,
    "",
    "https://attacker.example",
    "attacker.example/path",
    "user@attacker.example",
    "attacker.example?redirect=https://evil.example",
  ])("rejects a non-host value (%s)", (hostname) => {
    expect(
      buildOrderTransferConfirmationUrl(
        hostname,
        "ord_123",
        "a".repeat(64),
      ),
    ).toBeNull();
  });
});
