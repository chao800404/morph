import type {
  CustomerDetailDTO,
  CustomerListItemDTO,
} from "@/lib/customer/dto/customer.dto";
import type { AdminApiAccess } from "./orders";
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
} from "@/lib/customer/service/customer-write.service";
import type { CustomerAddressDTO } from "@/lib/customer/dto/customer.dto";
import {
  createCustomerAddressInputSchema,
  createCustomerInputSchema,
  updateCustomerAddressInputSchema,
  updateCustomerInputSchema,
} from "@/lib/validations/customer";
import { CustomerWriteError } from "@/lib/customer/service/customer-write.service";
import { z } from "zod";

export type AdminCustomersApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listCustomers(input: {
    query?: string;
    id?: string;
    email?: string;
    hasAccount?: boolean;
    sortBy: "createdAt" | "email";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ customers: CustomerListItemDTO[]; total: number }>;
  findCustomer(id: string): Promise<CustomerDetailDTO | null>;
  createCustomer(
    input: CreateCustomerInput,
    actorId: string,
  ): Promise<{ id: string }>;
  updateCustomer(input: UpdateCustomerInput): Promise<{ id: string }>;
  archiveCustomer(id: string): Promise<{ deleted: number }>;
  listCustomerAddresses(input: {
    customerId: string;
    offset: number;
    limit: number;
    company?: string;
    countryCode?: string;
  }): Promise<{ addresses: CustomerAddressDTO[]; total: number } | null>;
  findCustomerAddress(input: {
    id: string;
    customerId: string;
  }): Promise<CustomerAddressDTO | null>;
  createCustomerAddress(
    input: z.infer<typeof createCustomerAddressInputSchema>,
  ): Promise<{ id: string }>;
  updateCustomerAddress(
    input: z.infer<typeof updateCustomerAddressInputSchema>,
  ): Promise<{ id: string }>;
  archiveCustomerAddress(input: {
    id: string;
    customerId: string;
  }): Promise<{ id: string }>;
  batchCustomerGroups(input: {
    customerId: string;
    addGroupIds: string[];
    removeGroupIds: string[];
    createdBy: string;
    now: string;
  }): Promise<"updated" | "invalid-customer" | "invalid-group">;
};

const customerWriteBodySchema = z
  .object({
    email: z.string().max(320).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    company_name: z.string().max(200).optional(),
    phone: z.string().max(50).optional(),
    metadata: z.unknown().optional(),
  })
  .strict()
  .transform((input) => ({
    email: input.email,
    firstName: input.first_name,
    lastName: input.last_name,
    companyName: input.company_name,
    phone: input.phone,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  }));

const listCustomersQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    id: z.uuid().optional(),
    email: z.email().trim().toLowerCase().max(320).optional(),
    has_account: z
      .enum(["true", "false"])
      .optional()
      .transform((value) =>
        value === undefined ? undefined : value === "true",
      ),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum(["created_at", "-created_at", "email", "-email"])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    id: input.id,
    email: input.email,
    hasAccount: input.has_account,
    offset: input.offset,
    limit: input.limit,
    sortBy: input.order.includes("email")
      ? ("email" as const)
      : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const addressBodySchema = z
  .object({
    address_name: z.string().max(100).optional(),
    is_default_shipping: z.boolean().optional(),
    is_default_billing: z.boolean().optional(),
    company: z.string().max(200).optional(),
    first_name: z.string().max(100).optional(),
    last_name: z.string().max(100).optional(),
    address_1: z.string().max(300).optional(),
    address_2: z.string().max(300).optional(),
    city: z.string().max(150).optional(),
    country_code: z.string().max(2).optional(),
    province: z.string().max(150).optional(),
    postal_code: z.string().max(40).optional(),
    phone: z.string().max(50).optional(),
    metadata: z.unknown().optional(),
  })
  .strict()
  .transform((input) => ({
    addressName: input.address_name,
    isDefaultShipping: input.is_default_shipping,
    isDefaultBilling: input.is_default_billing,
    company: input.company,
    firstName: input.first_name,
    lastName: input.last_name,
    address1: input.address_1,
    address2: input.address_2,
    city: input.city,
    countryCode: input.country_code,
    province: input.province,
    postalCode: input.postal_code,
    phone: input.phone,
    metadata: input.metadata,
  }));

const listCustomerAddressesQuerySchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    company: z.string().trim().max(200).optional(),
    country_code: z.string().trim().max(2).toLowerCase().optional(),
  })
  .strict()
  .transform((input) => ({
    offset: input.offset,
    limit: input.limit,
    company: input.company,
    countryCode: input.country_code,
  }));

const batchCustomerGroupsSchema = z
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
    "Customer group IDs must be unique and cannot be added and removed together",
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

const addressToApi = (address: CustomerDetailDTO["addresses"][number]) => ({
  id: address.id,
  address_name: address.addressName,
  is_default_shipping: address.isDefaultShipping,
  is_default_billing: address.isDefaultBilling,
  customer_id: address.customerId,
  company: address.company,
  first_name: address.firstName,
  last_name: address.lastName,
  address_1: address.address1,
  address_2: address.address2,
  city: address.city,
  country_code: address.countryCode,
  province: address.province,
  postal_code: address.postalCode,
  phone: address.phone,
  metadata: address.metadata,
  created_at: address.createdAt,
  updated_at: address.updatedAt,
});

const customerListToApi = (customer: CustomerListItemDTO) => ({
  id: customer.id,
  email: customer.email,
  first_name: customer.firstName,
  last_name: customer.lastName,
  company_name: customer.companyName,
  phone: customer.phone,
  has_account: customer.hasAccount,
  order_count: customer.orderCount,
  created_at: customer.createdAt,
  updated_at: customer.updatedAt,
});

const customerDetailToApi = (customer: CustomerDetailDTO) => ({
  ...customerListToApi(customer),
  metadata: customer.metadata,
  default_billing_address_id:
    customer.addresses.find((address) => address.isDefaultBilling)?.id ?? null,
  default_shipping_address_id:
    customer.addresses.find((address) => address.isDefaultShipping)?.id ?? null,
  addresses: customer.addresses.map(addressToApi),
  groups: customer.groups.map((group) => ({ id: group.id, name: group.name })),
  recent_orders: customer.recentOrders.map((order) => ({
    id: order.id,
    display_id: order.displayId,
    status: order.status,
    total: order.total,
    currency_code: order.currencyCode,
    created_at: order.createdAt,
  })),
});

const readCustomerWriteBody = async (request: Request) => {
  try {
    const body: unknown = await request.json();
    return customerWriteBodySchema.safeParse(body);
  } catch {
    return null;
  }
};

