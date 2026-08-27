import { describe, expect, it } from "vitest";

import type { StorefrontReleaseDTO } from "@/lib/storefront/dto/storefront-release.dto";
import {
  describeReleaseHistory,
  expectedActiveReleaseId,
} from "@/lib/storefront/editor/release-history-view";

function release(
  overrides: Partial<StorefrontReleaseDTO> & Pick<StorefrontReleaseDTO, "id">,
): StorefrontReleaseDTO {
  return {
    storefrontId: "store-1",
    themeId: "theme-1",
    sourceRevisionId: "rev-1",
    themeBuildId: "build-1",
    contentPublicationId: null,
    status: "available",
    metadata: null,
    createdBy: null,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
}

describe("describeReleaseHistory", () => {
  const releases = [
    release({ id: "11111111-1111-4111-8111-111111111111" }),
    release({
      id: "22222222-2222-4222-8222-222222222222",
      contentPublicationId: "pub-1",
    }),
    release({ id: "33333333-3333-4333-8333-333333333333", status: "invalidated" }),
  ];

  it("marks the live release and never offers to activate it again", () => {
    const rows = describeReleaseHistory(releases, releases[1].id);

    expect(rows[1]).toMatchObject({ isActive: true, canActivate: false });
    expect(rows[1].blockedReason).toContain("already live");
    expect(rows[0]).toMatchObject({ isActive: false, canActivate: true });
    expect(rows[0].blockedReason).toBe("");
  });

  it("refuses an invalidated release and says why", () => {
    const rows = describeReleaseHistory(releases, releases[0].id);

    expect(rows[2]).toMatchObject({ isInvalidated: true, canActivate: false });
    expect(rows[2].blockedReason).toContain("invalidated");
  });

  it("keeps the order it was given and shortens the id into a handle", () => {
    const rows = describeReleaseHistory(releases, null);

    expect(rows.map((row) => row.id)).toEqual(releases.map((r) => r.id));
    expect(rows[0].label).toBe("11111111");
  });

  it("reports whether a release carries its own published content", () => {
    const rows = describeReleaseHistory(releases, null);

    expect(rows[0].hasPublishedContent).toBe(false);
    expect(rows[1].hasPublishedContent).toBe(true);
  });

  it("offers every release when none is live yet", () => {
    const rows = describeReleaseHistory([releases[0], releases[1]], null);

    expect(rows.every((row) => row.canActivate)).toBe(true);
  });
});

describe("expectedActiveReleaseId", () => {
  it("passes the pointer this view was built from", () => {
    const rows = describeReleaseHistory(
      [release({ id: "11111111-1111-4111-8111-111111111111" })],
      "11111111-1111-4111-8111-111111111111",
    );

    expect(expectedActiveReleaseId(rows, "11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("sends null when the live release is not in the page being shown", () => {
    // Claiming to replace a release this view never listed would let a stale
    // page win a compare-and-set it should lose.
    const rows = describeReleaseHistory(
      [release({ id: "11111111-1111-4111-8111-111111111111" })],
      "99999999-9999-4999-8999-999999999999",
    );

    expect(expectedActiveReleaseId(rows, "99999999-9999-4999-8999-999999999999")).toBeNull();
  });
});
