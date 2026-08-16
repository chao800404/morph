import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import { reorderStorefrontThemeSections } from "@/server/storefront/storefront-themes.serverFn";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, GripVertical, Layers3, Plus } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import {
  resolveEditorTemplate,
  toEditorTemplateSearch,
} from "./editor-template";

export type EditorSectionsPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  style?: React.CSSProperties;
  className?: string;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  onSectionOrderChange: (sectionIds: string[]) => void;
  onSaveStateChange: (state: "idle" | "saving" | "error") => void;
  onReorderSections?: (sectionIds: string[]) => Promise<unknown>;
};

type EditorSection =
  StorefrontThemeEditorDTO["templates"][number]["document"]["sections"][number];

function moveSection(items: EditorSection[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return items;
  next.splice(to, 0, moved);
  return next;
}

function SortableSectionRow({
  section,
  index,
  selected,
  disabled,
  onSelect,
}: {
  section: EditorSection;
  index: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: section.id,
    index,
    disabled,
  });
  return (
    <div
      ref={ref}
      className={cn(
        "group flex w-full min-w-0 items-center rounded-md px-1.5 py-0.5 hover:bg-accent transition-colors",
        selected && "bg-accent",
        isDragging && "opacity-40",
      )}
    >
      <button
        ref={handleRef}
        type="button"
        className="cursor-grab p-1 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
        tabIndex={-1}
        aria-label={`Reorder section ${section.type}`}
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
      >
        <span className="w-3.5 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">
          {section.type}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-foreground" />
      </button>
    </div>
  );
}

export const EditorSectionsPanel = memo(function EditorSectionsPanel({
  context,
  search,
  style,
  className,
  onSearchChange,
  onSectionOrderChange,
  onSaveStateChange,
  onReorderSections,
}: EditorSectionsPanelProps) {
  const activeTemplate = resolveEditorTemplate(context, search);
  const sourceSections = activeTemplate?.document.sections ?? [];
  const [sections, setSections] = useState(sourceSections);
  const sectionsRef = useRef(sourceSections);
  const dragStartSectionsRef = useRef<EditorSection[] | null>(null);
  const updateSections = (next: EditorSection[]) => {
    sectionsRef.current = next;
    setSections(next);
    onSectionOrderChange(next.map((section) => section.id));
  };
  const queryClient = useQueryClient();
  const sensors = useMemo(
    () => [
      PointerSensor.configure({
        activationConstraints: [
          new PointerActivationConstraints.Distance({ value: 8 }),
        ],
      }),
    ],
    [],
  );
  const reorderMutation = useMutation({
    onMutate: () => onSaveStateChange("saving"),
    mutationFn: async (sectionIds: string[]) => {
      if (onReorderSections) {
        return onReorderSections(sectionIds);
      }
      if (!activeTemplate) throw new Error("No active template");
      return reorderStorefrontThemeSections({
        data: {
          storefrontId: context.storefront.id,
          themeId: context.theme.id,
          templateId: activeTemplate.id,
          sectionIds,
          expectedDraftGeneration: activeTemplate.draftGeneration,
        },
      });
    },
    onSuccess: async (result: any) => {
      if (result && !result.success) {
        updateSections(sourceSections);
        onSaveStateChange("error");
        toast.error(result.message);
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: storefrontThemeQueries.detail(
          context.storefront.id,
          context.theme.id,
        ).queryKey,
      });
      onSaveStateChange("idle");
    },
    onError: () => {
      updateSections(sourceSections);
      onSaveStateChange("error");
      toast.error("Failed to reorder theme sections");
    },
  });

  useEffect(() => {
    sectionsRef.current = sourceSections;
    setSections(sourceSections);
  }, [sourceSections]);

  return (
    <aside
      style={style}
      className={cn(
        "grid min-h-0 min-w-0 shrink-0 grid-cols-1 grid-rows-[3.25rem_auto_minmax(0,1fr)_auto] border-r bg-component max-md:hidden",
        className,
      )}
    >
      <header className="flex w-full items-center gap-2 border-b px-3">
        <Layers3 className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Sections</h2>
      </header>

      <div className="w-full border-b p-3">
        <Select
          value={activeTemplate?.id}
          onValueChange={(templateId) => {
            const template = context.templates.find(
              (candidate) => candidate.id === templateId,
            );
            if (template) onSearchChange(toEditorTemplateSearch(template));
          }}
        >
          <SelectTrigger size="sm" aria-label="Template" className="w-full">
            <SelectValue placeholder="Select template" />
          </SelectTrigger>
          <SelectContent align="start">
            {context.templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="min-h-0 w-full">
        <div className="w-full space-y-1 p-2">
          {sections.length > 0 ? (
            <DragDropProvider
              sensors={sensors}
              onDragStart={() => {
                dragStartSectionsRef.current = sectionsRef.current;
              }}
              onDragOver={(event) => {
                if (reorderMutation.isPending) return;
                const { source, target } = event.operation;
                if (
                  !source ||
                  !target ||
                  !isSortable(source) ||
                  !isSortable(target) ||
                  source.id === target.id
                )
                  return;

                const current = sectionsRef.current;
                const from = current.findIndex(
                  (section) => section.id === source.id,
                );
                const to = current.findIndex(
                  (section) => section.id === target.id,
                );
                if (from < 0 || to < 0 || from === to) return;
                updateSections(moveSection(current, from, to));
              }}
              onDragEnd={(event) => {
                const initial = dragStartSectionsRef.current;
                dragStartSectionsRef.current = null;
                if (!initial || reorderMutation.isPending) return;
                if (event.canceled) {
                  updateSections(initial);
                  return;
                }

                const next = sectionsRef.current;
                const initialIds = initial.map((section) => section.id);
                const nextIds = next.map((section) => section.id);
                if (initialIds.every((id, index) => id === nextIds[index])) {
                  return;
                }
                reorderMutation.mutate(nextIds);
              }}
            >
              {sections.map((section, index) => (
                <SortableSectionRow
                  key={section.id}
                  section={section}
                  index={index}
                  selected={search.section === section.id}
                  disabled={reorderMutation.isPending}
                  onSelect={() => onSearchChange({ section: section.id })}
                />
              ))}
            </DragDropProvider>
          ) : (
            <div className="m-1 rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
              This template has no sections yet. New sections will appear here
              in their storefront order.
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="border-t p-3">
        <Button variant="outline" size="sm" className="w-full" disabled>
          <Plus /> Add section
        </Button>
      </div>
    </aside>
  );
});
