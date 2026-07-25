import { NotFound } from "@/components/not-found/not-found";
import { getConfig } from "@/server/get-config";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useMemo } from "react";
import { z } from "zod";

const searchSchema = z.object({
  folderId: z.string().optional().nullable(),
  q: z.string().optional(),
  sortBy: z.enum(["name", "createdAt", "updatedAt"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
});

function getAllCollections(globalGroups: any[]) {
  const result: any[] = [];
  for (const group of globalGroups || []) {
    for (const col of group.collections || []) {
      result.push(col);
      if (Array.isArray(col.items)) {
        for (const item of col.items) {
          result.push(item);
        }
      }
    }
  }
  return result;
}

export const Route = createFileRoute("/_backend/dashboard/$parent/$slug")({
  validateSearch: (search) => searchSchema.parse(search),
  beforeLoad: async (ctx) => {
    const { search } = ctx;
    return { search };
  },
  loader: async ({ context, params }) => {
    const { queryClient, search } = context;
    const config = getConfig().client;

    const globalCollections = getAllCollections(config.collections.global);
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

  const ViewComponent = useMemo(() => {
    const globalCollections = getAllCollections(config.collections.global);
    const collection = globalCollections.find((c) => c.slug === slug);
    return collection?.component;
  }, [slug, config]);

  if (!ViewComponent) return <NotFound />;
  return (
    <Suspense fallback={null}>
      <ViewComponent />
    </Suspense>
  );
}
