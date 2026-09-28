import { apiKeyDal } from "@/lib/api-key/dal/api-key.dal";
import {
  createPublishableKey,
  createSecretApiKey,
} from "@/lib/api-key/publishable-key";
import { fail, ok, type ServerResult } from "@/lib/db/server-result";

export type ApiKeyType = "secret" | "publishable";

export type CreatedApiKey = {
  id: string;
  token: string;
  title: string;
  type: ApiKeyType;
  redacted: string;
  lastUsedAt: null;
  createdBy: string;
  revokedBy: null;
  revokedAt: null;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
  salesChannelIds: string[];
};

export type ApiKeyWriteDal = Pick<
  typeof apiKeyDal,
  | "activeSalesChannelIds"
  | "createPublishable"
  | "createSecret"
  | "findAdminById"
  | "updateSecretTitle"
  | "updatePublishableTitle"
  | "managePublishableSalesChannels"
  | "revokeSecret"
  | "revoke"
  | "deleteRevokedSecret"
  | "deleteRevokedPublishable"
>;

type GeneratedKey = {
  id: string;
  token: string;
  hash: string;
  salt: string;
  redacted: string;
};

export type ApiKeyWriteDependencies = {
  keys: ApiKeyWriteDal;
  createPublishableKey(): Promise<GeneratedKey>;
  createSecretApiKey(): Promise<GeneratedKey>;
  now(): string;
};

