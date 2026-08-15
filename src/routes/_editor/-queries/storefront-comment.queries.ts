import {
  listStorefrontCommentGroups,
  listStorefrontCommentThreads,
} from "@/server/storefront/storefront-comments.serverFn";
import { queryOptions } from "@tanstack/react-query";

export const storefrontCommentQueries = {
  all: () => ["storefront-comments"] as const,
  groups: (storefrontId: string, themeId: string, templateId: string) =>
    queryOptions({
      queryKey: [
        ...storefrontCommentQueries.all(),
        "groups",
        storefrontId,
        themeId,
        templateId,
      ],
      queryFn: () =>
        listStorefrontCommentGroups({
          data: { storefrontId, themeId, templateId },
        }),
    }),
  list: (
    storefrontId: string,
    themeId: string,
    templateId: string,
    status: "all" | "open" | "resolved" = "all",
    groupId?: string | null,
  ) =>
    queryOptions({
      queryKey: [
        ...storefrontCommentQueries.all(),
        "list",
        storefrontId,
        themeId,
        templateId,
        status,
        groupId ?? "all",
      ],
      queryFn: () =>
        listStorefrontCommentThreads({
          data: { storefrontId, themeId, templateId, status, groupId },
        }),
    }),
};
