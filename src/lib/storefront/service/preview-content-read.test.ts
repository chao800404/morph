import { describe, expect, it } from "vitest";
import { readConsistentPreviewContent } from "./preview-content-read";

// docs/astro-theme-plan.md 6.6: a preview content snapshot is built from one
// consistent state of the drafts, never half before and half after a write.

/**
 * Drafts as the reads see them: a template and a page, each with a version
 * that every write moves, and a writer that lands between the template read
 * and the page read on the attempts given.
 */
function drafts(writeDuringAttempts: readonly number[]) {
  const state = { template: "A", templateVersion: 1, page: "A", pageVersion: 1 };
  let attempt = 0;
  const readVersions = async () =>
    JSON.stringify([state.templateVersion, state.pageVersion]);
  const readContent = async () => {
    attempt += 1;
    const template = state.template;
    if (writeDuringAttempts.includes(attempt)) {
      // Another request saves both drafts, after the template was read.
      const next = String.fromCharCode(state.template.charCodeAt(0) + 1);
      state.template = next;
      state.templateVersion += 1;
      state.page = next;
      state.pageVersion += 1;
    }
    return { template, page: state.page };
  };
  return { readVersions, readContent, readCount: () => attempt };
}

describe("reading a preview content snapshot", () => {
  it("uses the content when no write landed during the read", async () => {
    const source = drafts([]);
    expect(await readConsistentPreviewContent(source)).toEqual({
      ok: true,
      content: { template: "A", page: "A" },
      versions: "[1,1]",
    });
    expect(source.readCount()).toBe(1);
  });

  it("never returns a snapshot mixing the drafts before and after a write", async () => {
    const source = drafts([1]);
    const read = await readConsistentPreviewContent(source);
    // The first attempt read template A and page B; it is read again.
    expect(read).toEqual({
      ok: true,
      content: { template: "B", page: "B" },
      versions: "[2,2]",
    });
    expect(source.readCount()).toBe(2);
  });

  it("refuses a state that keeps moving rather than snapshot it", async () => {
    const source = drafts([1, 2, 3]);
    expect(await readConsistentPreviewContent(source)).toEqual({
      ok: false,
      error: "PREVIEW_CONTENT_UNSTABLE",
    });
    expect(source.readCount()).toBe(3);
  });
});
