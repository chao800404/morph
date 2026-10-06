import { expect, it } from "vitest";
import { frozenContentRoute } from "./theme-build-content-route";
import type { StorefrontContentPublicationItemDTO } from "../dto/storefront-content-publication.dto";
const item: StorefrontContentPublicationItemDTO = {
  id: "item",
  publicationId: "pub",
  itemType: "template",
  contentId: "content",
  revisionId: "rev",
};
it("uses frozen index identity and never guesses a layout URL", () => {
  expect(
    frozenContentRoute({ ...item, metadata: { templateType: "index" } }),
  ).toBe("/");
  expect(
    frozenContentRoute({ ...item, metadata: { templateType: "layout" } }),
  ).toBeUndefined();
  expect(frozenContentRoute(item)).toBeUndefined();
});
it("uses a Page's frozen handle and rejects conflicting route evidence", () => {
  expect(
    frozenContentRoute({
      ...item,
      itemType: "page",
      metadata: { handle: "old-name" },
    }),
  ).toBe("/pages/old-name");
  expect(() =>
    frozenContentRoute({
      ...item,
      itemType: "page",
      metadata: { handle: "old-name", routePath: "/pages/new-name" },
    }),
  ).toThrow("SSG_CONTENT_ROUTE_MISMATCH");
});
