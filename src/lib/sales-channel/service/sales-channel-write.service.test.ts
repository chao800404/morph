import type { SalesChannelDTO } from "@/lib/sales-channel/dto/sales-channel.dto";
import { salesChannelDal } from "@/lib/sales-channel/dal/sales-channel.dal";
import { describe, expect, it, vi } from "vitest";
import { createSalesChannelWriteService } from "./sales-channel-write.service";

const channelId = "23afdb65-4d5e-49d9-a61e-125eb6b9a836";
const channel: SalesChannelDTO = {
  id: channelId,
  name: "Online Store",
  type: "storefront",
  description: null,
  isDisabled: false,
  metadata: {},
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T00:00:00.000Z"),
};

const channelDependencies = (overrides: Partial<typeof salesChannelDal> = {}) =>
  ({
    findByName: vi.fn(async () => null),
    create: vi.fn(async () => undefined),
    softDelete: vi.fn(async () => undefined),
    findById: vi.fn(async () => channel),
    findByIds: vi.fn(async () => [channel]),
    update: vi.fn(async () => undefined),
    setProductChannels: vi.fn(async () => undefined),
    addProducts: vi.fn(async () => undefined),
    removeProducts: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as typeof salesChannelDal;

describe("sales channel write service", () => {
  it("creates a storefront channel only after preparing its default storefront", async () => {
    const channels = channelDependencies();
    const ensureDefault = vi.fn(async () => undefined);
    const service = createSalesChannelWriteService({
      channels,
      storefronts: { ensureDefault },
      createId: () => channelId,
    });

    const result = await service.create({
      name: "Online Store",
      type: "storefront",
      metadata: { source: "admin" },
    });

    expect(result).toMatchObject({ success: true, data: { id: channelId } });
    expect(channels.create).toHaveBeenCalledWith({
      id: channelId,
      name: "Online Store",
      type: "storefront",
      description: undefined,
      isDisabled: undefined,
      metadata: { source: "admin" },
    });
    expect(ensureDefault).toHaveBeenCalledWith(channelId);
  });

  it("soft-deletes a newly created channel if storefront initialization fails", async () => {
    const channels = channelDependencies();
    const service = createSalesChannelWriteService({
      channels,
      storefronts: {
        ensureDefault: vi.fn(async () => {
          throw new Error("storefront initialization failed");
        }),
      },
      createId: () => channelId,
    });

    const result = await service.create({
      name: "Online Store",
      type: "storefront",
    });

    expect(result).toMatchObject({
      success: false,
      error: "CREATE_FAILED",
      message: "storefront initialization failed",
    });
    expect(channels.softDelete).toHaveBeenCalledWith([channelId]);
  });

  it("reports rollback failure instead of treating the new name as a duplicate", async () => {
    const channels = channelDependencies({
      softDelete: vi.fn(async () => {
        throw new Error("rollback failed");
      }),
    });
    const service = createSalesChannelWriteService({
      channels,
      storefronts: {
        ensureDefault: vi.fn(async () => {
          throw new Error("storefront initialization failed");
        }),
      },
      createId: () => channelId,
    });

    const result = await service.create({
      name: "Online Store",
      type: "storefront",
    });

    expect(result).toMatchObject({
      success: false,
      error: "CREATE_FAILED",
      message: "rollback failed",
    });
  });

  it("refuses to delete the configured default channel", async () => {
    const channels = channelDependencies();
    const service = createSalesChannelWriteService({
      channels,
      currencies: {
        getDefaultSalesChannelId: vi.fn(async () => channelId),
      },
    });

    const result = await service.deleteMany({ ids: [channelId] });

    expect(result).toMatchObject({
      success: false,
      error: "DEFAULT_CHANNEL",
    });
    expect(channels.softDelete).not.toHaveBeenCalled();
  });
});
