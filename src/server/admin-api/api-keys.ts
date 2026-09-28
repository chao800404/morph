import type { AdminApiKeyDTO } from "@/lib/api-key/dal/api-key.dal";
import type { CreatedApiKey } from "@/lib/api-key/service/api-key-write.service";
import type { ServerResult } from "@/lib/db/server-result";
import {
  createAdminApiKeyBodySchema,
  listAdminApiKeysQuerySchema,
  managePublishableApiKeySalesChannelsBodySchema,
  updateAdminApiKeyBodySchema,
} from "@/lib/validations/api-key";
import type { AdminApiAccess } from "./orders";
import { z } from "zod";

type PageInput = ReturnType<typeof listAdminApiKeysQuerySchema.parse> & {
  createdBy: string;
};

export type AdminApiKeysApiDependencies = {
  authorize(request: Request): Promise<AdminApiAccess>;
  list(input: PageInput): Promise<{ apiKeys: AdminApiKeyDTO[]; total: number }>;
  find(id: string, actorId: string): Promise<AdminApiKeyDTO | null>;
  create(
    input: { title: string; type: "secret" | "publishable" },
    actorId: string,
  ): Promise<ServerResult<CreatedApiKey>>;
  updateTitle(input: {
    id: string;
    actorId: string;
    title: string;
  }): Promise<ServerResult<{ id: string }>>;
  manageSalesChannels(input: {
    id: string;
    actorId: string;
    add: string[];
    remove: string[];
  }): Promise<ServerResult<{ id: string; added: number; removed: number }>>;
  revoke(input: {
    id: string;
    actorId: string;
  }): Promise<ServerResult<{ id: string }>>;
  deleteRevoked(input: {
    id: string;
    actorId: string;
  }): Promise<ServerResult<{ id: string }>>;
};

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

const authorizeAdmin = (
  access: AdminApiAccess,
): access is { allowed: true; userId: string; role: "admin" } =>
  Boolean(access.allowed && access.userId && access.role === "admin");

const readJson = async (request: Request): Promise<unknown | null> => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const apiKey = (key: AdminApiKeyDTO | CreatedApiKey) => ({
  id: key.id,
  ...("token" in key ? { token: key.token } : {}),
  redacted: key.redacted,
  title: key.title,
  type: key.type,
  last_used_at: key.lastUsedAt,
  created_by: key.createdBy,
  created_at: key.createdAt,
  revoked_by: key.revokedBy,
  revoked_at: key.revokedAt,
  updated_at: key.updatedAt,
  deleted_at: key.deletedAt,
  sales_channels: key.salesChannelIds.map((id) => ({ id })),
});

