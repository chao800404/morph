import { Button } from "@/components/ui/button";
import { RouteSurfaceMessage } from "@/components/dialog/route-surface-message";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { storefrontPageQueries } from "@queries/storefront-page.queries";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { History } from "lucide-react";
import StorefrontPageDetailPending from "./page-detail-pending";
import { useCallback } from "react";

export default function StorefrontPageDetail() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  const query = useQuery(storefrontPageQueries.detail(id));
  const page = query.data?.success ? query.data.data : null;
  const openEdit = useCallback(
    () =>
      void navigate({
        to: "/dashboard/$slug/$id/edit",
        params: { slug: "pages", id },
      }),
    [id, navigate],
  );
  if (query.isPending) return <StorefrontPageDetailPending />;
  if (!page)
    return (
      <RouteSurfaceMessage>
        {query.data?.message ?? "Page not found"}
      </RouteSurfaceMessage>
    );
  const fields: EditCardField[] = [
    {
      key: "url",
      label: "URL",
      value: page.handle,
      displayValue: `/${page.handle}`,
    },
    {
      key: "status",
      label: "Status",
      value: page.status,
      displayValue: page.status,
    },
    {
      key: "revision",
      label: "Draft revision",
      value: String(page.version),
      displayValue: `Version ${page.version}`,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id="storefront-page-detail"
        title="General"
        description="The editor, preview and AI authoring all read this page's versioned document."
        fields={fields}
        onEdit={openEdit}
      />
      <CardWrapper
        label="Revision history"
        description="Review or restore an earlier document as a new draft."
        headerButton={
          <Button variant="ghost" size="icon" asChild>
            <Link
              to="/dashboard/$slug/$id/$page"
              params={{ slug: "pages", id, page: "revisions" }}
              aria-label="Open revision history"
            >
              <History />
            </Link>
          </Button>
        }
      />
      <MetadataCard
        slug="pages"
        id={id}
        keyCount={Object.keys(page.metadata).length}
      />
    </div>
  );
}
