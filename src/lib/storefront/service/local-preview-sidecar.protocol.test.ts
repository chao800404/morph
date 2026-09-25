// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  LOCAL_PREVIEW_SIDECAR_PATHS,
  LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER,
  generateLocalPreviewSidecarToken,
  localPreviewSidecarPath,
  localPreviewTokenMatches,
  readLocalPreviewSidecarToken,
  type LocalPreviewSidecarOperation,
} from "./local-preview-sidecar.protocol";
import { readLocalPreviewOrigin } from "@/lib/storefront/compiler/local-preview-host";

describe("the local preview sidecar protocol", () => {
  it("has one endpoint per contract member, plus file application", () => {
    // The contract is `ThemePreviewServer`: start, isServing, stop. The other
    // paths are file application — the capability a container let its caller
    // do without a transport, because the Worker holding the binding writes
    // into it directly. `applyFiles` applies source; `stageBinary` is the same
    // capability for bytes, which cannot travel inside JSON without being
    // held whole and re-encoded. Anything else would mean the contract is
    // missing something, not that the sidecar needs more.
    expect(Object.keys(LOCAL_PREVIEW_SIDECAR_PATHS).sort()).toEqual([
      "applyFiles",
      "isServing",
      "stageBinary",
      "start",
      "stop",
    ]);
    // And the member names are the paths, so neither side can quietly address a
    // different endpoint for the same operation.
    for (const operation of Object.keys(
      LOCAL_PREVIEW_SIDECAR_PATHS,
    ) as LocalPreviewSidecarOperation[]) {
      expect(localPreviewSidecarPath(operation)).toBe(
        LOCAL_PREVIEW_SIDECAR_PATHS[operation],
      );
      expect(LOCAL_PREVIEW_SIDECAR_PATHS[operation]).toBe(`/${operation}`);
    }
  });

  it("accepts only the token it was started with", () => {
    const token = "a".repeat(32);
    expect(localPreviewTokenMatches(token, token)).toBe(true);
    expect(localPreviewTokenMatches(token, "a".repeat(31))).toBe(false);
    expect(localPreviewTokenMatches(token, `${"a".repeat(31)}b`)).toBe(false);
    expect(localPreviewTokenMatches(token, "")).toBe(false);
    expect(localPreviewTokenMatches(token, null)).toBe(false);
    expect(localPreviewTokenMatches(token, undefined)).toBe(false);
    // A prefix is not a match, which is the case a length-insensitive compare
    // would get wrong.
    expect(localPreviewTokenMatches(token, token.slice(0, 32))).toBe(true);
    expect(localPreviewTokenMatches(`${token}extra`, token)).toBe(false);
  });

  it("refuses to run on a token that is absent or guessable", () => {
    expect(readLocalPreviewSidecarToken(undefined)).toMatchObject({
      ok: false,
    });
    expect(readLocalPreviewSidecarToken("   ")).toMatchObject({ ok: false });
    const weak = readLocalPreviewSidecarToken("short");
    expect(weak.ok).toBe(false);
    if (weak.ok) return;
    expect(weak.reason).toContain("WEAK_LOCAL_PREVIEW_TOKEN");

    const strong = "f".repeat(32);
    expect(readLocalPreviewSidecarToken(` ${strong} `)).toEqual({
      ok: true,
      token: strong,
    });
  });

  it("mints a token that is long enough and not the same twice", () => {
    const first = generateLocalPreviewSidecarToken();
    const second = generateLocalPreviewSidecarToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(readLocalPreviewSidecarToken(first).ok).toBe(true);
  });

  it("names the header the token travels in, and it is not a cookie", () => {
    expect(LOCAL_PREVIEW_SIDECAR_TOKEN_HEADER).toBe(
      "x-morph-local-preview-token",
    );
  });
});

describe("where a local preview may listen", () => {
  it("accepts loopback on an explicit port", () => {
    expect(readLocalPreviewOrigin("http://127.0.0.1:5199")).toEqual({
      ok: true,
      hostname: "127.0.0.1",
      port: 5199,
    });
    expect(readLocalPreviewOrigin("http://localhost:5199")).toMatchObject({
      ok: true,
      port: 5199,
    });
  });

  it("refuses anything a network could reach", () => {
    const refused = (origin: string) => {
      const result = readLocalPreviewOrigin(origin);
      expect(result.ok).toBe(false);
      return result.ok ? "" : result.reason;
    };

    expect(refused("http://0.0.0.0:5199")).toContain(
      "LOCAL_PREVIEW_SIDECAR_NOT_LOOPBACK",
    );
    expect(refused("http://192.168.1.20:5199")).toContain(
      "LOCAL_PREVIEW_SIDECAR_NOT_LOOPBACK",
    );
    expect(refused("http://preview.example.com:5199")).toContain(
      "LOCAL_PREVIEW_SIDECAR_NOT_LOOPBACK",
    );
    // An https claim is refused rather than trusted: a loopback preview has no
    // certificate, so the scheme would only be a word.
    expect(refused("https://127.0.0.1:5199")).toContain(
      "INVALID_LOCAL_PREVIEW_ORIGIN",
    );
    // And a port has to be named, so both sides cannot disagree about it.
    expect(refused("http://127.0.0.1")).toContain(
      "INVALID_LOCAL_PREVIEW_ORIGIN",
    );
    expect(refused("not a url")).toContain("INVALID_LOCAL_PREVIEW_ORIGIN");
  });
});
