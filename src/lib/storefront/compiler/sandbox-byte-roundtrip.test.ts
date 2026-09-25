// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  runByteRoundTrip,
  SANDBOX_BYTE_ROUNDTRIP_FLAG,
  sandboxByteRoundTripRefusal,
  type RoundTripSandbox,
} from "./sandbox-byte-roundtrip";

/** A sandbox that stores what the SDK would: strings, decoded per encoding. */
function faithfulSandbox(): RoundTripSandbox {
  const files = new Map<string, Buffer>();
  return {
    async mkdir() {},
    async writeFile(path, content, options) {
      files.set(
        path,
        options?.encoding === "base64"
          ? Buffer.from(content, "base64")
          : Buffer.from(content, "utf8"),
      );
    },
    async readFile(path, options) {
      const bytes = files.get(path)!;
      return options?.encoding === "base64"
        ? { content: bytes.toString("base64"), encoding: "base64" }
        : { content: bytes.toString("utf8"), encoding: "utf-8" };
    },
  };
}

describe("sandboxByteRoundTripRefusal", () => {
  const binding = { Sandbox: {} };

  it("is off unless every condition holds", () => {
    expect(sandboxByteRoundTripRefusal(binding, false)).toMatch(/Disabled/);
    expect(
      sandboxByteRoundTripRefusal(
        { ...binding, [SANDBOX_BYTE_ROUNDTRIP_FLAG]: "1" },
        true,
      ),
    ).toMatch(/production/);
    expect(
      sandboxByteRoundTripRefusal(
        { [SANDBOX_BYTE_ROUNDTRIP_FLAG]: "1" },
        false,
      ),
    ).toMatch(/No Sandbox/);
    expect(
      sandboxByteRoundTripRefusal(
        { ...binding, [SANDBOX_BYTE_ROUNDTRIP_FLAG]: "true" },
        false,
      ),
    ).toMatch(/Disabled/);
    expect(
      sandboxByteRoundTripRefusal(
        { ...binding, [SANDBOX_BYTE_ROUNDTRIP_FLAG]: "1" },
        false,
      ),
    ).toBeNull();
  });
});

describe("runByteRoundTrip", () => {
  it("passes on a sandbox that keeps the bytes", async () => {
    const result = await runByteRoundTrip(faithfulSandbox());
    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual([
      "source.tsx",
      "small.png",
      "large.bin",
    ]);
  });

  it("fails on a sandbox that does not honour the encoding", async () => {
    // Drops the encoding, so base64 is kept as the text it is spelled in.
    const sandbox = faithfulSandbox();
    const lossy: RoundTripSandbox = {
      ...sandbox,
      writeFile: (path, content) => sandbox.writeFile(path, content),
    };
    const result = await runByteRoundTrip(lossy);
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "source.tsx")?.ok).toBe(
      true,
    );
    expect(result.checks.find((check) => check.name === "small.png")?.ok).toBe(
      false,
    );
  });
});
