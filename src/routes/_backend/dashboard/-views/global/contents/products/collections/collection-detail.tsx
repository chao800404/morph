import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { collectionQueries } from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { RelatedProductsCard } from "../components/related-products-card";

/**
 * Collection detail.
 *
 * A collection is a flat grouping — no tree, no values — so the record itself
 * is two fields. Its products are the substance, and they are a separate
 * paginated query because that list grows.
 */
const CollectionDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();

  const { data: result, isPending } = useQuery(collectionQueries.detail(id));
  const collection = result?.success ? result.data : null;

  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "collections", id },
      }),
    [id, navigate],
  );

  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Collection not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "collections" }}>
            Back to collections
          </Link>
        </Button>
      </div>
    );
  }

  const detailFields: EditCardField[] = [
    {
      key: "description",
      label: "Description",
      value: collection.description ?? "",
      displayValue: collection.description || "—",
    },
    {
      key: "handle",
      label: "Handle",
      value: collection.handle,
      displayValue: `/${collection.handle}`,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="collection-detail"
        title={collection.title}
        fields={detailFields}
        onEdit={openEdit}
      />

      <RelatedProductsCard
        description="Products grouped into this collection."
        filter={{ collectionId: id }}
        seed={{ seedCollectionId: id }}
        returnTo={`/dashboard/collections/${id}`}
        emptyTitle="No products in this collection"
        emptyDescription="Create one here, or pick this collection from a product's Organize step."
      />

      <MetadataCard
        slug="collections"
        id={id}
        keyCount={Object.keys(collection.metadata ?? {}).length}
      />
    </div>
  );
};

export default CollectionDetail;