const writeFailure = (
  result: Extract<ServerResult<unknown>, { success: false }>,
) => {
  const status =
    result.error === "NOT_FOUND"
      ? 404
      : result.error === "INVALID_INPUT" ||
          result.error === "INVALID_SALES_CHANNEL"
        ? 400
        : result.error === "ACTIVE_KEY" ||
            result.error === "ALREADY_REVOKED" ||
            result.error === "REVOKED" ||
            result.error === "NOT_FOUND_OR_REVOKED" ||
            result.error === "NOT_FOUND_OR_ACTIVE"
          ? 409
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

const readApiKey = async (
  id: string,
  actorId: string,
  dependencies: AdminApiKeysApiDependencies,
) => {
  const key = await dependencies.find(id, actorId);
  return key
    ? privateJson({ api_key: apiKey(key) })
    : routeError("NOT_FOUND", "API key not found", 404);
};

const readCreatedApiKey = (key: CreatedApiKey) =>
  privateJson({ api_key: apiKey(key) }, 201);

const bodyError = (message: string, details: unknown) =>
  privateJson({ error: "INVALID_REQUEST", message, details }, 400);

const keyIdSchema = z.uuid();

/** Medusa-shaped Admin REST routes for secret and publishable API keys. */
export async function handleAdminApiKeysRequest(
  request: Request,
  path: string,
  dependencies: AdminApiKeysApiDependencies,
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

  const actorId = access.userId;
  const collection = path === "api-keys";
  const item = /^api-keys\/([^/]+)$/.exec(path);
  const revoke = /^api-keys\/([^/]+)\/revoke$/.exec(path);
  const channels = /^api-keys\/([^/]+)\/sales-channels$/.exec(path);
  const id = item?.[1] ?? revoke?.[1] ?? channels?.[1];
  const parsedId = id ? keyIdSchema.safeParse(id) : null;
  if (id && !parsedId?.success)
    return routeError("INVALID_REQUEST", "Invalid API key ID", 400);
  const apiKeyId = parsedId?.success ? parsedId.data : "";
  if (!actorId)
    return routeError("FORBIDDEN", "Administrator access is required", 403);

  if (collection && request.method === "GET") {
    const parsed = listAdminApiKeysQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    if (!parsed.success)
      return bodyError(
        "Invalid API keys query",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.list({
        ...parsed.data,
        createdBy: actorId,
      });
      return privateJson({
        api_keys: result.apiKeys.map(apiKey),
        count: result.total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
      });
    } catch {
      return routeError("INTERNAL_ERROR", "API keys could not be loaded", 500);
    }
  }

  if (collection && request.method === "POST") {
    const raw = await readJson(request);
    if (raw === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed = createAdminApiKeyBodySchema.safeParse(raw);
    if (!parsed.success)
      return bodyError(
        "Invalid API key fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.create(parsed.data, actorId);
      if (!result.success) return writeFailure(result);
      return readCreatedApiKey(result.data);
    } catch {
      return routeError("INTERNAL_ERROR", "API key could not be created", 500);
    }
  }

  if (revoke && request.method === "POST") {
    try {
      const result = await dependencies.revoke({ id: apiKeyId, actorId });
      if (!result.success) return writeFailure(result);
      return await readApiKey(apiKeyId, actorId, dependencies);
    } catch {
      return routeError("INTERNAL_ERROR", "API key could not be revoked", 500);
    }
  }

  if (channels && request.method === "POST") {
    const raw = await readJson(request);
    if (raw === null)
      return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
    const parsed =
      managePublishableApiKeySalesChannelsBodySchema.safeParse(raw);
    if (!parsed.success)
      return bodyError(
        "Invalid sales channel fields",
        parsed.error.flatten().fieldErrors,
      );
    try {
      const result = await dependencies.manageSalesChannels({
        id: apiKeyId,
        actorId,
        add: parsed.data.add,
        remove: parsed.data.remove,
      });
      if (!result.success) return writeFailure(result);
      return await readApiKey(apiKeyId, actorId, dependencies);
    } catch {
      return routeError(
        "INTERNAL_ERROR",
        "API key sales channels could not be updated",
        500,
      );
    }
  }

  if (item) {
    if (request.method === "GET") {
      try {
        return await readApiKey(apiKeyId, actorId, dependencies);
      } catch {
        return routeError("INTERNAL_ERROR", "API key could not be loaded", 500);
      }
    }
    if (request.method === "POST") {
      const raw = await readJson(request);
      if (raw === null)
        return routeError("INVALID_REQUEST", "Invalid JSON body", 400);
      const parsed = updateAdminApiKeyBodySchema.safeParse(raw);
      if (!parsed.success)
        return bodyError(
          "Invalid API key fields",
          parsed.error.flatten().fieldErrors,
        );
      try {
        const result = await dependencies.updateTitle({
          id: apiKeyId,
          actorId,
          title: parsed.data.title,
        });
        if (!result.success) return writeFailure(result);
        return await readApiKey(apiKeyId, actorId, dependencies);
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "API key could not be updated",
          500,
        );
      }
    }
    if (request.method === "DELETE") {
      try {
        const result = await dependencies.deleteRevoked({
          id: apiKeyId,
          actorId,
        });
        if (!result.success) return writeFailure(result);
        return privateJson({ id: apiKeyId, object: "api_key", deleted: true });
      } catch {
        return routeError(
          "INTERNAL_ERROR",
          "API key could not be deleted",
          500,
        );
      }
    }
  }

  if (collection || item || revoke || channels) {
    const allow =
      revoke || channels ? "POST" : item ? "GET, POST, DELETE" : "GET, POST";
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
