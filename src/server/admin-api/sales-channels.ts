import type {
  SalesChannelDTO,
  SalesChannelSummaryDTO,
} from "@/lib/sales-channel/dto/sales-channel.dto";
import type {
  CreateSalesChannelInput,
  SalesChannelWriteResult,
  UpdateSalesChannelInput,
  UpdateSalesChannelProductsInput,
} from "@/lib/sales-channel/service/sales-channel-write.service";
import { SALES_CHANNEL_TYPES } from "@/lib/sales-channel/types";
import type { AdminApiAccess } from "./orders";
import {
  createSalesChannelInputSchema,
  updateSalesChannelInputSchema,
} from "@/lib/validations/sales-channel";
import { z } from "zod";

export type AdminSalesChannelsApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  listSalesChannels(input: {
    query?: string;
    type?: SalesChannelDTO["type"];
    isDisabled?: boolean;
    sortBy: "name" | "createdAt" | "updatedAt";
    sortOrder: "asc" | "desc";
    page: number;
    limit: number;
    offset: number;
  }): Promise<{ channels: SalesChannelSummaryDTO[]; total: number }>;
  findSalesChannel(id: string): Promise<SalesChannelDTO | null>;
  countProducts(channelIds: string[]): Promise<Map<string, number>>;
  getDefaultSalesChannelId(): Promise<string | null>;
  createSalesChannel(
    input: CreateSalesChannelInput,
  ): Promise<SalesChannelWriteResult>;
  updateSalesChannel(
    input: UpdateSalesChannelInput,
  ): Promise<SalesChannelWriteResult>;
  deleteSalesChannels(input: {
    ids: string[];
  }): Promise<SalesChannelWriteResult>;
  addProducts(
    input: UpdateSalesChannelProductsInput,
  ): Promise<SalesChannelWriteResult>;
  removeProducts(
    input: UpdateSalesChannelProductsInput,
  ): Promise<SalesChannelWriteResult>;
};

const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    type: z.enum(SALES_CHANNEL_TYPES).optional(),
    is_disabled: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    order: z
      .enum([
        "created_at",
        "-created_at",
        "updated_at",
        "-updated_at",
        "name",
        "-name",
      ])
      .default("-created_at"),
  })
  .strict()
  .transform((input) => ({
    query: input.q || undefined,
    type: input.type,
    isDisabled: input.is_disabled,
    offset: input.offset,
    limit: input.limit,
    page: Math.floor(input.offset / input.limit) + 1,
    sortBy: input.order.includes("updated_at")
      ? ("updatedAt" as const)
      : input.order.includes("name")
        ? ("name" as const)
        : ("createdAt" as const),
    sortOrder: input.order.startsWith("-")
      ? ("desc" as const)
      : ("asc" as const),
  }));

const createBodySchema = z
  .object({
    name: z.unknown().optional(),
    type: z.unknown().optional(),
    description: z.unknown().optional(),
    is_disabled: z.unknown().optional(),
    metadata: z.unknown().optional(),
  })
  .strict();

const updateBodySchema = z
  .object({
    name: z.unknown().optional(),
    description: z.unknown().optional(),
    is_disabled: z.unknown().optional(),
    metadata: z.unknown().optional(),
  })
  .strict();

const productBatchBodySchema = z
  .object({
    product_ids: z
      .array(z.object({ id: z.uuid() }).strict())
      .min(1)
      .max(100),
  })
  .strict();

const channelIdSchema = z.uuid();

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

const toApi = (
  channel: SalesChannelDTO,
  isDefault: boolean,
  productCount: number,
) => ({
  id: channel.id,
  name: channel.name,
  type: channel.type,
  description: channel.description,
  is_disabled: channel.isDisabled,
  is_default: isDefault,
  product_count: productCount,
  metadata: channel.metadata,
  created_at: channel.createdAt,
  updated_at: channel.updatedAt,
});

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const authorizeAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const writeFailure = (
  result: Extract<SalesChannelWriteResult, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "DUPLICATE_NAME" || result.error === "DEFAULT_CHANNEL"
        ? 409
        : result.errors || result.error === "INVALID_INPUT"
          ? 400
          : 500;
  return privateJson(
    {
      error: result.error ?? "INTERNAL_ERROR",
      message: result.message,
      ...(result.errors ? { details: result.errors } : {}),
    },
    status,
  );
};

const readBodyInput = (raw: unknown) => {
  const parsed = createBodySchema.safeParse(raw);
  if (!parsed.success) {
    return {
      success: false as const,
      response: privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid sales channel fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      ),
    };
  }
  return {
    success: true as const,
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      description: parsed.data.description,
      isDisabled: parsed.data.is_disabled,
      metadata: parsed.data.metadata,
    },
  };
};

const loadChannelResponse = async (
  id: string,
  dependencies: AdminSalesChannelsApiDependencies,
) => {
  const channel = await dependencies.findSalesChannel(id);
  if (!channel) return routeError("NOT_FOUND", "Sales channel not found", 404);
  const [counts, defaultId] = await Promise.all([
    dependencies.countProducts([id]),
    dependencies.getDefaultSalesChannelId(),
  ]);
  return privateJson({
    sales_channel: toApi(
      channel,
      channel.id === defaultId,
      counts.get(id) ?? 0,
    ),
  });
};

