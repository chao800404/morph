import { Button } from "@/components/ui/button";
import {
  EditCard,
  type EditCardField,
} from "@/routes/_backend/dashboard/-components/edit-card/edit-card";
import { MetadataCard } from "@/routes/_backend/dashboard/-components/metadata-card/metadata-card";
import { referenceDataQueries } from "@queries/reference-data.queries";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  referenceDataConfig,
  toReferenceDataKind,
} from "./reference-data.config";

export default function ReferenceDataDetail() {
  const { slug, id } = useParams({ strict: false }) as {
    slug?: string;
    id: string;
  };
  const kind = toReferenceDataKind(slug);
  const navigate = useNavigate();
  const { data: response } = useSuspenseQuery(
    referenceDataQueries.detail(kind ?? "product-types", id),
  );
  if (!kind) return null;
  const scope = kind.startsWith("product-") ? "global" : "settings";
  const item = response.success ? response.data : null;
  if (!item)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm text-muted-foreground">{response.message}</p>
        <Button variant="outline" size="sm" asChild>
          <Link
            to={
              scope === "settings"
                ? "/dashboard/settings/$slug"
                : "/dashboard/$slug"
            }
            params={{ slug: kind }}
          >
            Back to {referenceDataConfig[kind].label.toLowerCase()}
          </Link>
        </Button>
      </div>
    );
  const fields: EditCardField[] = [
    ...(item.code ? [{ key: "code", label: "Code", value: item.code }] : []),
    ...(item.description
      ? [{ key: "description", label: "Description", value: item.description }]
      : []),
    ...(kind === "return-reasons"
      ? [
          {
            key: "parent",
            label: "Parent reason",
            value: item.parentName ?? "—",
          },
        ]
      : []),
    {
      key: "usage",
      label: "Used by",
      value: `${item.usageCount} ${kind.startsWith("product-") ? "product" : "record"}${item.usageCount === 1 ? "" : "s"}`,
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <EditCard
        id={`${kind}-detail`}
        title={item.name}
        fields={fields}
        onEdit={() =>
          void navigate(
            scope === "settings"
              ? {
                  to: "/dashboard/settings/$slug/$id/edit",
                  params: { slug: kind, id },
                }
              : {
                  to: "/dashboard/$slug/$id/edit",
                  params: { slug: kind, id },
                },
          )
        }
      />
      <MetadataCard
        slug={kind}
        id={id}
        keyCount={Object.keys(item.metadata).length}
        scope={scope}
      />
    </div>
  );
}
