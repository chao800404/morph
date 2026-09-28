import type { CampaignDTO } from "@/lib/promotion/dto/campaign.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminCampaignsRequest,
  type AdminCampaignsApiDependencies,
} from "./campaigns";

const campaignId = "a3d8c4b3-9c44-44e0-b8ee-2c828ddf60f8";
const promotionId = "975d1f37-cd5d-4bdb-a256-64280b201bd0";
const campaign: CampaignDTO = {
  id: campaignId,
  name: "Summer Sale",
  description: "Seasonal offers",
  identifier: "summer-2026",
  startsAt: "2026-06-01T00:00:00.000Z",
  endsAt: "2026-08-31T23:59:59.000Z",
  budget: {
    id: "27737794-a762-4439-bef4-3c8c33cfe9fd",
    type: "usage",
    currencyCode: null,
    limit: 100,
    used: 12,
    attribute: null,
  },
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-02T00:00:00.000Z",
  deletedAt: null,
};

const dependencies = (
  overrides: Partial<AdminCampaignsApiDependencies> = {},
): AdminCampaignsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listCampaigns: vi.fn(async () => ({ campaigns: [campaign], total: 1 })),
  findCampaign: vi.fn(async () => campaign),
  createCampaign: vi.fn(async () => ({
    success: true as const,
    id: campaignId,
  })),
  updateCampaign: vi.fn(async (_id, _input) => ({
    success: true as const,
    id: campaignId,
  })),
  deleteCampaign: vi.fn(async (id) => ({ success: true as const, id })),
  managePromotions: vi.fn(async (id) => ({ success: true as const, id })),
  ...overrides,
});

describe("Admin campaigns API", () => {
  it("lists campaigns with Medusa pagination and resource fields", async () => {
    const deps = dependencies();
    const response = await handleAdminCampaignsRequest(
      new Request(
        "https://shop.test/api/admin/campaigns?q=summer&offset=10&limit=5&order=name",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      campaigns: [
        {
          id: campaignId,
          campaign_identifier: "summer-2026",
          starts_at: campaign.startsAt,
          budget: {
            type: "usage",
            limit: 100,
            used: 12,
          },
        },
      ],
      count: 1,
      offset: 10,
      limit: 5,
    });
    expect(deps.listCampaigns).toHaveBeenCalledWith({
      query: "summer",
      identifier: undefined,
      offset: 10,
      limit: 5,
      sortBy: "name",
      sortOrder: "asc",
    });
  });

  it("creates campaigns with budget fields mapped to Morph's domain input", async () => {
    const deps = dependencies();
    const response = await handleAdminCampaignsRequest(
      new Request("https://shop.test/api/admin/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Email Offer",
          campaign_identifier: "email-offer",
          starts_at: "2026-09-01T00:00:00Z",
          budget: {
            type: "use_by_attribute",
            limit: 5,
            attribute: "email",
          },
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.createCampaign).toHaveBeenCalledWith({
      name: "Email Offer",
      description: undefined,
      identifier: "email-offer",
      startsAt: "2026-09-01T00:00:00Z",
      endsAt: undefined,
      budget: {
        type: "use_by_attribute",
        limit: 5,
        currencyCode: undefined,
        attribute: "email",
      },
    });
    expect(await response.json()).toMatchObject({
      campaign: { id: campaignId, campaign_identifier: "summer-2026" },
    });
  });

  it("updates campaign details and only exposes the mutable budget limit", async () => {
    const deps = dependencies();
    const response = await handleAdminCampaignsRequest(
      new Request(`https://shop.test/api/admin/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campaign_identifier: "summer-sale",
          budget: { limit: 25 },
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updateCampaign).toHaveBeenCalledWith(campaignId, {
      name: undefined,
      description: undefined,
      identifier: "summer-sale",
      startsAt: undefined,
      endsAt: undefined,
      budgetLimit: 25,
    });
    const immutableBudgetField = await handleAdminCampaignsRequest(
      new Request(`https://shop.test/api/admin/campaigns/${campaignId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ budget: { type: "spend", limit: 25 } }),
      }),
      deps,
    );
    expect(immutableBudgetField.status).toBe(400);
  });

  it("manages promotion links and deletes campaigns without deleting promotions", async () => {
    const deps = dependencies();
    const linked = await handleAdminCampaignsRequest(
      new Request(
        `https://shop.test/api/admin/campaigns/${campaignId}/promotions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ add: [promotionId], remove: [] }),
        },
      ),
      deps,
    );
    const deleted = await handleAdminCampaignsRequest(
      new Request(`https://shop.test/api/admin/campaigns/${campaignId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(linked.status).toBe(200);
    expect(deps.managePromotions).toHaveBeenCalledWith(campaignId, {
      add: [promotionId],
      remove: [],
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      id: campaignId,
      object: "campaign",
      deleted: true,
    });
  });

  it("requires administrator access for writes and rejects unknown fields", async () => {
    const user = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "user-1",
        role: "user",
      })),
    });
    const forbidden = await handleAdminCampaignsRequest(
      new Request("https://shop.test/api/admin/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Campaign",
          campaign_identifier: "campaign",
        }),
      }),
      user,
    );
    const unknownField = await handleAdminCampaignsRequest(
      new Request("https://shop.test/api/admin/campaigns?unexpected=true"),
      dependencies(),
    );

    expect(forbidden.status).toBe(403);
    expect(unknownField.status).toBe(400);
    expect(user.createCampaign).not.toHaveBeenCalled();
  });
});
