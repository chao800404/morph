import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OptionTemplateDTO } from "@/lib/product/dto/option-template.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import {
  DataTableCard,
  deleteActionIcon,
  editActionIcon,
  type DataTableColumn,
} from "@/routes/_backend/dashboard/-components/data-table-card";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { useEditStore } from "@/routes/_backend/dashboard/-views/features/global-edit/use-edit-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeOptionTemplateListParams,
  optionTemplateQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  createOptionTemplateAction,
  deleteOptionTemplatesAction,
  updateOptionTemplateAction,
} from "../product-actions";

const Options = () => {
  const search = useSearch({ strict: false }) as DashboardSearch;
  const queryClient = useQueryClient();
  const params = normalizeOptionTemplateListParams(search);
  const { data: result, isPending } = useQuery(
    optionTemplateQueries.list(params),
  );

  const { setCreateData, setOpen: setCreateOpen } = useCreateStore(
    useShallow((state) => ({
      setCreateData: state.setCreateData,
      setOpen: state.setOpen,
    })),
  );

  const { setEditData, setOpen: setEditOpen } = useEditStore(
    useShallow((state) => ({
      setEditData: state.setEditData,
      setOpen: state.setOpen,
    })),
  );

  const { setInfoData, setOpen: setInfoOpen } = useInfoStore(
    useShallow((state) => ({
      setInfoData: state.setInfoData,
      setOpen: state.setOpen,
    })),
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: optionTemplateQueries.all(),
    });
  }, [queryClient]);

  const handleCreate = useCallback(() => {
    setCreateData({
      title: "Create Product Option",
      description: "Define a reusable option such as Size or Colour.",
      fields: [
        {
          type: "input",
          name: "title",
          label: "Title",
          placeholder: "e.g. Size, Colour, Material",
          required: true,
          autoFocus: true,
        },
        {
          type: "option-values",
          name: "values",
          label: "Values",
          placeholder: "Type a value and press Enter...",
        },
      ],
      action: createOptionTemplateAction,
      onSuccess: invalidate,
    });
    setCreateOpen(true);
  }, [invalidate, setCreateData, setCreateOpen]);

  const handleEdit = useCallback(
    (template: OptionTemplateDTO) => {
      setEditOpen(true);
      setEditData({
        title: "Edit Product Option",
        description: template.title,
        fields: [
          { type: "hidden", name: "id", value: template.id },
          {
            type: "input",
            name: "title",
            label: "Title",
            value: template.title,
            required: true,
          },
          {
            type: "option-values",
            name: "values",
            label: "Values",
            value: template.values.map((value) => value.value),
            placeholder: "Type a value and press Enter...",
          },
        ],
        action: (formData: FormData) =>
          updateOptionTemplateAction({ data: formData }),
        onSuccess: invalidate,
      });
    },
    [invalidate, setEditData, setEditOpen],
  );

  const handleDelete = useCallback(
    (template: OptionTemplateDTO) => {
      setInfoData({
        title: "Delete Option",
        description: `Are you sure you want to delete "${template.title}"? Products already built with it keep their own values. This action cannot be undone.`,
        fields: [
          {
            type: "hidden",
            name: "optionIds",
            value: JSON.stringify([template.id]),
          },
        ],
        action: deleteOptionTemplatesAction,
        confirmLabel: "Delete",
        confirmVariant: "destructive",
        onSuccess: invalidate,
      });
      setInfoOpen(true);
    },
    [invalidate, setInfoData, setInfoOpen],
  );

  const columns = useMemo<DataTableColumn<OptionTemplateDTO>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        className: "w-64 font-medium",
        cell: (template) => template.title,
      },
      {
        key: "values",
        header: "Values",
        cell: (template) =>
          `${template.values.length} value${template.values.length === 1 ? "" : "s"}`,
      },
      {
        key: "status",
        header: "Status",
        className: "w-32",
        // Every option defined here is reusable across products. A per-product
        // option would be authored on the product itself, not in this list.
        cell: () => <Badge variant="default">Global</Badge>,
      },
    ],
    [],
  );

  const templates = result?.success ? (result.data?.templates ?? []) : [];

  return (
    <DataTableCard
      label="Options"
      description="Manage product options and their associated values."
      searchPlaceholder="Search"
      sortOptions={[
        { value: "name", label: "Title" },
        { value: "createdAt", label: "Created" },
        { value: "updatedAt", label: "Updated" },
      ]}
      headerActions={
        <Button onClick={handleCreate} variant="form" size="xs" className="gap-2">
          <Plus className="size-4" />
          Create
        </Button>
      }
      columns={columns}
      rows={templates}
      getRowId={(template) => template.id}
      isPending={isPending}
      errorMessage={result && !result.success ? result.message : null}
      onRetry={invalidate}
      emptyTitle="No product options yet"
      emptyDescription="Create options such as Size, Colour or Material, then pick them when you build a product."
      rowActions={(template) => [
        {
          label: "Edit",
          icon: editActionIcon,
          onSelect: () => handleEdit(template),
        },
        {
          label: "Delete",
          icon: deleteActionIcon,
          destructive: true,
          onSelect: () => handleDelete(template),
        },
      ]}
      pagination={
        result?.success && result.data ? result.data.pagination : undefined
      }
    />
  );
};

export default Options;