/** Medusa-shaped Admin customer endpoints backed by the Customer DAL. */
export async function handleAdminCustomersRequest(
  request: Request,
  dependencies: AdminCustomersApiDependencies,
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
  const customerMatch = /^customers\/([^/]+)$/.exec(path);
  const customerAddressListMatch = /^customers\/([^/]+)\/addresses$/.exec(path);
  const customerAddressMatch = /^customers\/([^/]+)\/addresses\/([^/]+)$/.exec(
    path,
  );
  const customerGroupsMatch = /^customers\/([^/]+)\/customer-groups$/.exec(
    path,
  );

  if (customerGroupsMatch) {
    const customerId = z.uuid().safeParse(customerGroupsMatch[1] ?? "");
    if (!customerId.success)
      return routeError("INVALID_REQUEST", "Invalid customer ID", 400);
    if (request.method !== "POST")
      return new Response(
        JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Use POST" }),
        {
          status: 405,
          headers: {
            allow: "POST",
            "cache-control": "private, no-store",
            "content-type": "application/json; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        },
      );
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    }
    const body = batchCustomerGroupsSchema.safeParse(rawBody);
    if (!body.success)
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer group changes",
          details: body.error.flatten().fieldErrors,
        },
        400,
      );
    if (!access.userId)
      return routeError(
        "FORBIDDEN",
        "An actor is required to assign groups",
        403,
      );
    try {
      const result = await dependencies.batchCustomerGroups({
        customerId: customerId.data,
        addGroupIds: body.data.add,
        removeGroupIds: body.data.remove,
        createdBy: access.userId,
        now: new Date().toISOString(),
      });
      if (result === "invalid-customer")
        return routeError("NOT_FOUND", "Customer not found", 404);
      if (result === "invalid-group")
        return routeError(
          "CUSTOMER_GROUP_NOT_FOUND",
          "One or more customer groups were not found",
          404,
        );
      const customer = await dependencies.findCustomer(customerId.data);
      return customer
        ? privateJson({ customer: customerDetailToApi(customer) })
        : routeError("NOT_FOUND", "Customer not found", 404);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Customer groups could not be updated",
        500,
      );
    }
  }

  if (
    customerAddressListMatch &&
    (request.method === "GET" || request.method === "POST")
  ) {
    const customerId = z.uuid().safeParse(customerAddressListMatch[1] ?? "");
    if (!customerId.success)
      return routeError("INVALID_REQUEST", "Invalid customer ID", 400);

    if (request.method === "GET") {
      const query = listCustomerAddressesQuerySchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams.entries()),
      );
      if (!query.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid customer address list query",
            details: query.error.flatten().fieldErrors,
          },
          400,
        );
      }
      try {
        const result = await dependencies.listCustomerAddresses({
          customerId: customerId.data,
          ...query.data,
        });
        return result
          ? privateJson({
              addresses: result.addresses.map(addressToApi),
              count: result.total,
              offset: query.data.offset,
              limit: query.data.limit,
            })
          : routeError("NOT_FOUND", "Customer not found", 404);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Addresses could not be loaded",
          500,
        );
      }
    }

    let rawBody: unknown;
    try {
      rawBody = await request.clone().json();
    } catch {
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    }
    const parsedBody = addressBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer address fields",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const parsedInput = createCustomerAddressInputSchema.safeParse({
      ...parsedBody.data,
      customerId: customerId.data,
    });
    if (!parsedInput.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer address fields",
          details: parsedInput.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      await dependencies.createCustomerAddress(parsedInput.data);
      const customer = await dependencies.findCustomer(customerId.data);
      return customer
        ? privateJson({ customer: customerDetailToApi(customer) })
        : routeError("NOT_FOUND", "Customer not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Address could not be created", 500);
    }
  }

  if (customerAddressMatch) {
    const customerId = z.uuid().safeParse(customerAddressMatch[1] ?? "");
    const addressId = z.uuid().safeParse(customerAddressMatch[2] ?? "");
    if (!customerId.success || !addressId.success)
      return routeError("INVALID_REQUEST", "Invalid customer address ID", 400);

    if (request.method === "GET") {
      try {
        const address = await dependencies.findCustomerAddress({
          id: addressId.data,
          customerId: customerId.data,
        });
        return address
          ? privateJson({ address: addressToApi(address) })
          : routeError("NOT_FOUND", "Customer address not found", 404);
      } catch {
        return routeError("INTERNAL_ERROR", "Address could not be loaded", 500);
      }
    }

    if (request.method === "POST") {
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      }
      const parsedBody = addressBodySchema.safeParse(rawBody);
      if (!parsedBody.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid customer address fields",
            details: parsedBody.error.flatten().fieldErrors,
          },
          400,
        );
      }
      const parsedInput = updateCustomerAddressInputSchema.safeParse({
        ...parsedBody.data,
        id: addressId.data,
        customerId: customerId.data,
      });
      if (!parsedInput.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid customer address fields",
            details: parsedInput.error.flatten().fieldErrors,
          },
          400,
        );
      }
      try {
        await dependencies.updateCustomerAddress(parsedInput.data);
        const customer = await dependencies.findCustomer(customerId.data);
        return customer
          ? privateJson({ customer: customerDetailToApi(customer) })
          : routeError("NOT_FOUND", "Customer not found", 404);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "CustomerAddressWriteError"
        )
          return routeError("NOT_FOUND", error.message, 404);
        return routeError(
          "INTERNAL_ERROR",
          "Address could not be updated",
          500,
        );
      }
    }

    if (request.method === "DELETE") {
      try {
        await dependencies.archiveCustomerAddress({
          id: addressId.data,
          customerId: customerId.data,
        });
        return privateJson({
          id: addressId.data,
          object: "customer_address",
          deleted: true,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "CustomerAddressWriteError"
        )
          return routeError("NOT_FOUND", error.message, 404);
        return routeError(
          "INTERNAL_ERROR",
          "Address could not be deleted",
          500,
        );
      }
    }

    return new Response(
      JSON.stringify({
        error: "METHOD_NOT_ALLOWED",
        message: "Use GET, POST, DELETE",
      }),
      {
        status: 405,
        headers: {
          allow: "GET, POST, DELETE",
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  if (request.method === "GET" && path === "customers") {
    const url = new URL(request.url);
    const parsed = listCustomersQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer list query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const result = await dependencies.listCustomers({
        ...parsed.data,
        page: Math.floor(parsed.data.offset / parsed.data.limit) + 1,
      });
      return privateJson({
        customers: result.customers.map(customerListToApi),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "Customers could not be loaded", 500);
    }
  }

  if (request.method === "GET" && customerMatch) {
    const parsedId = z.uuid().safeParse(customerMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid customer ID", 400);
    try {
      const customer = await dependencies.findCustomer(parsedId.data);
      return customer
        ? privateJson({ customer: customerDetailToApi(customer) })
        : routeError("NOT_FOUND", "Customer not found", 404);
    } catch {
      return routeError("INTERNAL_ERROR", "Customer could not be loaded", 500);
    }
  }

  if (request.method === "POST" && (path === "customers" || customerMatch)) {
    const body = await readCustomerWriteBody(request);
    if (!body) return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    if (!body.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer fields",
          details: body.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const isCreate = path === "customers";
    const pathId = isCreate
      ? null
      : z.uuid().safeParse(customerMatch?.[1] ?? "");
    if (pathId && !pathId.success)
      return routeError("INVALID_REQUEST", "Invalid customer ID", 400);
    const parsedInput = isCreate
      ? createCustomerInputSchema.safeParse(body.data)
      : updateCustomerInputSchema.safeParse({
          ...body.data,
          id: pathId?.data,
        });
    if (!parsedInput.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid customer fields",
          details: parsedInput.error.flatten().fieldErrors,
        },
        400,
      );
    }
    if (isCreate && !access.userId)
      return routeError(
        "FORBIDDEN",
        "An actor is required to create a customer",
        403,
      );

    try {
      const customer = isCreate
        ? await dependencies.createCustomer(
            parsedInput.data as CreateCustomerInput,
            access.userId!,
          )
        : await dependencies.updateCustomer(
            parsedInput.data as UpdateCustomerInput,
          );
      const detail = await dependencies.findCustomer(customer.id);
      return detail
        ? privateJson({ customer: customerDetailToApi(detail) })
        : routeError(
            "INTERNAL_ERROR",
            "Customer could not be loaded after saving",
            500,
          );
    } catch (error) {
      if (error instanceof CustomerWriteError) {
        const status = error.code === "NOT_FOUND" ? 404 : 409;
        return routeError(error.code, error.message, status);
      }
      return routeError("INTERNAL_ERROR", "Customer could not be saved", 500);
    }
  }

  if (request.method === "DELETE" && customerMatch) {
    const parsedId = z.uuid().safeParse(customerMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid customer ID", 400);
    try {
      await dependencies.archiveCustomer(parsedId.data);
      return privateJson({
        id: parsedId.data,
        object: "customer",
        deleted: true,
      });
    } catch (error) {
      if (error instanceof CustomerWriteError && error.code === "NOT_FOUND")
        return routeError(error.code, error.message, 404);
      return routeError("INTERNAL_ERROR", "Customer could not be deleted", 500);
    }
  }

  if (path === "customers" || customerMatch) {
    const allow = customerMatch ? "GET, POST, DELETE" : "GET, POST";
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: `Use ${allow}` }),
      {
        status: 405,
        headers: {
          allow,
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }

  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
