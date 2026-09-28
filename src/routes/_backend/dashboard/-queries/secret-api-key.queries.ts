import { queryOptions } from "@tanstack/react-query";
import { listSecretApiKeys } from "@/server/api-key/secret-api-keys.serverFn";

export const secretApiKeyQueries = {
  all: () => ["secret-api-keys"] as const,
  list: () =>
    queryOptions({
      queryKey: [...secretApiKeyQueries.all(), "list"] as const,
      queryFn: () => listSecretApiKeys(),
    }),
};
