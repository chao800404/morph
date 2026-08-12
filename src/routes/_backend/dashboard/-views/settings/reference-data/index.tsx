import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import {
  referenceDataQueries,
  normalizeReferenceDataListParams,
} from "@queries/reference-data.queries";
import { SettingsResourceTable } from "../settings-resource-table";
import { deleteReferenceDataAction } from "./reference-data-actions";
import {
  referenceDataColumns,
  referenceDataConfig,
  toReferenceDataKind,
} from "./reference-data.config";

export default function ReferenceDataIndex() {
  const { slug } = useParams({ strict: false }) as { slug?: string };
  const search = useSearch({ strict: false }) as DashboardSearch;
  const kind = toReferenceDataKind(slug);
  const queryClient = useQueryClient();
  const params = kind ? normalizeReferenceDataListParams(kind, search) : null;
  const { data: response, isPending } = useQuery({
    ...referenceDataQueries.list(
      params ?? normalizeReferenceDataListParams("product-types", search),
    ),
    enabled: Boolean(kind),
  });
  if (!kind) return null;
  const config = referenceDataConfig[kind];
  const scope = kind.startsWith("product-") ? "global" : "settings";
  const rows = response?.success ? response.data.items : [];
  const invalidate = () =>
    void queryClient.invalidateQueries({
      queryKey: referenceDataQueries.all(kind),
    });
  return (
    <SettingsResourceTable
      scope={scope}
      slug={kind}
      label={config.label}
      description={config.description}
      rows={rows}
      columns={referenceDataColumns(kind)}
      isPending={isPending}
      errorMessage={response && !response.success ? response.message : null}
      pagination={response?.success ? response.data.pagination : undefined}
      invalidate={invalidate}
      deleteAction={async ({ data }) => {
        data.set("kind", kind);
        return deleteReferenceDataAction({ data });
      }}
      deleteName={(item) => item.name}
      isDeleteDisabled={(item) => item.usageCount > 0}
    />
  );
}
