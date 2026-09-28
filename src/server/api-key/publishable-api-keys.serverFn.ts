import { apiKeyDal } from "@/lib/api-key/dal/api-key.dal";
import { apiKeyWriteService } from "@/lib/api-key/service/api-key-write.service";
import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import {
  createPublishableApiKeyInputSchema,
  revokePublishableApiKeyInputSchema,
} from "@/lib/validations/api-key";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const listPublishableApiKeys = createServerFn({ method: "GET" })
  .middleware([commerceAdminMiddleware])
  .handler(async () => {
    try {
      return ok("Publishable API keys fetched", {
        keys: await apiKeyDal.listPublishable(),
      });
    } catch (error) {
      return failure(
        "List publishable API keys error",
        error,
        "LIST_FAILED",
        "Failed to fetch publishable API keys",
      );
    }
  });

export const createPublishableApiKey = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(createPublishableApiKeyInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await apiKeyWriteService.create({
        title: data.title,
        createdBy: context.user.id,
        salesChannelIds: data.salesChannelIds,
        type: "publishable",
      });
      if (!result.success) return result;
      return ok(
        "Publishable API key created. Copy it now; it cannot be shown again.",
        {
          id: result.data.id,
          token: result.data.token,
          redacted: result.data.redacted,
        },
      );
    } catch (error) {
      return failure(
        "Create publishable API key error",
        error,
        "CREATE_FAILED",
        "Failed to create publishable API key",
      );
    }
  });

export const revokePublishableApiKey = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(revokePublishableApiKeyInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const result = await apiKeyWriteService.revoke({
        id: data.id,
        actorId: context.user.id,
        expectedType: "publishable",
      });
      return result.success
        ? ok("Publishable API key revoked", { id: data.id })
        : fail("Publishable API key not found or already revoked", {
            error: result.error ?? "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Revoke publishable API key error",
        error,
        "REVOKE_FAILED",
        "Failed to revoke publishable API key",
      );
    }
  });
