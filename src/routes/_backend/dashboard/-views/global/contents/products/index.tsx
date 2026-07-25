import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyFileIcon } from "@/components/ui/icons/empty-file-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProductDTO } from "@/lib/product/dto/product.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeProductListParams,
  productQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { deleteProductsAction } from "./product-actions";

const STATUS_VARIANT = {
  published: "default",
  draft: "secondary",
  archived: "outline",
} as const;

const Products = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = normalizeProductListParams(search);
  const { data: result, isPending } = useQuery(productQueries.list(params));

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: productQueries.all() });
  }, [queryClient]);

  // Product creation is a multi-step flow with a variant matrix, which the
  // shared `fields` dialog cannot express, so it lives on its own route.
  const handleCreateProduct = useCallback(() => {
    void navigate({ to: "/dashboard/products/new" });
  }, [navigate]);

  const handleDelete = useCallback(
    (product: ProductDTO) => {
      setInfoData({
        title: "Delete Product",
        description: `Are you sure you want to delete "${product.title}"? Its variants and prices go with it. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "productIds",
            value: JSON.stringify([product.id]),
          },
        ],
        action: deleteProductsAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const products = result?.success ? (result.data?.products ?? []) : [];
  // Loading, error and empty states are centred in the card; the table is not.
  const showsPlaceholder =
    isPending || (result && !result.success) || products.length === 0;
  const createButton = (
    <Button
      onClick={handleCreateProduct}
      variant="form"
      size="sm"
      className="gap-2"
    >
      <Plus className="size-4" />
      Create
    </Button>
  );

  return (
    <CardWrapper
      label="Products"
      description="Manage your products and catalogue"
      headerButton={createButton}
      classNames={{
        cardWrapper: "min-h-content",
        contentWrapper: showsPlaceholder
          ? "flex flex-col items-center justify-center"
          : undefined,
      }}
    >
      {isPending ? (
        <Spinner />
      ) : result && !result.success ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-destructive">{result.message}</p>
          <Button variant="outline" size="sm" onClick={invalidate}>
            Retry
          </Button>
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="flex flex-col items-center gap-3 opacity-70">
            <EmptyFileIcon />
            <h3 className="mt-2 text-lg font-medium text-foreground">
              No products yet
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Get started by creating your first product to display in your
              store.
            </p>
            <div className="mt-4">{createButton}</div>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Handle</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-16 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">{product.title}</TableCell>
                <TableCell className="text-muted-foreground">
                  {product.handle}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[product.status]}>
                    {product.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(product.updatedAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${product.title}`}
                    onClick={() => handleDelete(product)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardWrapper>
  );
};

export default Products;