/** Shared API-key mutations for Dashboard server functions and Admin REST. */
export const createApiKeyWriteService = (
  overrides: Partial<ApiKeyWriteDependencies> = {},
) => {
  const dependencies: ApiKeyWriteDependencies = {
    keys: apiKeyDal,
    createPublishableKey,
    createSecretApiKey,
    now: () => new Date().toISOString(),
    ...overrides,
  };

  return {
    async create(input: {
      title: string;
      type: ApiKeyType;
      createdBy: string;
      salesChannelIds?: string[];
    }): Promise<ServerResult<CreatedApiKey>> {
      const salesChannelIds = [...new Set(input.salesChannelIds ?? [])];
      if (input.type === "publishable") {
        const activeIds =
          await dependencies.keys.activeSalesChannelIds(salesChannelIds);
        if (activeIds.length !== salesChannelIds.length) {
          return fail(
            "One or more sales channels are disabled or no longer exist",
            {
              error: "INVALID_SALES_CHANNEL",
              errors: { salesChannelIds: ["Select enabled sales channels"] },
            },
          );
        }
      } else if (salesChannelIds.length) {
        return fail("Secret API keys cannot be scoped to sales channels", {
          error: "INVALID_INPUT",
          errors: { salesChannelIds: ["Remove sales channel IDs"] },
        });
      }

      const key =
        input.type === "publishable"
          ? await dependencies.createPublishableKey()
          : await dependencies.createSecretApiKey();
      const now = dependencies.now();
      if (input.type === "publishable") {
        await dependencies.keys.createPublishable({
          id: key.id,
          hash: key.hash,
          salt: key.salt,
          redacted: key.redacted,
          title: input.title,
          createdBy: input.createdBy,
          salesChannelIds,
          now,
        });
      } else {
        await dependencies.keys.createSecret({
          id: key.id,
          hash: key.hash,
          salt: key.salt,
          redacted: key.redacted,
          title: input.title,
          createdBy: input.createdBy,
          now,
        });
      }

      // Only this creation result carries the plaintext token. The DAL stores
      // only its salted hash, so later list/detail calls cannot reveal it.
      return ok("API key created", {
        id: key.id,
        token: key.token,
        title: input.title,
        type: input.type,
        redacted: key.redacted,
        lastUsedAt: null,
        createdBy: input.createdBy,
        revokedBy: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        salesChannelIds,
      });
    },

    async updateTitle(input: {
      id: string;
      actorId: string;
      title: string;
      expectedType?: ApiKeyType;
    }): Promise<ServerResult<{ id: string }>> {
      const current = await dependencies.keys.findAdminById(
        input.id,
        input.actorId,
      );
      if (!current) return fail("API key not found", { error: "NOT_FOUND" });
      if (input.expectedType && current.type !== input.expectedType)
        return fail("API key not found", { error: "NOT_FOUND" });
      const updated =
        current.type === "secret"
          ? await dependencies.keys.updateSecretTitle(
              current.id,
              input.actorId,
              input.title,
            )
          : await dependencies.keys.updatePublishableTitle(
              current.id,
              input.title,
            );
      return updated
        ? ok("API key updated", { id: current.id })
        : fail("API key not found", { error: "NOT_FOUND" });
    },

    async manageSalesChannels(input: {
      id: string;
      actorId: string;
      add: string[];
      remove: string[];
    }): Promise<ServerResult<{ id: string; added: number; removed: number }>> {
      const current = await dependencies.keys.findAdminById(
        input.id,
        input.actorId,
      );
      if (!current || current.type !== "publishable")
        return fail("Publishable API key not found", { error: "NOT_FOUND" });
      if (current.revokedAt)
        return fail("Revoked API keys cannot change sales channels", {
          error: "REVOKED",
        });
      const add = [...new Set(input.add)];
      const remove = [...new Set(input.remove)];
      const activeIds = await dependencies.keys.activeSalesChannelIds(add);
      if (activeIds.length !== add.length)
        return fail(
          "One or more sales channels are disabled or no longer exist",
          {
            error: "INVALID_SALES_CHANNEL",
            errors: { add: ["Select enabled sales channels"] },
          },
        );
      await dependencies.keys.managePublishableSalesChannels({
        id: current.id,
        add: activeIds,
        remove,
      });
      return ok("Publishable API key sales channels updated", {
        id: current.id,
        added: add.length,
        removed: remove.length,
      });
    },

    async revoke(input: {
      id: string;
      actorId: string;
      expectedType?: ApiKeyType;
    }): Promise<ServerResult<{ id: string }>> {
      const current = await dependencies.keys.findAdminById(
        input.id,
        input.actorId,
      );
      if (!current) return fail("API key not found", { error: "NOT_FOUND" });
      if (input.expectedType && current.type !== input.expectedType)
        return fail("API key not found", { error: "NOT_FOUND" });
      if (current.revokedAt)
        return fail("API key is already revoked", { error: "ALREADY_REVOKED" });
      const revoked =
        current.type === "secret"
          ? await dependencies.keys.revokeSecret(current.id, input.actorId)
          : await dependencies.keys.revoke(current.id, input.actorId);
      return revoked
        ? ok("API key revoked", { id: current.id })
        : fail("API key not found or already revoked", {
            error: "NOT_FOUND_OR_REVOKED",
          });
    },

    async deleteRevoked(input: {
      id: string;
      actorId: string;
      expectedType?: ApiKeyType;
    }): Promise<ServerResult<{ id: string }>> {
      const current = await dependencies.keys.findAdminById(
        input.id,
        input.actorId,
      );
      if (!current) return fail("API key not found", { error: "NOT_FOUND" });
      if (input.expectedType && current.type !== input.expectedType)
        return fail("API key not found", { error: "NOT_FOUND" });
      if (!current.revokedAt)
        return fail("Only revoked API keys can be deleted", {
          error: "ACTIVE_KEY",
        });
      const deleted =
        current.type === "secret"
          ? await dependencies.keys.deleteRevokedSecret(
              current.id,
              input.actorId,
            )
          : await dependencies.keys.deleteRevokedPublishable(current.id);
      return deleted
        ? ok("Revoked API key deleted", { id: current.id })
        : fail("Only revoked API keys can be deleted", {
            error: "NOT_FOUND_OR_ACTIVE",
          });
    },
  };
};

export const apiKeyWriteService = createApiKeyWriteService();
