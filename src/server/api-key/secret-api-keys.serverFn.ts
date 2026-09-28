import { apiKeyDal } from "@/lib/api-key/dal/api-key.dal";
import { apiKeyWriteService } from "@/lib/api-key/service/api-key-write.service";
import { fail, failure, ok, parseInput } from "@/lib/db/server-result";
import {
  createSecretApiKeyInputSchema,
  deleteSecretApiKeyInputSchema,
  revokeSecretApiKeyInputSchema,
  updateSecretApiKeyTitleInputSchema,
} from "@/lib/validations/api-key";
import { createServerFn } from "@tanstack/react-start";
import { commerceAdminMiddleware } from "../middleware/auth.middleware";

export const listSecretApiKeys = createServerFn({ method: "GET" })
  .middleware([commerceAdminMiddleware])
  .handler(async ({ context }) => {
    try {
      return ok("Secret API keys fetched", {
        keys: await apiKeyDal.listSecret(context.user.id),
      });
    } catch (error) {
      return failure(
        "List secret API keys error",
        error,
        "LIST_FAILED",
        "Failed to fetch secret API keys",
      );
    }
  });

export const createSecretApiKeyAction = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(createSecretApiKeyInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await apiKeyWriteService.create({
        title: input.data.title,
        createdBy: context.user.id,
        type: "secret",
      });
      if (!result.success) return result;
      return ok(
        "Secret API key created. Copy it now; it cannot be shown again.",
        {
          id: result.data.id,
          token: result.data.token,
          redacted: result.data.redacted,
        },
      );
    } catch (error) {
      return failure(
        "Create secret API key error",
        error,
        "CREATE_FAILED",
        "Failed to create secret API key",
      );
    }
  });

export const updateSecretApiKeyTitle = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    parseInput(updateSecretApiKeyTitleInputSchema, data),
  )
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await apiKeyWriteService.updateTitle({
        id: input.data.id,
        actorId: context.user.id,
        title: input.data.title,
        expectedType: "secret",
      });
      return result.success
        ? ok("Secret API key updated", { id: input.data.id })
        : fail("Secret API key not found", {
            error: result.error ?? "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Update secret API key error",
        error,
        "UPDATE_FAILED",
        "Failed to update secret API key",
      );
    }
  });

export const revokeSecretApiKey = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(revokeSecretApiKeyInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await apiKeyWriteService.revoke({
        id: input.data.id,
        actorId: context.user.id,
        expectedType: "secret",
      });
      return result.success
        ? ok("Secret API key revoked", { id: input.data.id })
        : fail("Secret API key not found or already revoked", {
            error: result.error ?? "NOT_FOUND",
          });
    } catch (error) {
      return failure(
        "Revoke secret API key error",
        error,
        "REVOKE_FAILED",
        "Failed to revoke secret API key",
      );
    }
  });

export const deleteRevokedSecretApiKey = createServerFn({ method: "POST" })
  .validator((data: unknown) => parseInput(deleteSecretApiKeyInputSchema, data))
  .middleware([commerceAdminMiddleware])
  .handler(async ({ data: input, context }) => {
    if (!input.success) return input;
    try {
      const result = await apiKeyWriteService.deleteRevoked({
        id: input.data.id,
        actorId: context.user.id,
        expectedType: "secret",
      });
      return result.success
        ? ok("Revoked secret API key deleted", { id: input.data.id })
        : fail("Only revoked secret API keys can be deleted", {
            error: result.error ?? "NOT_FOUND_OR_ACTIVE",
          });
    } catch (error) {
      return failure(
        "Delete secret API key error",
        error,
        "DELETE_FAILED",
        "Failed to delete secret API key",
      );
    }
  });
