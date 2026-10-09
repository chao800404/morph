import { describe, expect, it } from "vitest";
import {
  decodeSyncText,
  detectLineEnding,
  normalizeSyncText,
  syncContentHash,
  textForLocal,
} from "./sync-content";

describe("sync content", () => {
  it("hashes CRLF, LF and a byte-order mark as the same text", async () => {
    const lf = await syncContentHash("a\nb\n");
    expect(await syncContentHash("a\r\nb\r\n")).toBe(lf);
    expect(await syncContentHash("\uFEFFa\nb\n")).toBe(lf);
    expect(await syncContentHash("a\nb")).not.toBe(lf);
  });

  it("sends text up as LF without a byte-order mark", () => {
    expect(normalizeSyncText("\uFEFFx\r\ny\r\n")).toBe("x\ny\n");
  });

  it("writes text down in the line endings the local file uses", () => {
    expect(textForLocal("x\ny\n", "crlf")).toBe("x\r\ny\r\n");
    expect(textForLocal("x\r\ny\r\n", "lf")).toBe("x\ny\n");
  });

  it("calls a file CRLF only when every line break is", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("crlf");
    expect(detectLineEnding("a\r\nb\n")).toBe("lf");
    expect(detectLineEnding("one line")).toBe("lf");
  });

  it("does not read bytes that are not UTF-8 as text", () => {
    expect(decodeSyncText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]))).toBeNull();
    expect(decodeSyncText(new TextEncoder().encode("ok"))).toBe("ok");
  });
});
