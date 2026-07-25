import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSpinner } from "@/components/loading/page-spinner";

// A static segment, so it wins over the dynamic `/dashboard/$parent/$slug`
// route that would otherwise match `products/new`.
const ProductCreateWizard = lazy(() =>
  import(
    "./-views/global/contents/products/create/product-create-wizard"
  ).then((m) => ({ default: m.ProductCreateWizard })),
);

export const Route = createFileRoute("/_backend/dashboard/products/new")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <ProductCreateWizard />
    </Suspense>
  );
}
