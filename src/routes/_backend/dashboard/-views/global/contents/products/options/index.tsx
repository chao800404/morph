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
import type { OptionTemplateDTO } from "@/lib/product/dto/option-template.dto";
import type { DashboardSearch } from "@/lib/validations/dashboard-search";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { useCreateStore } from "@/routes/_backend/dashboard/-views/features/global-create/use-create-store";
import { useEditStore } from "@/routes/_backend/dashboard/-views/features/global-edit/use-edit-store";
import { useInfoStore } from "@/routes/_backend/dashboard/-views/features/global-info/use-info-store";
import {
  normalizeOptionTemplateListParams,
  optionTemplateQueries,
} from "@queries/product.queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback } from "react";
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

  const templates = result?.success ? (result.data?.templates ?? []) : [];
  // Loading, error and empty states are centred in the card; the table is not.
  const showsPlaceholder =
    isPending || (result && !result.success) || templates.length === 0;
  const createButton = (
    <Button onClick={handleCreate} variant="form" size="sm" className="gap-2">
      <Plus className="size-4" />
      Create
    </Button>
  );

  return (
    <CardWrapper
      label="Options"
      description="Reusable option definitions you can pick from when creating a product"
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
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="flex flex-col items-center gap-3 opacity-70">
            <EmptyFileIcon />
            <h3 className="mt-2 text-lg font-medium text-foreground">
              No product options yet
            </h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create options such as Size, Colour or Material, then pick them
              when you build a product.
            </p>
            <div className="mt-4">{createButton}</div>
          </div>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">Title</TableHead>
              <TableHead>Values</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((template) => (
              <TableRow key={template.id}>
                <TableCell className="font-medium">{template.title}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {template.values.map((value) => (
                      <Badge key={value.id} variant="secondary">
                        {value.value}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${template.title}`}
                    onClick={() => handleEdit(template)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${template.title}`}
                    onClick={() => handleDelete(template)}
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

export default Options;
