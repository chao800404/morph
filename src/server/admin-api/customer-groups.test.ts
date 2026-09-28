import { describe, expect, it, vi } from "vitest";
import type {
  CustomerGroupDetailDTO,
  CustomerGroupListItemDTO,
  CustomerGroupMemberDTO,
} from "@/lib/customer/dto/customer-group.dto";
import {
  handleAdminCustomerGroupsRequest,
  type AdminCustomerGroupsApiDependencies,
} from "./customer-groups";

const groupId = "c9f3cc07-9a22-4c85-9b7d-0a5b7a8f23a0";
const customerId = "6fa459ea-ee8a-3ca4-894e-db77e160355e";
const group: CustomerGroupDetailDTO = {
  id: groupId,
  name: "Wholesale",
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  customerCount: 1,
  metadata: { tier: "b2b" },
};
const listGroup: CustomerGroupListItemDTO = group;
const member: CustomerGroupMemberDTO = {
  id: customerId,
  email: "customer@example.com",
  firstName: "Lin",
  lastName: "Test",
  companyName: null,
  createdAt: "2026-09-26T00:00:00.000Z",
};

const dependencies = (
  overrides: Partial<AdminCustomerGroupsApiDependencies> = {},
): AdminCustomerGroupsApiDependencies => ({
  authorize: vi.fn(async () => ({
    allowed: true as const,
    userId: "admin-user",
    role: "admin",
  })),
  listGroups: vi.fn(async () => ({ groups: [listGroup], total: 1 })),
  findGroup: vi.fn(async () => group),
  findActiveGroupByName: vi.fn(async () => null),
  createGroup: vi.fn(async () => groupId),
  updateGroup: vi.fn(async () => true),
  archiveGroup: vi.fn(async () => true),
  listGroupMembers: vi.fn(async () => ({ customers: [member], total: 1 })),
  batchCustomersForGroup: vi.fn(async () => "updated" as const),
  ...overrides,
});

const json = (response: Response) => response.json() as Promise<unknown>;

describe("Medusa-shaped Admin customer groups API", () => {
  it("lists groups with offset pagination and snake_case response fields", async () => {
    const deps = dependencies();
    const response = await handleAdminCustomerGroupsRequest(
      new Request(
        "https://morph.test/api/admin/customer-groups?q=whole&offset=20&limit=10&order=name",
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.listGroups).toHaveBeenCalledWith({
      query: "whole",
      offset: 20,
      limit: 10,
      sortBy: "name",
      sortOrder: "asc",
      page: 3,
    });
    expect(await json(response)).toMatchObject({
      customer_groups: [
        {
          id: groupId,
          name: "Wholesale",
          customer_count: 1,
          metadata: { tier: "b2b" },
        },
      ],
      offset: 20,
      limit: 10,
      count: 1,
    });
  });

  it("creates and updates a group with actor context and conflict handling", async () => {
    const deps = dependencies();
    const created = await handleAdminCustomerGroupsRequest(
      new Request("https://morph.test/api/admin/customer-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Wholesale", metadata: { tier: "b2b" } }),
      }),
      deps,
    );
    const updated = await handleAdminCustomerGroupsRequest(
      new Request(`https://morph.test/api/admin/customer-groups/${groupId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Partners" }),
      }),
      deps,
    );
    const duplicate = await handleAdminCustomerGroupsRequest(
      new Request("https://morph.test/api/admin/customer-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Taken" }),
      }),
      dependencies({
        findActiveGroupByName: vi.fn(async () => ({ id: groupId })),
      }),
    );

    expect(created.status).toBe(200);
    expect(deps.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Wholesale", createdBy: "admin-user" }),
    );
    expect(updated.status).toBe(200);
    expect(deps.updateGroup).toHaveBeenCalledWith(
      groupId,
      { name: "Partners" },
      expect.any(String),
    );
    expect(duplicate.status).toBe(409);
  });

  it("lists members and applies add/remove changes through one batch dependency", async () => {
    const deps = dependencies();
    const listed = await handleAdminCustomerGroupsRequest(
      new Request(
        `https://morph.test/api/admin/customer-groups/${groupId}/customers?offset=10&limit=5`,
      ),
      deps,
    );
    const changed = await handleAdminCustomerGroupsRequest(
      new Request(
        `https://morph.test/api/admin/customer-groups/${groupId}/customers`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ add: [customerId], remove: [] }),
        },
      ),
      deps,
    );

    expect(listed.status).toBe(200);
    expect(await json(listed)).toMatchObject({
      customers: [{ id: customerId, first_name: "Lin" }],
      count: 1,
    });
    expect(deps.listGroupMembers).toHaveBeenCalledWith({
      groupId,
      query: undefined,
      page: 3,
      limit: 5,
      offset: 10,
    });
    expect(changed.status).toBe(200);
    expect(deps.batchCustomersForGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId,
        addCustomerIds: [customerId],
        removeCustomerIds: [],
        createdBy: "admin-user",
      }),
    );
  });

  it("deletes groups without deleting customers and honors authorization", async () => {
    const deps = dependencies();
    const deleted = await handleAdminCustomerGroupsRequest(
      new Request(`https://morph.test/api/admin/customer-groups/${groupId}`, {
        method: "DELETE",
      }),
      deps,
    );
    const denied = await handleAdminCustomerGroupsRequest(
      new Request("https://morph.test/api/admin/customer-groups"),
      dependencies({
        authorize: vi.fn(async () => ({
          allowed: false as const,
          status: 403 as const,
          error: "FORBIDDEN" as const,
          message: "Commerce access required",
        })),
      }),
    );

    expect(await json(deleted)).toEqual({
      id: groupId,
      object: "customer_group",
      deleted: true,
    });
    expect(deps.archiveGroup).toHaveBeenCalledWith(groupId, expect.any(String));
    expect(denied.status).toBe(403);
  });
});
