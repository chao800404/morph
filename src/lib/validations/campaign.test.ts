import { describe, expect, it } from "vitest";
import {
  createCampaignInputSchema,
  listCampaignsInputSchema,
  manageCampaignPromotionsInputSchema,
} from "./campaign";

const campaign = {
  name: "Summer campaign",
  identifier: "summer-2026",
  description: "",
  startsAt: "",
  endsAt: "",
};

describe("campaign input schemas", () => {
  it("accepts a scheduled campaign without a budget", () => {
    expect(
      createCampaignInputSchema.safeParse({
        ...campaign,
        startsAt: "2026-06-01T00:00:00.000Z",
        endsAt: "2026-06-30T23:59:59.000Z",
        budget: null,
      }).success,
    ).toBe(true);
  });

  it("requires currency and an attribute only for the matching budget types", () => {
    expect(
      createCampaignInputSchema.safeParse({
        ...campaign,
        budget: { type: "usage", limit: 100 },
      }).success,
    ).toBe(true);
    expect(
      createCampaignInputSchema.safeParse({
        ...campaign,
        budget: { type: "spend", limit: 100 },
      }).success,
    ).toBe(false);
    expect(
      createCampaignInputSchema.safeParse({
        ...campaign,
        budget: { type: "use_by_attribute", limit: 100 },
      }).success,
    ).toBe(false);
    expect(
      createCampaignInputSchema.safeParse({
        ...campaign,
        budget: {
          type: "spend_by_attribute",
          limit: 100,
          currencyCode: "TWD",
          attribute: "customer_id",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    expect(
      createCampaignInputSchema.safeParse({
        ...campaign,
        startsAt: "2026-07-01T00:00:00.000Z",
        endsAt: "2026-06-30T23:59:59.000Z",
      }).success,
    ).toBe(false);
  });

  it("supports the dashboard status filter and rejects duplicate relation IDs", () => {
    expect(
      listCampaignsInputSchema.safeParse({ status: "scheduled" }).success,
    ).toBe(true);
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      manageCampaignPromotionsInputSchema.safeParse({
        id,
        add: [id, id],
        remove: [],
      }).success,
    ).toBe(false);
  });
});
