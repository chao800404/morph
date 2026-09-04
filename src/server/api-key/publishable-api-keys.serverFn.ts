import { apiKeyDal } from "@/lib/api-key/dal/api-key.dal";
import { createPublishableKey } from "@/lib/api-key/publishable-key";
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
  .validator((data: unknown) => parseInput(createPublishableApiKeyInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      const channelIds = await apiKeyDal.activeSalesChannelIds(
        data.salesChannelIds,
      );
      if (channelIds.length !== new Set(data.salesChannelIds).size)
        return fail(
          "One or more sales channels are disabled or no longer exist",
          { error: "INVALID_SALES_CHANNEL" },
        );
      const key = await createPublishableKey();
      await apiKeyDal.createPublishable({
        id: key.id,
        hash: key.hash,
        salt: key.salt,
        redacted: key.redacted,
        title: data.title,
        createdBy: context.user.id,
        salesChannelIds: channelIds,
      });
      return ok(
        "Publishable API key created. Copy it now; it cannot be shown again.",
        { id: key.id, token: key.token, redacted: key.redacted },
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
  .validator((data: unknown) => parseInput(revokePublishableApiKeyInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    // A rejected precondition is a client error the caller already
    // renders. Letting the ZodError escape the validator instead would
    // reach the browser as an opaque 500 with the reason stripped.
    if (!input.success) return input;
    const data = input.data;

    try {
      return (await apiKeyDal.revoke(data.id, context.user.id))
        ? ok("Publishable API key revoked", { id: data.id })
        : fail("Publishable API key not found or already revoked", {
            error: "NOT_FOUND",
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
