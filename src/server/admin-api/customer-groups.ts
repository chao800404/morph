import type {
  CustomerGroupDetailDTO,
  CustomerGroupListItemDTO,
  CustomerGroupMemberDTO,
} from "@/lib/customer/dto/customer-group.dto";
import type { AdminApiAccess } from "./orders";
import {
  createCustomerGroupInputSchema,
  updateCustomerGroupInputSchema,
} from "@/lib/validations/customer";
import { z } from "zod";

type GroupWriteInput = {
  name?: string;
  metadata?: CustomerGroupDetailDTO["metadata"];
};

export type AdminCustomerGroupsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listGroups(input: {
    query?: string;
    sortBy: "createdAt" | "name";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ groups: CustomerGroupListItemDTO[]; total: number }>;
  findGroup(id: string): Promise<CustomerGroupDetailDTO | null>;
  findActiveGroupByName(
    name: string,
    excludeId?: string,
  ): Promise<{ id: string } | null>;
  createGroup(input: {
    id: string;
    name: string;
    metadata: CustomerGroupDetailDTO["metadata"];
    createdBy: string;
    now: string;
  }): Promise<string>;
  updateGroup(
    id: string,
    input: GroupWriteInput,
    now: string,
  ): Promise<boolean>;
  archiveGroup(id: string, now: string): Promise<boolean>;
  listGroupMembers(input: {
    groupId: string;
    query?: string;
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ customers: CustomerGroupMemberDTO[]; total: number }>;
  batchCustomersForGroup(input: {
    groupId: string;
    addCustomerIds: string[];
    removeCustomerIds: string[];
    createdBy: string;
    now: string;
  }): Promise<"updated" | "invalid-group" | "invalid-customer">;
};

const listGroupsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum(["created_at", "-created_at", "name", "-name"])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("name")
      ? ("name" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const listMembersQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

const groupWriteBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    metadata: z.unknown().optional(),
  })
  .strict();

const batchCustomersSchema = z
  .object({
    add: z.array(z.uuid()).max(100).default([]),
    remove: z.array(z.uuid()).max(100).default([]),
  })
  .strict()
  .refine(
    ({ add, remove }) =>
      new Set(add).size === add.length &&
      new Set(remove).size === remove.length &&
      !add.some((id) => remove.includes(id)),
    "Customer IDs must be unique and cannot be added and removed together",
  );

const privateJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });

const routeError = (error: string, message: string, status: number) =>
  privateJson({ error, message }, status);

const groupToApi = (
  group: CustomerGroupListItemDTO | CustomerGroupDetailDTO,
) => ({
  id: group.id,
  name: group.name,
  customer_count: group.customerCount,
  ...("metadata" in group ? { metadata: group.metadata } : {}),
  created_at: group.createdAt,
  updated_at: group.updatedAt,
});

const memberToApi = (customer: CustomerGroupMemberDTO) => ({
  id: customer.id,
  email: customer.email,
  first_name: customer.firstName,
  last_name: customer.lastName,
  company_name: customer.companyName,
  created_at: customer.createdAt,
});

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

