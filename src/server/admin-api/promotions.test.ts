import type {
  PromotionDetailDTO,
  PromotionListDTO,
} from "@/lib/promotion/dto/promotion.dto";
import { describe, expect, it, vi } from "vitest";
import {
  handleAdminPromotionsRequest,
  type AdminPromotionsApiDependencies,
} from "./promotions";

const promotionId = "5e7e2bd4-2e85-4d03-9055-423cdb1cad8b";
const promotion: PromotionDetailDTO = {
  id: promotionId,
  code: "VIP10",
  type: "standard",
  status: "active",
  isAutomatic: false,
  limit: 20,
  used: 3,
  methodType: "percentage",
  targetType: "items",
  value: 10,
  currencyCode: null,
  updatedAt: "2026-09-01T00:00:00.000Z",
  metadata: { source: "test" },
  isTaxInclusive: false,
  allocation: "across",
  maxQuantity: null,
  applyToQuantity: null,
  buyRulesMinQuantity: null,
  rules: [{ attribute: "region.id", operator: "in", values: ["region-tw"] }],
  targetRules: [
    { attribute: "items.product.id", operator: "in", values: ["product-1"] },
  ],
  buyRules: [],
  campaign: null,
  createdAt: "2026-08-31T00:00:00.000Z",
};
const listItem: PromotionListDTO = {
  id: promotion.id,
  code: promotion.code,
  type: promotion.type,
  status: promotion.status,
  isAutomatic: promotion.isAutomatic,
  limit: promotion.limit,
  used: promotion.used,
  methodType: promotion.methodType,
  targetType: promotion.targetType,
  value: promotion.value,
  currencyCode: promotion.currencyCode,
  updatedAt: promotion.updatedAt,
};

const dependencies = (
  overrides: Partial<AdminPromotionsApiDependencies> = {},
): AdminPromotionsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-1",
    role: "admin",
  })),
  listPromotions: vi.fn(async () => ({ promotions: [listItem], total: 1 })),
  findPromotion: vi.fn(async () => promotion),
  createPromotion: vi.fn(async () => ({
    success: true as const,
    id: promotionId,
  })),
  updatePromotion: vi.fn(async (_id, _input) => ({
    success: true as const,
    id: promotionId,
  })),
  deletePromotion: vi.fn(async (id) => ({ success: true as const, id })),
  batchRules: vi.fn(async () => ({
    success: true as const,
    created: [
      {
        id: "04a395a0-4375-4f2c-90a1-14611557cdb7",
        attribute: "customer.group.id",
        operator: "eq" as const,
        values: ["vip"],
      },
    ],
    updated: [],
    deleted: {
      ids: [],
      object: "promotion-rule" as const,
      deleted: true as const,
    },
  })),
  ...overrides,
});

