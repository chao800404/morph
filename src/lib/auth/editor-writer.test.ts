// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  beginVerificationStamp,
  currentRequestStamp,
  requestStampOf,
} from "@/lib/storefront/editor/editor-request-sequence";
import {
  claimsAnotherWriter,
  editorWriterClaim,
  editorWriterMiddleware,
} from "./editor-writer";

describe("claimsAnotherWriter", () => {
  it("is a mismatch only for a claim naming someone else", () => {
    expect(claimsAnotherWriter("user-a", "user-b")).toBe(true);
    expect(claimsAnotherWriter("user-a", "user-a")).toBe(false);
  });

  it("reads no claim as no mismatch", () => {
    for (const claim of [undefined, null, "", 42, { id: "user-a" }]) {
      expect(claimsAnotherWriter(claim, "user-b")).toBe(false);
    }
  });
});

describe("editorWriterClaim", () => {
  it("reads the claim from a middleware context, and nothing else", () => {
    expect(editorWriterClaim({ editorWriter: "user-a" })).toBe("user-a");
    expect(editorWriterClaim({})).toBeUndefined();
    expect(editorWriterClaim(undefined)).toBeUndefined();
    expect(editorWriterClaim("user-a")).toBeUndefined();
  });
});

describe("editorWriterMiddleware", () => {
  type Client = (options: {
    next: (ctx?: unknown) => Promise<unknown>;
  }) => Promise<unknown>;
  const client = (
    editorWriterMiddleware as unknown as { options: { client: Client } }
  ).options.client;

  it("stamps a failed call with the verification it was sent under, not the one current when it failed", async () => {
    const refused = new Error("refused");
    const sentUnder = currentRequestStamp();
    await expect(
      client({
        next: async () => {
          // A verification begins while the request is out.
          beginVerificationStamp();
          throw refused;
        },
      }),
    ).rejects.toBe(refused);
    expect(requestStampOf(refused)).toBe(sentUnder);
    expect(currentRequestStamp()).toBe(sentUnder + 1);
  });

  it("stamps every attempt on its own", async () => {
    const first = new Error("first");
    const second = new Error("second");
    const firstStamp = currentRequestStamp();
    await expect(
      client({
        next: async () => {
          throw first;
        },
      }),
    ).rejects.toBe(first);
    beginVerificationStamp();
    await expect(
      client({
        next: async () => {
          throw second;
        },
      }),
    ).rejects.toBe(second);
    expect(requestStampOf(first)).toBe(firstStamp);
    expect(requestStampOf(second)).toBe(firstStamp + 1);
  });

  it("passes an answer through untouched", async () => {
    await expect(client({ next: async () => "answer" })).resolves.toBe(
      "answer",
    );
  });
});
