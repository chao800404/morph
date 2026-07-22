import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { z } from "zod";

const searchSchema = z.object({
  folderId: z.string().optional().nullable(),
  q: z.string().optional(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

export const Route = createFileRoute("/_backend/dashboard/$slug")({
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async (ctx) => {
    const { search } = ctx;
    return { search };
  },
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const config = getConfig().client;

    // Discover the collection item by slug from all global groups
    const globalCollections = config.collections.global.flatMap(
      (group) => group.collections,
    );
    const collection = globalCollections.find((c) => c.slug === params.slug);

    if (collection?.loadData) {
      await collection.loadData({ queryClient, params, search });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const { slug } = Route.useParams();
  const config = useMemo(() => getConfig().client, []);

  // Pick the component based on the slug from the config
  const ViewComponent = useMemo(() => {
    const settingsCollections = config.collections.global.flatMap(
      (group) => group.collections,
    );
    const collection = settingsCollections.find((c) => c.slug === slug);
    return collection?.component;
  }, [slug, config]);

  if (!ViewComponent) return <NotFound />;
  return <ViewComponent />;
}
