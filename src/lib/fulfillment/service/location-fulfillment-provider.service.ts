import { fulfillmentProviderRegistry } from "@/lib/fulfillment/providers/fulfillment-provider-registry.server";
import { stockLocationDal } from "@/lib/stock-location/dal/stock-location.dal";
import { fail, failure, ok, type ServerFailure } from "@/lib/db/server-result";
import { getConfig } from "@/server/get-config";

type Result<T> = { success: true; message: string; data: T } | ServerFailure;

export type LocationFulfillmentProviderChoice = {
  id: string;
  name: string;
  isAssigned: boolean;
};

export type LocationFulfillmentProviderDependencies = {
  assertConfig(): unknown;
  findLocation(id: string): Promise<{ id: string } | null>;
  listInstalledProviders(): ReturnType<typeof fulfillmentProviderRegistry.list>;
  listAssignedProviderIds(locationId: string): Promise<string[]>;
  setProviderIds(locationId: string, providerIds: string[]): Promise<void>;
  batchProviderIds(
    locationId: string,
    input: { add: string[]; remove: string[] },
  ): Promise<void>;
};

const defaultDependencies: LocationFulfillmentProviderDependencies = {
  assertConfig: () => getConfig(),
  findLocation: async (id) => {
    const location = await stockLocationDal.findById(id);
    return location ? { id: location.id } : null;
  },
  listInstalledProviders: () => fulfillmentProviderRegistry.list(),
  listAssignedProviderIds: (id) =>
    stockLocationDal.listFulfillmentProviderIds(id),
  setProviderIds: (id, providerIds) =>
    stockLocationDal.setFulfillmentProviderIds(id, providerIds),
  batchProviderIds: (id, input) =>
    stockLocationDal.batchFulfillmentProviderIds(id, input),
};

export const createLocationFulfillmentProviderService = (
  overrides: Partial<LocationFulfillmentProviderDependencies> = {},
) => {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    async list(locationId: string): Promise<
      Result<{
        locationId: string;
        providers: LocationFulfillmentProviderChoice[];
        fulfillmentProviderIds: string[];
      }>
    > {
      dependencies.assertConfig();
      try {
        const location = await dependencies.findLocation(locationId);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });

        const [installedProviders, assignedIds] = await Promise.all([
          dependencies.listInstalledProviders(),
          dependencies.listAssignedProviderIds(location.id),
        ]);
        const assigned = new Set(assignedIds);
        const providers = installedProviders.map((provider) => ({
          ...provider,
          isAssigned: assigned.has(provider.id),
        }));
        const fulfillmentProviderIds = providers
          .filter((provider) => provider.isAssigned)
          .map((provider) => provider.id);

        return ok("Fulfillment providers fetched successfully", {
          locationId: location.id,
          providers,
          fulfillmentProviderIds,
        });
      } catch (error) {
        return failure(
          "Get location fulfillment providers error",
          error,
          "GET_FAILED",
          "Failed to fetch fulfillment providers",
        );
      }
    },

    async set(input: {
      locationId: string;
      fulfillmentProviderIds: string[];
    }): Promise<Result<{ locationId: string; count: number }>> {
      dependencies.assertConfig();
      try {
        const location = await dependencies.findLocation(input.locationId);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });

        const ids = [...new Set(input.fulfillmentProviderIds)];
        if (ids.length > 80) {
          return fail("Choose no more than 80 fulfillment providers", {
            errors: {
              fulfillmentProviderIds: ["Choose no more than 80 providers"],
            },
          });
        }
        const installedIds = new Set(
          dependencies.listInstalledProviders().map((provider) => provider.id),
        );
        if (ids.some((id) => !installedIds.has(id))) {
          return fail("One or more fulfillment providers are not installed", {
            error: "NOT_FOUND",
            errors: {
              fulfillmentProviderIds: [
                "Choose only installed fulfillment providers",
              ],
            },
          });
        }

        await dependencies.setProviderIds(location.id, ids);
        return ok("Fulfillment providers updated", {
          locationId: location.id,
          count: ids.length,
        });
      } catch (error) {
        return failure(
          "Set location fulfillment providers error",
          error,
          "UPDATE_FAILED",
          "Failed to update fulfillment providers",
        );
      }
    },

    async batch(input: {
      locationId: string;
      add: string[];
      remove: string[];
    }): Promise<
      Result<{ locationId: string; fulfillmentProviderIds: string[] }>
    > {
      dependencies.assertConfig();
      try {
        const location = await dependencies.findLocation(input.locationId);
        if (!location)
          return fail("Stock location not found", { error: "NOT_FOUND" });

        const add = [...new Set(input.add)];
        const remove = [...new Set(input.remove)];
        const removedIds = new Set(remove);
        if (
          add.length > 80 ||
          remove.length > 80 ||
          add.length !== input.add.length ||
          remove.length !== input.remove.length ||
          add.some((id) => removedIds.has(id))
        ) {
          return fail("Invalid fulfillment provider assignment changes", {
            error: "INVALID_INPUT",
          });
        }

        const installedIds = new Set(
          dependencies.listInstalledProviders().map((provider) => provider.id),
        );
        if (add.some((id) => !installedIds.has(id))) {
          return fail("One or more fulfillment providers are not installed", {
            error: "NOT_FOUND",
          });
        }

        await dependencies.batchProviderIds(location.id, { add, remove });
        const fulfillmentProviderIds =
          await dependencies.listAssignedProviderIds(location.id);
        return ok("Fulfillment providers updated", {
          locationId: location.id,
          fulfillmentProviderIds,
        });
      } catch (error) {
        return failure(
          "Batch location fulfillment providers error",
          error,
          "UPDATE_FAILED",
          "Failed to update fulfillment providers",
        );
      }
    },
  };
};

export const locationFulfillmentProviderService =
  createLocationFulfillmentProviderService();
