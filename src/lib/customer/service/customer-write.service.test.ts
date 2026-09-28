import { beforeEach, describe, expect, it, vi } from "vitest";

const dal = vi.hoisted(() => ({
  findActiveByEmail: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
}));

vi.mock("@/lib/customer/dal/customer.dal", () => ({ customerDal: dal }));

import {
  CustomerWriteError,
  customerWriteService,
} from "./customer-write.service";

const customer = {
  id: "c5a01d8c-93e0-4b1d-b4d1-44ed7e74e94e",
  email: "customer@example.com",
  firstName: "Lin",
  lastName: "Test",
  companyName: null,
  phone: null,
  hasAccount: false,
  orderCount: 0,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  metadata: {},
  addresses: [],
  groups: [],
  recentOrders: [],
};

describe("customerWriteService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normalizes and creates guest customer data with an authenticated actor", async () => {
    dal.findActiveByEmail.mockResolvedValue(null);
    dal.create.mockResolvedValue(undefined);

    const result = await customerWriteService.create(
      {
        email: " CUSTOMER@EXAMPLE.COM ",
        firstName: " Lin ",
        lastName: " Test ",
        companyName: "",
        phone: " 09 1234 5678 ",
        metadata: { source: "api" },
      },
      "admin-user",
      "2026-09-27T01:00:00.000Z",
    );

    expect(result.id).toEqual(expect.any(String));
    expect(dal.findActiveByEmail).toHaveBeenCalledWith("customer@example.com");
    expect(dal.create).toHaveBeenCalledWith({
      id: result.id,
      email: "customer@example.com",
      firstName: "Lin",
      lastName: "Test",
      companyName: null,
      phone: "09 1234 5678",
      metadata: { source: "api" },
      createdBy: "admin-user",
      now: "2026-09-27T01:00:00.000Z",
    });
  });

  it("prevents duplicate emails and account email changes", async () => {
    dal.findActiveByEmail.mockResolvedValue({ id: "existing" });
    await expect(
      customerWriteService.create(
        {
          email: "customer@example.com",
          metadata: {},
        },
        "admin-user",
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_EMAIL" });

    dal.findById.mockResolvedValue({ ...customer, hasAccount: true });
    await expect(
      customerWriteService.update({
        id: customer.id,
        email: "changed@example.com",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_EMAIL_LOCKED" });
  });

  it("updates only supplied fields and archives active customer IDs", async () => {
    dal.findById.mockResolvedValue(customer);
    dal.update.mockResolvedValue(true);
    dal.softDelete.mockResolvedValue(1);

    const result = await customerWriteService.update(
      { id: customer.id, firstName: " New ", metadata: { vip: "true" } },
      "2026-09-27T02:00:00.000Z",
    );
    const archived = await customerWriteService.archive(
      [customer.id],
      "2026-09-27T03:00:00.000Z",
    );

    expect(result).toEqual({ id: customer.id });
    expect(dal.update).toHaveBeenCalledWith(
      customer.id,
      { firstName: "New", metadata: { vip: "true" } },
      "2026-09-27T02:00:00.000Z",
    );
    expect(archived).toEqual({ deleted: 1 });
    expect(dal.softDelete).toHaveBeenCalledWith(
      [customer.id],
      "2026-09-27T03:00:00.000Z",
    );
  });

  it("returns explicit not-found errors instead of a false success", async () => {
    dal.findById.mockResolvedValue(null);
    await expect(
      customerWriteService.update({ id: customer.id, firstName: "New" }),
    ).rejects.toBeInstanceOf(CustomerWriteError);

    dal.softDelete.mockResolvedValue(0);
    await expect(
      customerWriteService.archive([customer.id]),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
