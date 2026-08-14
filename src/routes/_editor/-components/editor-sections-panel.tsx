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
import { ChevronRight, GripVertical, Layers3, Plus } from "lucide-react";
import { memo } from "react";
import {
  resolveEditorTemplate,
  toEditorTemplateSearch,
} from "./editor-template";

type EditorSectionsPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
};

export const EditorSectionsPanel = memo(function EditorSectionsPanel({
  context,
  search,
  onSearchChange,
}: EditorSectionsPanelProps) {
  const activeTemplate = resolveEditorTemplate(context, search);
  const sections = activeTemplate?.document.sections ?? [];

  return (
    <aside className="grid w-[15rem] min-h-0 grid-rows-[3.25rem_auto_minmax(0,1fr)_auto] border-r bg-component max-md:hidden xl:w-[17rem]">
      <header className="flex items-center gap-2 border-b px-3">
        <Layers3 className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Sections</h2>
      </header>

      <div className="border-b p-3">
        <Select
          value={activeTemplate?.id}
          onValueChange={(templateId) => {
            const template = context.templates.find(
              (candidate) => candidate.id === templateId,
            );
            if (template) onSearchChange(toEditorTemplateSearch(template));
          }}
        >
          <SelectTrigger size="sm" aria-label="Template">
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

      <ScrollArea className="min-h-0">
        <div className="space-y-1 p-2">
          {sections.length > 0 ? (
            sections.map((section, index) => (
              <div
                key={section.id}
                className={cn(
                  "group flex items-center rounded-md pr-1 hover:bg-accent",
                  search.section === section.id && "bg-accent",
                )}
              >
                <button
                  type="button"
                  disabled
                  title="Section reordering will save through draft revisions"
                  aria-label={`Reorder ${section.type}`}
                  className="flex size-8 shrink-0 cursor-grab items-center justify-center text-muted-foreground disabled:cursor-not-allowed"
                >
                  <GripVertical className="size-4" />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSearchChange({ section: section.id })}
                >
                  <span className="w-4 shrink-0 text-center text-[10px] tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {section.type}
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              </div>
            ))
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