/** Customer group REST routes backed by the existing Customer Group DAL. */
export async function handleAdminCustomerGroupsRequest(
  request: Request,
  dependencies: AdminCustomerGroupsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    access = {
      allowed: false,
      status: 401,
      error: "UNAUTHORIZED",
      message: "A signed-in commerce user is required",
    };
  }
  if (!access.allowed)
    return routeError(access.error, access.message, access.status);

  const path = new URL(request.url).pathname
    .replace(/^\/api\/admin\/?/, "")
    .replace(/\/$/, "");
  const groupMatch = /^customer-groups\/([^/]+)$/.exec(path);
  const groupCustomersMatch = /^customer-groups\/([^/]+)\/customers$/.exec(
    path,
  );

  if (request.method === "GET" && path === "customer-groups") {
    const query = listGroupsQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!query.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer group list query",
          details: query.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const result = await dependencies.listGroups({
        ...query.data,
        page: Math.floor(query.data.offset / query.data.limit) + 1,
      });
      return privateJson({
        customer_groups: result.groups.map(groupToApi),
        count: result.total,
        offset: query.data.offset,
        limit: query.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Customer groups could not be loaded",
        500,
      );
    }
  }

  if (request.method === "POST" && path === "customer-groups") {
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const body = groupWriteBodySchema.safeParse(rawBody);
    if (!body.success || body.data.name === undefined) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "A customer group name is required",
          details: body.success
            ? { name: ["Required"] }
            : body.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const input = createCustomerGroupInputSchema.safeParse(body.data);
    if (!input.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer group fields",
          details: input.error.flatten().fieldErrors,
        },
        400,
      );
    if (!access.userId)
      return routeError(
        "FORBIDDEN",
        "An actor is required to create a group",
        403,
      );
    try {
      if (await dependencies.findActiveGroupByName(input.data.name))
        return routeError(
          "DUPLICATE_NAME",
          "A customer group with this name already exists",
          409,
        );
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await dependencies.createGroup({
        id,
        ...input.data,
        createdBy: access.userId,
        now,
      });
      const group = await dependencies.findGroup(id);
      return group
        ? privateJson({ customer_group: groupToApi(group) })
        : routeError(
            "INTERNAL_ERROR",
            "Customer group could not be loaded after saving",
            500,
          );
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Customer group could not be created",
        500,
      );
    }
  }

  if (groupCustomersMatch) {
    const id = z.uuid().safeParse(groupCustomersMatch[1] ?? "");
    if (!id.success)
      return routeError("INVALID_REQUEST", "Invalid customer group ID", 400);
    if (request.method === "GET") {
      const query = listMembersQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!query.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid customer group member query",
            details: query.error.flatten().fieldErrors,
          },
          400,
        );
      try {
        const group = await dependencies.findGroup(id.data);
        if (!group)
          return routeError("NOT_FOUND", "Customer group not found", 404);
        const result = await dependencies.listGroupMembers({
          groupId: id.data,
          query: query.data.q,
          page: Math.floor(query.data.offset / query.data.limit) + 1,
          limit: query.data.limit,
          offset: query.data.offset,
        });
        return privateJson({
          customers: result.customers.map(memberToApi),
          count: result.total,
          offset: query.data.offset,
          limit: query.data.limit,
        });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Customer group members could not be loaded",
          500,
        );
      }
    }
    if (request.method === "POST") {
      const rawBody = await readJson(request);
      if (rawBody === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const body = batchCustomersSchema.safeParse(rawBody);
      if (!body.success)
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid customer group member changes",
            details: body.error.flatten().fieldErrors,
          },
          400,
        );
      if (!access.userId)
        return routeError(
          "FORBIDDEN",
          "An actor is required to assign customers",
          403,
        );
      try {
        const result = await dependencies.batchCustomersForGroup({
          groupId: id.data,
          addCustomerIds: body.data.add,
          removeCustomerIds: body.data.remove,
          createdBy: access.userId,
          now: new Date().toISOString(),
        });
        if (result === "invalid-group")
          return routeError("NOT_FOUND", "Customer group not found", 404);
        if (result === "invalid-customer")
          return routeError(
            "CUSTOMER_NOT_FOUND",
            "One or more customers were not found",
            404,
          );
        const group = await dependencies.findGroup(id.data);
        return group
          ? privateJson({ customer_group: groupToApi(group) })
          : routeError("NOT_FOUND", "Customer group not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Customer group members could not be updated",
          500,
        );
      }
    }
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Use GET, POST" }),
      {
        status: 405,
        headers: {
          allow: "GET, POST",
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  if (request.method === "GET" && groupMatch) {
    const id = z.uuid().safeParse(groupMatch[1] ?? "");
    if (!id.success)
      return routeError("INVALID_REQUEST", "Invalid customer group ID", 400);
    try {
      const group = await dependencies.findGroup(id.data);
      return group
        ? privateJson({ customer_group: groupToApi(group) })
        : routeError("NOT_FOUND", "Customer group not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Customer group could not be loaded",
        500,
      );
    }
  }

  if (request.method === "POST" && groupMatch) {
    const id = z.uuid().safeParse(groupMatch[1] ?? "");
    if (!id.success)
      return routeError("INVALID_REQUEST", "Invalid customer group ID", 400);
    const rawBody = await readJson(request);
    if (rawBody === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const body = groupWriteBodySchema.safeParse(rawBody);
    if (!body.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer group fields",
          details: body.error.flatten().fieldErrors,
        },
        400,
      );
    const input = updateCustomerGroupInputSchema.safeParse({
      id: id.data,
      ...body.data,
    });
    if (!input.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer group fields",
          details: input.error.flatten().fieldErrors,
        },
        400,
      );
    try {
      const existing = await dependencies.findGroup(id.data);
      if (!existing)
        return routeError("NOT_FOUND", "Customer group not found", 404);
      if (
        input.data.name &&
        input.data.name !== existing.name &&
        (await dependencies.findActiveGroupByName(input.data.name, id.data))
      )
        return routeError(
          "DUPLICATE_NAME",
          "A customer group with this name already exists",
          409,
        );
      const { id: groupId, ...fields } = input.data;
      const updated = await dependencies.updateGroup(
        groupId,
        fields,
        new Date().toISOString(),
      );
      if (!updated)
        return routeError("NOT_FOUND", "Customer group not found", 404);
      const group = await dependencies.findGroup(groupId);
      return group
        ? privateJson({ customer_group: groupToApi(group) })
        : routeError("NOT_FOUND", "Customer group not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Customer group could not be updated",
        500,
      );
    }
  }

  if (request.method === "DELETE" && groupMatch) {
    const id = z.uuid().safeParse(groupMatch[1] ?? "");
    if (!id.success)
      return routeError("INVALID_REQUEST", "Invalid customer group ID", 400);
    try {
      const deleted = await dependencies.archiveGroup(
        id.data,
        new Date().toISOString(),
      );
      return deleted
        ? privateJson({ id: id.data, object: "customer_group", deleted: true })
        : routeError("NOT_FOUND", "Customer group not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Customer group could not be deleted",
        500,
      );
    }
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
