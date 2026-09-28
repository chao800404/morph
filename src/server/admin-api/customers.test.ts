import { describe, expect, it, vi } from "vitest";
import type {
  CustomerDetailDTO,
  CustomerListItemDTO,
} from "@/lib/customer/dto/customer.dto";
import {
  handleAdminCustomersRequest,
  type AdminCustomersApiDependencies,
} from "./customers";

const customerId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const listCustomer: CustomerListItemDTO = {
  id: customerId,
  email: "customer@example.com",
  firstName: "Lin",
  lastName: "Test",
  companyName: null,
  phone: null,
  hasAccount: true,
  orderCount: 2,
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};

const detailCustomer: CustomerDetailDTO = {
  ...listCustomer,
  metadata: { source: "storefront" },
  addresses: [
    {
      id: "a4d7a769-5f1b-4adb-9f4f-c1b338ea3505",
      addressName: "Home",
      isDefaultShipping: true,
      isDefaultBilling: true,
      customerId,
      company: null,
      firstName: "Lin",
      lastName: "Test",
      address1: "1 Main Street",
      address2: null,
      city: "Taipei",
      countryCode: "tw",
      province: null,
      postalCode: "100",
      phone: null,
      metadata: {},
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
    },
  ],
  groups: [{ id: "c9f3cc07-9a22-4c85-9b7d-0a5b7a8f23a0", name: "Wholesale" }],
  recentOrders: [
    {
      id: "c45583db-4777-42ae-bc53-8c44e39776e3",
      displayId: 41,
      status: "completed",
      total: 2000,
      currencyCode: "twd",
      createdAt: "2026-09-26T00:00:00.000Z",
    },
  ],
};

