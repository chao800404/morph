import { listSessions } from "@/server/auth/list-sessions.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const sessionQueries = {
  all: () => ["sessions"] as const,
  list: () =>
    queryOptions({
      queryKey: [...sessionQueries.all(), "list"],
      queryFn: async () => {
        const result = await listSessions();
        return result;
      },
    }),
};