describe("Admin promotions API", () => {
  it("lists promotions with exact offset pagination and Medusa fields", async () => {
    const deps = dependencies();
    const response = await handleAdminPromotionsRequest(
      new Request(
        "https://shop.test/api/admin/promotions?q=VIP&offset=3&limit=5&order=code&is_automatic=false",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      promotions: [
        {
          id: promotionId,
          code: "VIP10",
          is_automatic: false,
          application_method: {
            type: "percentage",
            target_type: "items",
            value: 10,
          },
        },
      ],
      count: 1,
      offset: 3,
      limit: 5,
    });
    expect(deps.listPromotions).toHaveBeenCalledWith({
      query: "VIP",
      campaignId: undefined,
      type: undefined,
      status: undefined,
      isAutomatic: false,
      offset: 3,
      limit: 5,
      page: 1,
      sortBy: "code",
      sortOrder: "asc",
    });
  });

  it("reads promotion details and each of its rule scopes", async () => {
    const deps = dependencies();
    const detail = await handleAdminPromotionsRequest(
      new Request(`https://shop.test/api/admin/promotions/${promotionId}`),
      deps,
    );
    const targetRules = await handleAdminPromotionsRequest(
      new Request(
        `https://shop.test/api/admin/promotions/${promotionId}/target-rules`,
      ),
      deps,
    );

    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      promotion: {
        id: promotionId,
        is_tax_inclusive: false,
        application_method: {
          target_rules: [
            {
              attribute: "items.product.id",
              values: ["product-1"],
            },
          ],
        },
        rules: [{ attribute: "region.id", values: ["region-tw"] }],
      },
    });
    expect(await targetRules.json()).toMatchObject({
      target_rules: [{ attribute: "items.product.id", values: ["product-1"] }],
    });
    expect(deps.findPromotion).toHaveBeenCalledTimes(2);
  });

  it("requires a valid commerce session and rejects unknown query fields", async () => {
    const denied = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 401 as const,
        error: "UNAUTHORIZED" as const,
        message: "Sign in",
      })),
    });
    const unauthorized = await handleAdminPromotionsRequest(
      new Request("https://shop.test/api/admin/promotions"),
      denied,
    );
    const invalidQuery = await handleAdminPromotionsRequest(
      new Request("https://shop.test/api/admin/promotions?unexpected=yes"),
      dependencies(),
    );

    expect(unauthorized.status).toBe(401);
    expect(invalidQuery.status).toBe(400);
  });

  it("creates promotions from Medusa-shaped fields and returns the resource", async () => {
    const deps = dependencies();
    const response = await handleAdminPromotionsRequest(
      new Request("https://shop.test/api/admin/promotions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "vip10",
          type: "standard",
          is_automatic: false,
          application_method: {
            type: "percentage",
            target_type: "items",
            allocation: "across",
            value: 10,
            target_rules: [
              {
                attribute: "items.product.id",
                operator: "in",
                values: ["product-1"],
              },
            ],
          },
          rules: [
            {
              attribute: "region.id",
              operator: "in",
              values: ["region-tw"],
            },
          ],
        }),
      }),
      deps,
    );

    expect(response.status).toBe(201);
    expect(deps.createPromotion).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "VIP10",
        methodType: "percentage",
        targetType: "items",
        targetRules: [
          expect.objectContaining({ attribute: "items.product.id" }),
        ],
      }),
      undefined,
    );
    expect(await response.json()).toMatchObject({
      promotion: { id: promotionId, code: "VIP10" },
    });
  });

  it("updates only supplied promotion fields and preserves current rules", async () => {
    const deps = dependencies();
    const response = await handleAdminPromotionsRequest(
      new Request(`https://shop.test/api/admin/promotions/${promotionId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "vip15" }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.updatePromotion).toHaveBeenCalledWith(
      promotionId,
      expect.objectContaining({
        code: "VIP15",
        rules: [expect.objectContaining({ attribute: "region.id" })],
        targetRules: [
          expect.objectContaining({ attribute: "items.product.id" }),
        ],
      }),
    );
  });

  it("batches rule writes and soft-deletes promotions through admin-only routes", async () => {
    const deps = dependencies();
    const batch = await handleAdminPromotionsRequest(
      new Request(
        `https://shop.test/api/admin/promotions/${promotionId}/rules/batch`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            create: [
              {
                attribute: "customer.group.id",
                operator: "eq",
                values: ["vip"],
              },
            ],
          }),
        },
      ),
      deps,
    );
    const deleted = await handleAdminPromotionsRequest(
      new Request(`https://shop.test/api/admin/promotions/${promotionId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(batch.status).toBe(200);
    expect(await batch.json()).toMatchObject({
      created: [{ id: expect.any(String), attribute: "customer.group.id" }],
      deleted: { ids: [], object: "promotion-rule", deleted: true },
    });
    expect(deps.batchRules).toHaveBeenCalledWith(
      promotionId,
      "rules",
      expect.objectContaining({
        create: [expect.objectContaining({ attribute: "customer.group.id" })],
      }),
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      id: promotionId,
      object: "promotion",
      deleted: true,
    });

    const denied = dependencies({
      authorize: vi.fn(async () => ({
        allowed: true as const,
        userId: "staff-1",
        role: "user",
      })),
    });
    const forbidden = await handleAdminPromotionsRequest(
      new Request(`https://shop.test/api/admin/promotions/${promotionId}`, {
        method: "DELETE",
      }),
      denied,
    );
    expect(forbidden.status).toBe(403);
    expect(denied.deletePromotion).not.toHaveBeenCalled();
  });

  it("rejects unsupported promotion write properties instead of dropping them", async () => {
    const response = await handleAdminPromotionsRequest(
      new Request("https://shop.test/api/admin/promotions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "VIP10",
          type: "standard",
          additional_data: { custom: true },
          application_method: {
            type: "percentage",
            target_type: "items",
            value: 10,
          },
        }),
      }),
      dependencies(),
    );

    expect(response.status).toBe(400);
  });
});