const dependencies = (
  overrides: Partial<AdminCustomersApiDependencies> = {},
): AdminCustomersApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-user",
    role: "admin",
  })),
  listCustomers: vi.fn(async () => ({ customers: [listCustomer], total: 1 })),
  findCustomer: vi.fn(async () => detailCustomer),
  createCustomer: vi.fn(async () => ({ id: customerId })),
  updateCustomer: vi.fn(async () => ({ id: customerId })),
  archiveCustomer: vi.fn(async () => ({ deleted: 1 })),
  listCustomerAddresses: vi.fn(async () => ({
    addresses: detailCustomer.addresses,
    total: detailCustomer.addresses.length,
  })),
  findCustomerAddress: vi.fn(async () => detailCustomer.addresses[0] ?? null),
  createCustomerAddress: vi.fn(async () => ({
    id: detailCustomer.addresses[0]!.id,
  })),
  updateCustomerAddress: vi.fn(async () => ({
    id: detailCustomer.addresses[0]!.id,
  })),
  archiveCustomerAddress: vi.fn(async () => ({
    id: detailCustomer.addresses[0]!.id,
  })),
  batchCustomerGroups: vi.fn(async () => "updated" as const),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin customers API", () => {
  it("lists customers with filters, offset pagination, sorting, and snake_case fields", async () => {
    const deps = dependencies();
    const response = await handleAdminCustomersRequest(
      new Request(
        "https://morph.test/api/admin/customers?q=lin&id=" +
          customerId +
          "&email=CUSTOMER%40EXAMPLE.COM&has_account=true&offset=15&limit=10&order=email",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listCustomers).toHaveBeenCalledWith({
      query: "lin",
      id: customerId,
      email: "customer@example.com",
      hasAccount: true,
      offset: 15,
      limit: 10,
      sortBy: "email",
      sortOrder: "asc",
      page: 2,
    });
    expect(await json(response)).toEqual({
      customers: [
        {
          id: customerId,
          email: "customer@example.com",
          first_name: "Lin",
          last_name: "Test",
          company_name: null,
          phone: null,
          has_account: true,
          order_count: 2,
          created_at: "2026-09-27T00:00:00.000Z",
          updated_at: "2026-09-27T00:00:00.000Z",
        },
      ],
      count: 1,
      offset: 15,
      limit: 10,
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects invalid filters before reading customers", async () => {
    const deps = dependencies();
    const response = await handleAdminCustomersRequest(
      new Request("https://morph.test/api/admin/customers?limit=1000"),
      deps,
    );
    expect(response.status).toBe(400);
    expect(deps.listCustomers).not.toHaveBeenCalled();
  });

  it("maps customer detail and its address, groups, and recent orders", async () => {
    const deps = dependencies();
    const response = await handleAdminCustomersRequest(
      new Request(`https://morph.test/api/admin/customers/${customerId}`),
      deps,
    );
    const payload = await json(response);
    expect(response.status).toBe(200);
    expect(deps.findCustomer).toHaveBeenCalledWith(customerId);
    expect(payload).toMatchObject({
      customer: {
        id: customerId,
        has_account: true,
        default_billing_address_id: detailCustomer.addresses[0]?.id,
        default_shipping_address_id: detailCustomer.addresses[0]?.id,
        addresses: [{ address_1: "1 Main Street", country_code: "tw" }],
        groups: [{ name: "Wholesale" }],
        recent_orders: [{ display_id: 41, currency_code: "twd" }],
      },
    });
  });

  it("creates a customer through the shared customer write service", async () => {
    const deps = dependencies();
    const response = await handleAdminCustomersRequest(
      new Request("https://morph.test/api/admin/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "customer@example.com",
          first_name: "Lin",
          last_name: "Test",
          metadata: { source: "api" },
        }),
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "customer@example.com",
        firstName: "Lin",
        lastName: "Test",
        metadata: { source: "api" },
      }),
      "admin-user",
    );
    expect(await json(response)).toMatchObject({
      customer: { id: customerId },
    });
  });

  it("updates through POST and archives through DELETE", async () => {
    const deps = dependencies();
    const updated = await handleAdminCustomersRequest(
      new Request(`https://morph.test/api/admin/customers/${customerId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ first_name: "Updated" }),
      }),
      deps,
    );
    const deleted = await handleAdminCustomersRequest(
      new Request(`https://morph.test/api/admin/customers/${customerId}`, {
        method: "DELETE",
      }),
      deps,
    );

    expect(updated.status).toBe(200);
    expect(deps.updateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ id: customerId, firstName: "Updated" }),
    );
    expect(deleted.status).toBe(200);
    expect(await json(deleted)).toEqual({
      id: customerId,
      object: "customer",
      deleted: true,
    });
    expect(deps.archiveCustomer).toHaveBeenCalledWith(customerId);
  });

  it("lists, retrieves, creates, updates and deletes customer addresses", async () => {
    const deps = dependencies();
    const listed = await handleAdminCustomersRequest(
      new Request(
        `https://morph.test/api/admin/customers/${customerId}/addresses?offset=3&limit=10&country_code=TW`,
      ),
      deps,
    );
    const addressId = detailCustomer.addresses[0]!.id;
    const retrieved = await handleAdminCustomersRequest(
      new Request(
        `https://morph.test/api/admin/customers/${customerId}/addresses/${addressId}`,
      ),
      deps,
    );
    const created = await handleAdminCustomersRequest(
      new Request(
        `https://morph.test/api/admin/customers/${customerId}/addresses`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address_name: "Office",
            address_1: "2 Main Street",
            country_code: "TW",
            is_default_shipping: true,
          }),
        },
      ),
      deps,
    );
    const updated = await handleAdminCustomersRequest(
      new Request(
        `https://morph.test/api/admin/customers/${customerId}/addresses/${addressId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ city: "New Taipei" }),
        },
      ),
      deps,
    );
    const deleted = await handleAdminCustomersRequest(
      new Request(
        `https://morph.test/api/admin/customers/${customerId}/addresses/${addressId}`,
        {
          method: "DELETE",
        },
      ),
      deps,
    );

    expect(listed.status).toBe(200);
    expect(deps.listCustomerAddresses).toHaveBeenCalledWith({
      customerId,
      offset: 3,
      limit: 10,
      company: undefined,
      countryCode: "tw",
    });
    expect(await json(retrieved)).toMatchObject({
      address: { id: addressId, customer_id: customerId, metadata: {} },
    });
    expect(created.status).toBe(200);
    expect(deps.createCustomerAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId,
        addressName: "Office",
        address1: "2 Main Street",
        countryCode: "TW",
        isDefaultShipping: true,
      }),
    );
    expect(updated.status).toBe(200);
    expect(deps.updateCustomerAddress).toHaveBeenCalledWith(
      expect.objectContaining({
        id: addressId,
        customerId,
        city: "New Taipei",
      }),
    );
    expect(await json(deleted)).toEqual({
      id: addressId,
      object: "customer_address",
      deleted: true,
    });
  });

  it("batches customer group additions and removals using the authenticated actor", async () => {
    const deps = dependencies();
    const response = await handleAdminCustomersRequest(
      new Request(
        `https://morph.test/api/admin/customers/${customerId}/customer-groups`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            add: [detailCustomer.groups[0]!.id],
            remove: [],
          }),
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.batchCustomerGroups).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId,
        addGroupIds: [detailCustomer.groups[0]!.id],
        removeGroupIds: [],
        createdBy: "admin-user",
      }),
    );
    expect(await json(response)).toMatchObject({
      customer: { groups: [{ name: "Wholesale" }] },
    });
  });

  it("returns not found and rejects malformed customer IDs", async () => {
    const missing = dependencies({
      findCustomer: vi.fn(async () => null),
    });
    const notFound = await handleAdminCustomersRequest(
      new Request(`https://morph.test/api/admin/customers/${customerId}`),
      missing,
    );
    const invalid = await handleAdminCustomersRequest(
      new Request("https://morph.test/api/admin/customers/not-a-uuid"),
      dependencies(),
    );
    expect(notFound.status).toBe(404);
    expect(invalid.status).toBe(400);
  });

  it("requires the same authenticated commerce access as other Admin API resources", async () => {
    const deps = dependencies({
      authorize: vi.fn(async () => ({
        allowed: false as const,
        status: 403 as const,
        error: "FORBIDDEN" as const,
        message: "Commerce access required",
      })),
    });
    const response = await handleAdminCustomersRequest(
      new Request("https://morph.test/api/admin/customers"),
      deps,
    );
    expect(response.status).toBe(403);
    expect(deps.listCustomers).not.toHaveBeenCalled();
  });
});
