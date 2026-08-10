import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { DataTableCard } from "@/routes/_backend/dashboard/-components/data-table-card";
import { productOptionQueries } from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { RelatedProductsCard } from "../components/related-products-card";
import { OPTION_VALUE_COLUMNS } from "./config/option-detail.config";

/**
 * Option detail.
 *
 * Values come with the option itself — the input schema caps them at 50, so
 * they are bounded reference data and need no pagination. Products built on
 * the option are a separate paginated query: that list grows.
 */
const OptionDetail = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();

  const { data: result, isPending } = useQuery(productOptionQueries.detail(id));
  const option = result?.success ? result.data : null;

  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "product-options", id },
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

  if (!option) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">
          {result?.message ?? "Option not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/dashboard/$slug" params={{ slug: "product-options" }}>
            Back to options
          </Link>
        </Button>
      </div>
    );
  }

  const detailFields: EditCardField[] = [
    {
      key: "type",
      label: "Type",
      // An exclusive option was authored on one product and never appears in
      // the shared library, so the distinction is worth stating here.
      displayValue: (
        <Badge variant={option.isExclusive ? "outline" : "default"}>
          {option.isExclusive ? "Product-only" : "Global"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="option-detail"
        title={option.title}
        fields={detailFields}
        onEdit={openEdit}
      />

      <DataTableCard
        label="Values"
        description="The values products can be sold in. Editing them here never rewrites a product already built on this option."
        columns={OPTION_VALUE_COLUMNS}
        rows={option.values}
        getRowId={(value) => value.id}
        emptyTitle="No values yet"
        emptyDescription="Add values such as Small, Medium or Large so products can use this option."
      />

      <RelatedProductsCard
        description="Products built on this option."
        filter={{ optionId: id }}
        seed={{ seedOptionId: id }}
        returnTo={`/dashboard/product-options/${id}`}
        emptyTitle="No products use this option"
        emptyDescription="Pick this option when creating a product to build its variants from these values."
      />

      <MetadataCard
        slug="product-options"
        id={id}
        keyCount={Object.keys(option.metadata ?? {}).length}
      />
    </div>
  );
};

export default OptionDetail;
