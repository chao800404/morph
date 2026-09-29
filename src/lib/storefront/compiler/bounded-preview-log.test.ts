// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  boundedPreviewLogAppender,
  sanitizePreviewLogLine,
} from "./bounded-preview-log";

describe("a preview start's bounded log", () => {
  it("keeps lines while there is room", () => {
    const logs: string[] = [];
    const add = boundedPreviewLogAppender(logs, { maxLines: 10 });
    add("one");
    add("two");
    expect(logs).toEqual(["one", "two"]);
  });

  it("cuts a long line before doing anything else with it", () => {
    const logs: string[] = [];
    const add = boundedPreviewLogAppender(logs, {
      maxLines: 10,
      maxLineLength: 5,
    });
    add("abcdefghij");
    expect(logs).toEqual(["abcde [5 more characters]"]);
  });

  it("never holds more than maxLines, the marker included", () => {
    const logs: string[] = [];
    const add = boundedPreviewLogAppender(logs, { maxLines: 3 });
    for (let index = 0; index < 100; index += 1) add(`line ${index}`);
    expect(logs).toHaveLength(3);
    expect(logs.slice(0, 2)).toEqual(["line 0", "line 1"]);
    expect(logs[2]).toMatch(/^\[Live Preview output truncated: \d+ more characters were not kept\]$/);
  });

  it("never holds more than maxTotalLength of output", () => {
    const logs: string[] = [];
    const add = boundedPreviewLogAppender(logs, {
      maxLines: 1_000,
      maxLineLength: 100,
      maxTotalLength: 250,
    });
    for (let index = 0; index < 1_000; index += 1) add("x".repeat(100));
    const kept = logs.slice(0, -1).join("").length;
    expect(kept).toBeLessThanOrEqual(250);
    expect(logs.at(-1)).toMatch(/truncated/);
  });

  it("keeps accepting output once full, and counts what it drops", () => {
    // Whatever feeds the log has to keep being read; a full log that stopped
    // taking output would leave the process writing into a full pipe.
    const logs: string[] = [];
    const add = boundedPreviewLogAppender(logs, { maxLines: 2 });
    add("kept");
    add("12345");
    for (let index = 0; index < 10_000; index += 1) {
      expect(() => add("abcde")).not.toThrow();
    }
    expect(logs).toEqual([
      "kept",
      "[Live Preview output truncated: 50005 more characters were not kept]",
    ]);
  });

  it("does not throw on something that is not text", () => {
    const logs: string[] = [];
    const add = boundedPreviewLogAppender(logs, { maxLines: 2 });
    expect(() => add(undefined as unknown as string)).not.toThrow();
    expect(logs).toEqual([]);
  });
});

describe("a kept log line", () => {
  it("loses terminal sequences and control characters", () => {
    expect(sanitizePreviewLogLine("\u001b[31merror\u001b[0m\r\u0007done\ttab\nnext")).toBe(
      "errordone\ttab\nnext",
    );
  });

  it("masks signed-address parameters", () => {
    expect(
      sanitizePreviewLogLine(
        "GET /_morph/preview-media/a?version=k&expires=1&signature=AbC-_1 200",
      ),
    ).toBe("GET /_morph/preview-media/a?version=k&expires=1&signature=[redacted] 200");
  });

  it("masks the value of a Cookie, Set-Cookie or Authorization line", () => {
    expect(sanitizePreviewLogLine("Cookie: a=1; b=2")).toBe("Cookie: [redacted]");
    expect(sanitizePreviewLogLine("set-cookie: s=1; HttpOnly")).toBe(
      "set-cookie: [redacted]",
    );
    expect(sanitizePreviewLogLine("authorization=Bearer abc")).toBe(
      "authorization=[redacted]",
    );
  });
});
