import { describe, expect, it, vi } from "vitest";
import { provisionStorefrontDomain } from "./domain-provisioning.server";

const dependencies = () => ({
  attach: vi.fn(async () => "cf-domain" as string | null),
  detach: vi.fn(async () => undefined),
  activate: vi.fn(async () => undefined),
  markFailed: vi.fn(async () => undefined),
});

describe("provisionStorefrontDomain", () => {
  it("activates the database record after Cloudflare succeeds", async () => {
    const deps = dependencies();
    await expect(
      provisionStorefrontDomain("shop.test.com", deps),
    ).resolves.toBe("cf-domain");
    expect(deps.activate).toHaveBeenCalledWith("cf-domain");
    expect(deps.detach).not.toHaveBeenCalled();
  });

  it("detaches Cloudflare when database activation fails", async () => {
    const deps = dependencies();
    deps.activate.mockRejectedValueOnce(new Error("D1 failed"));
    await expect(
      provisionStorefrontDomain("shop.test.com", deps),
    ).rejects.toThrow("D1 failed");
    expect(deps.detach).toHaveBeenCalledWith("cf-domain");
    expect(deps.markFailed).toHaveBeenCalledWith("D1 failed");
  });

  it("records a retryable failure when compensation also fails", async () => {
    const deps = dependencies();
    deps.activate.mockRejectedValueOnce(new Error("D1 failed"));
    deps.detach.mockRejectedValueOnce(new Error("Cloudflare failed"));
    await expect(
      provisionStorefrontDomain("shop.test.com", deps),
    ).rejects.toThrow("Domain provisioning and compensation failed");
    expect(deps.markFailed).toHaveBeenCalledWith(
      "Cloudflare provisioning failed and cleanup must be retried",
    );
  });
});