/** Medusa-shaped Sales Channel REST routes backed by Morph's commerce DAL and write service. */
export async function handleAdminSalesChannelsRequest(
  request: Request,
  path: string,
  dependencies: AdminSalesChannelsApiDependencies,
): Promise<Response> {
  let access: AdminApiAccess;
  try {
    access = await dependencies.authorize(request);
  } catch {
    return routeError(
      "UNAUTHORIZED",
      "A signed-in commerce user is required",
      401,
    );
  }
  if (!access.allowed)
    return routeError(access.error, access.message, access.status);
  if (!authorizeAdmin(access))
    return routeError("FORBIDDEN", "Administrator access is required", 403);

  const listMatch = path === "sales-channels";
  const itemMatch = /^sales-channels\/([^/]+)$/.exec(path);
  const productBatchMatch = /^sales-channels\/([^/]+)\/products\/batch$/.exec(
    path,
  );

  if (listMatch && request.method === "GET") {
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid sales channels query",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    try {
      const [result, defaultId] = await Promise.all([
        dependencies.listSalesChannels(parsed.data),
        dependencies.getDefaultSalesChannelId(),
      ]);
      return privateJson({
        sales_channels: result.channels.map((channel) =>
          toApi(channel, channel.id === defaultId, channel.productCount ?? 0),
        ),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Sales channels could not be loaded",
        500,
      );
    }
  }

  if (listMatch && request.method === "POST") {
    const raw = await readJson(request);
    if (raw === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const normalized = readBodyInput(raw);
    if (!normalized.success) return normalized.response;
    const parsed = createSalesChannelInputSchema.safeParse(normalized.data);
    if (!parsed.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid sales channel fields",
          details: parsed.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const result = await dependencies.createSalesChannel(parsed.data);
    if (!result.success) return writeFailure(result);
    if (!result.data.id)
      return routeError(
        "INTERNAL_ERROR",
        "Created sales channel ID is missing",
        500,
      );
    let response: Response;
    try {
      response = await loadChannelResponse(result.data.id, dependencies);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "Created sales channel could not be loaded",
        500,
      );
    }
    if (response.status !== 200) return response;
    return new Response(response.body, {
      status: 201,
      headers: response.headers,
    });
  }

  if (
    productBatchMatch &&
    (request.method === "POST" || request.method === "DELETE")
  ) {
    const parsedId = channelIdSchema.safeParse(productBatchMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid sales channel ID", 400);
    const raw = await readJson(request);
    if (raw === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsedBody = productBatchBodySchema.safeParse(raw);
    if (!parsedBody.success) {
      return privateJson(
        {
          error: "INVALID_REQUEST",
          message: "Invalid product_ids fields",
          details: parsedBody.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const input: UpdateSalesChannelProductsInput = {
      salesChannelId: parsedId.data,
      productIds: [
        ...new Set(parsedBody.data.product_ids.map((product) => product.id)),
      ],
    };
    const result =
      request.method === "POST"
        ? await dependencies.addProducts(input)
        : await dependencies.removeProducts(input);
    if (!result.success) return writeFailure(result);
    return privateJson({
      sales_channel_id: parsedId.data,
      product_ids: input.productIds,
      ...(request.method === "POST"
        ? { added: input.productIds.length }
        : { removed: input.productIds.length }),
    });
  }

  if (itemMatch) {
    const parsedId = channelIdSchema.safeParse(itemMatch[1] ?? "");
    if (!parsedId.success)
      return routeError("INVALID_REQUEST", "Invalid sales channel ID", 400);
    if (request.method === "GET") {
      try {
        return await loadChannelResponse(parsedId.data, dependencies);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Sales channel could not be loaded",
          500,
        );
      }
    }
    if (request.method === "POST") {
      const raw = await readJson(request);
      if (raw === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const parsedRaw = updateBodySchema.safeParse(raw);
      if (!parsedRaw.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid sales channel fields",
            details: parsedRaw.error.flatten().fieldErrors,
          },
          400,
        );
      }
      const input = {
        id: parsedId.data,
        ...(parsedRaw.data.name === undefined
          ? {}
          : { name: parsedRaw.data.name }),
        ...(parsedRaw.data.description === undefined
          ? {}
          : { description: parsedRaw.data.description }),
        ...(parsedRaw.data.is_disabled === undefined
          ? {}
          : { isDisabled: parsedRaw.data.is_disabled }),
        ...(parsedRaw.data.metadata === undefined
          ? {}
          : { metadata: parsedRaw.data.metadata }),
      };
      const parsed = updateSalesChannelInputSchema.safeParse(input);
      if (!parsed.success) {
        return privateJson(
          {
            error: "INVALID_REQUEST",
            message: "Invalid sales channel fields",
            details: parsed.error.flatten().fieldErrors,
          },
          400,
        );
      }
      const result = await dependencies.updateSalesChannel(parsed.data);
      if (!result.success) return writeFailure(result);
      try {
        return await loadChannelResponse(parsedId.data, dependencies);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "Sales channel could not be loaded",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      const result = await dependencies.deleteSalesChannels({
        ids: [parsedId.data],
      });
      if (!result.success) return writeFailure(result);
      return privateJson({
        id: parsedId.data,
        object: "sales_channel",
        deleted: true,
      });
    }
  }

  if (listMatch || itemMatch || productBatchMatch) {
    const allow = productBatchMatch
      ? "POST, DELETE"
      : itemMatch
        ? "GET, POST, DELETE"
        : "GET, POST";
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: `Use ${allow}` }),
      {
        status: 405,
        headers: {
          allow: allow,
          "cache-control": "private, no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      },
    );
  }
  return routeError("NOT_FOUND", "Admin API route not found", 404);
}
