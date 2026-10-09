import { describe, expect, it } from "vitest";
import {
  THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH,
  previewContentDigest,
  previewContentHash,
  previewContentTicket,
  previewContentWithoutTicket,
  withPreviewInstance,
} from "./theme-preview-content";
import {
  PREVIEW_CONTENT_TICKET_HEADER,
  themePreviewStartWorkerSource,
} from "./theme-preview-start-runtime";
import { themeWorkspaceFingerprint } from "./theme-sandbox-workspace";

// docs/astro-theme-plan.md 6.5: the order of draft content snapshots written
// into one Live Preview.

const snapshot = (headline: string, contentTicket?: number) =>
  JSON.stringify({
    templates: { index: { slots: { hero: { headline } }, hiddenSlots: [] } },
    pages: {},
    ...(contentTicket === undefined ? {} : { contentTicket }),
  });

describe("a content snapshot's ticket", () => {
  it("is read from the data file, and 0 for none or one unreadable", () => {
    expect(previewContentTicket(snapshot("A", 7))).toBe(7);
    expect(previewContentTicket(snapshot("A"))).toBe(0);
    expect(previewContentTicket(null)).toBe(0);
    expect(previewContentTicket("not json")).toBe(0);
    for (const ticket of [-1, 0, 1.5, "3", Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        previewContentTicket(JSON.stringify({ contentTicket: ticket })),
      ).toBe(0);
    }
  });

  it("is not workspace content: two snapshots differing only in it fingerprint alike", () => {
    const at = `/workspace/${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}`;
    const fingerprint = (content: string) =>
      themeWorkspaceFingerprint([
        { path: "/workspace/src/index.tsx", content: "export default 1;" },
        { path: at, content },
      ]);
    expect(fingerprint(snapshot("A", 1))).toBe(fingerprint(snapshot("A", 9)));
    expect(fingerprint(snapshot("A", 1))).toBe(fingerprint(snapshot("A")));
    expect(fingerprint(snapshot("A", 1))).not.toBe(fingerprint(snapshot("B", 1)));
    expect(previewContentWithoutTicket(snapshot("A", 4))).toBe(snapshot("A"));
    // Only the content file: the same field anywhere else is content.
    expect(
      themeWorkspaceFingerprint([
        { path: "/workspace/data.json", content: snapshot("A", 1) },
      ]),
    ).not.toBe(
      themeWorkspaceFingerprint([
        { path: "/workspace/data.json", content: snapshot("A", 2) },
      ]),
    );
  });
});

describe("the preview Worker entry", () => {
  const source = themePreviewStartWorkerSource("preview-1", "entry");

  it("reads the data file the dev server's content endpoint reads", () => {
    expect(source).toContain(
      `await import("./${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}")`,
    );
  });

  it("names the ticket of the snapshot it reads on the address probe", () => {
    expect(source).toContain(JSON.stringify(PREVIEW_CONTENT_TICKET_HEADER));
    expect(source).toContain("await readSnapshot();");
  });
});

describe("a content snapshot's hash", () => {
  const content = JSON.stringify({
    templates: { index: { slots: { hero: { headline: "A" } }, hiddenSlots: [] } },
    pages: {},
  });
  const described = (meta: Record<string, unknown>) =>
    JSON.stringify({ ...JSON.parse(content), ...meta });

  it("is taken over the content alone, not its ticket, versions or server", async () => {
    const plain = await previewContentDigest(content);
    expect(plain).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await previewContentDigest(
        described({
          contentTicket: 4,
          contentHash: plain,
          contentVersions: "[1]",
          previewInstance: "server-1",
        }),
      ),
    ).toBe(plain);
    expect(
      await previewContentDigest(content.replace('"A"', '"B"')),
    ).not.toBe(plain);
  });

  it("is read back only when it is one", () => {
    const hash = "a".repeat(64);
    expect(previewContentHash(described({ contentHash: hash }))).toBe(hash);
    expect(previewContentHash(described({ contentHash: "short" }))).toBeNull();
    expect(previewContentHash(content)).toBeNull();
    expect(previewContentHash(null)).toBeNull();
  });

  it("leaves the fingerprint alone, as the ticket does", () => {
    const at = `/workspace/${THEME_PREVIEW_CONTENT_DATA_RELATIVE_PATH}`;
    const fingerprint = (text: string) =>
      themeWorkspaceFingerprint([{ path: at, content: text }]);
    expect(
      fingerprint(described({ contentHash: "a".repeat(64), previewInstance: "s1" })),
    ).toBe(fingerprint(described({ contentHash: "b".repeat(64), previewInstance: "s2" })));
  });

  it("is stamped with the server it is written for, without touching the content", () => {
    const stamped = withPreviewInstance(described({ contentTicket: 2 }), "server-2");
    expect(JSON.parse(stamped)).toMatchObject({
      contentTicket: 2,
      previewInstance: "server-2",
    });
    expect(previewContentWithoutTicket(stamped)).toBe(content);
  });
});
