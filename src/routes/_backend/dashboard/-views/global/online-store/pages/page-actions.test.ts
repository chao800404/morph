import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Dashboard's Page actions send the draft version the form was loaded
 * with, so a save from a stale tab is refused (`PAGE_DRAFT_CONFLICT`) rather
 * than written over a newer draft.
 */

const spies = vi.hoisted(() => ({
  updateStorefrontPage: vi.fn(),
  updateStorefrontPageMetadata: vi.fn(),
  restoreStorefrontPageRevision: vi.fn(),
  createStorefrontPage: vi.fn(),
}));
vi.mock("@/server/storefront/storefront-pages.serverFn", () => spies);

const {
  restorePageRevisionAction,
  updatePageAction,
  updatePageMetadataAction,
} = await import("./page-actions");

const PAGE = "44444444-4444-4444-8444-444444444444";

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const spy of Object.values(spies)) spy.mockResolvedValue({ success: true });
});

describe("Page actions send the loaded draft version", () => {
  const page = {
    id: PAGE,
    title: "About",
    handle: "about",
    document: JSON.stringify({ version: 1, sections: [] }),
  };

  it("save", async () => {
    await updatePageAction({ data: form({ ...page, expectedDraftVersion: "3" }) });
    expect(spies.updateStorefrontPage).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: PAGE, expectedDraftVersion: 3 }),
    });
  });

  it("save refuses to send without one", async () => {
    const result = await updatePageAction({ data: form(page) });
    expect(result).toMatchObject({ success: false });
    expect(spies.updateStorefrontPage).not.toHaveBeenCalled();
  });

  it("metadata", async () => {
    await updatePageMetadataAction({
      data: form({ id: PAGE, metadata: "{}", expectedDraftVersion: "3" }),
    });
    expect(spies.updateStorefrontPageMetadata).toHaveBeenCalledWith({
      data: { id: PAGE, metadata: {}, expectedDraftVersion: 3 },
    });
  });

  it("restore", async () => {
    await restorePageRevisionAction(PAGE, "rev-1", 3);
    expect(spies.restoreStorefrontPageRevision).toHaveBeenCalledWith({
      data: { id: PAGE, revisionId: "rev-1", expectedDraftVersion: 3 },
    });
  });
});
