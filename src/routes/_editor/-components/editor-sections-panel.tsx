import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { ThemeRouteRecord } from "@/lib/storefront/compiler/theme-route-registry";
import type { ThemeRouteSectionOption } from "@/lib/storefront/compiler/theme-route-sections";
import type { EditorSelectionDescriptor } from "@/lib/storefront/editor/selection-taxonomy";
import type {
  PreviewEditableNode,
  PreviewSelectionRestoreTarget,
} from "@/lib/storefront/editor/preview-protocol";
import { isGeneratedElementName } from "@/lib/storefront/editor/theme-instance-style-source";
import type { StorefrontThemeEditorSearch } from "@/lib/validations/storefront-theme";
import { cn } from "@/lib/utils";
import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Blocks,
  Box,
  ChevronDown,
  ChevronRight,
  Code2,
  Component,
  Eye,
  EyeOff,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImageIcon,
  Layers3,
  Link,
  ListTree,
  Minus,
  MousePointerClick,
  Plus,
  Table2,
  TextCursorInput,
  TextQuote,
  Type,
  Video,
  FileCode2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { storefrontThemeQueries } from "../-queries/storefront-theme.queries";
import {
  resolveEditorTemplate,
  templateAppliesToRoute,
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
  onToggleSectionEnabled?: (sectionId: string, enabled: boolean) => void;
  editableNodes?: readonly PreviewEditableNode[];
  activeSelection?: EditorSelectionDescriptor | null;
  onSelectEditableNode?: (target: PreviewSelectionRestoreTarget) => void;
  /** Source route currently rendered by the Design preview. */
  activeRoute?: ThemeRouteRecord | null;
  /**
   * The URL already points at a source route, but its file tree has not been
   * loaded yet. Keep the previous template sections out of the first paint so
   * the tree never briefly shows a different page.
   */
  routeStructurePending?: boolean;
  themeRoutes?: readonly ThemeRouteRecord[];
  /** Warm a route before navigation commits. */
  onPrefetchThemeRoute?: (route: ThemeRouteRecord) => void;
  onOpenThemeRoute?: (route: ThemeRouteRecord) => void;
  /** Explicit "show me the source" action on a page row. */
  onOpenThemeRouteCode?: (route: ThemeRouteRecord) => void;
  sectionOptions?: readonly ThemeRouteSectionOption[];
  onAddSection?: (option: ThemeRouteSectionOption) => Promise<unknown>;
  onDeleteSection?: (
    sectionId: string,
  ) => Promise<EditorEditableNodeDeleteResult>;
  onDeleteEditableNode?: (
    node: PreviewEditableNode,
  ) => Promise<EditorEditableNodeDeleteResult>;
};

export type EditorEditableNodeDeleteResult =
  { success: true } | { success: false; message: string };

// Preview structure can arrive immediately before this panel commits. Apply
// expansion state in a browser layout effect so the first painted tree already
// has its expected open branches. Falling back to useEffect during SSR keeps
// hydration safe and avoids a server-side useLayoutEffect warning.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type EditorSection =
  StorefrontThemeEditorDTO["templates"][number]["document"]["sections"][number];

/** Shared empty tree; a new literal would defeat the identity checks below. */
const NO_SECTIONS: EditorSection[] = [];

type EditorDeleteCandidate =
  | { kind: "section"; sectionId: string; label: string }
  | { kind: "node"; node: PreviewEditableNode; label: string };

type EditableNodeIcon = Readonly<{
  component: LucideIcon;
  name: string;
}>;

const HEADING_ICONS: Readonly<Record<string, EditableNodeIcon>> = {
  h1: { component: Heading1, name: "h1" },
  h2: { component: Heading2, name: "h2" },
  h3: { component: Heading3, name: "h3" },
  h4: { component: Heading4, name: "h4" },
  h5: { component: Heading5, name: "h5" },
  h6: { component: Heading6, name: "h6" },
};

function editableNodeIcon(node: PreviewEditableNode): EditableNodeIcon {
  if (node.kind === "heading") {
    return (
      HEADING_ICONS[node.tagName ?? ""] ?? {
        component: Type,
        name: "heading",
      }
    );
  }
  if (["container", "layout", "component", "repeater"].includes(node.kind)) {
    return { component: Box, name: "block" };
  }
  if (["image", "picture", "icon", "svg", "canvas"].includes(node.kind)) {
    return { component: ImageIcon, name: "image" };
  }
  if (["paragraph", "text", "rich-text", "label"].includes(node.kind)) {
    return { component: Type, name: "text" };
  }
  if (node.kind === "blockquote") {
    return { component: TextQuote, name: "blockquote" };
  }
  if (node.kind === "code") return { component: Code2, name: "code" };
  if (node.kind === "link") return { component: Link, name: "link" };
  if (node.kind === "button") {
    return { component: MousePointerClick, name: "button" };
  }
  if (["video", "audio", "iframe", "embed", "map"].includes(node.kind)) {
    return { component: Video, name: "media" };
  }
  if (
    [
      "form",
      "fieldset",
      "input",
      "textarea",
      "select",
      "option",
      "checkbox",
      "radio",
      "switch",
      "file-input",
    ].includes(node.kind)
  ) {
    return { component: TextCursorInput, name: "form-control" };
  }
  if (
    ["list", "list-item", "navigation", "details", "summary"].includes(
      node.kind,
    )
  ) {
    return { component: ListTree, name: "structure" };
  }
  if (
    ["table", "table-section", "table-row", "table-cell"].includes(node.kind)
  ) {
    return { component: Table2, name: "table" };
  }
  if (["divider", "spacer"].includes(node.kind)) {
    return { component: Minus, name: node.kind };
  }
  return { component: Component, name: node.kind };
}

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
  expanded,
  hasChildren,
  onSelect,
  onToggleExpanded,
  onToggleEnabled,
  onRequestDelete,
  deleteDisabled,
  children,
}: {
  section: EditorSection;
  index: number;
  selected: boolean;
  disabled: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onToggleEnabled: () => void;
  onRequestDelete: () => void;
  deleteDisabled?: boolean;
  children?: React.ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: section.id,
    index,
    disabled,
  });
  return (
    <SidebarMenuItem ref={ref} className={cn(isDragging && "opacity-40")}>
      <Collapsible open={expanded} onOpenChange={onToggleExpanded}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="group/section flex min-w-0 items-center"
              onClick={onSelect}
              onContextMenu={onSelect}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
                  aria-label={`${expanded ? "Collapse" : "Expand"} section ${section.type}`}
                  aria-expanded={hasChildren ? expanded : undefined}
                  disabled={!hasChildren}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  {expanded ? (
                    <ChevronDown className="size-3.5" />
                  ) : (
                    <ChevronRight className="size-3.5" />
                  )}
                </button>
              </CollapsibleTrigger>
              <SidebarMenuButton
                ref={handleRef}
                type="button"
                size="sm"
                isActive={selected}
                className={cn(
                  "min-w-0 flex-1 px-1.5",
                  isDragging ? "cursor-grabbing" : "cursor-pointer",
                )}
                title={`Select ${section.type}; drag to reorder`}
              >
                <Blocks
                  className="shrink-0 text-muted-foreground"
                  data-editor-tree-icon="section"
                  aria-hidden="true"
                />
                <span>{section.type}</span>
              </SidebarMenuButton>
              <SidebarMenuAction
                type="button"
                showOnHover
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleEnabled();
                }}
                className={cn(
                  "top-1 right-1 size-5",
                  section.enabled === false && "opacity-100",
                )}
                aria-label={
                  section.enabled === false
                    ? "Show section " + section.type
                    : "Hide section " + section.type
                }
                title={
                  section.enabled === false ? "Show section" : "Hide section"
                }
              >
                {section.enabled === false ? <EyeOff /> : <Eye />}
              </SidebarMenuAction>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem
              variant="destructive"
              disabled={deleteDisabled}
              onSelect={onRequestDelete}
            >
              <Trash2 className="size-3.5" />
              <span>Delete</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                Del
              </span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

/**
 * A direct route can own the preview DOM without declaring `content(...)`
 * sections. Keep that source tree visible without pretending it is a stored
 * section (which would incorrectly enable reorder, visibility, or delete).
 */
function RouteTreeRootRow({
  label,
  expanded,
  hasChildren,
  onToggleExpanded,
  children,
}: {
  label: string;
  expanded: boolean;
  hasChildren: boolean;
  onToggleExpanded: () => void;
  children?: React.ReactNode;
}) {
  return (
    <SidebarMenuItem>
      <Collapsible open={expanded} onOpenChange={onToggleExpanded}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full min-w-0 items-center rounded-md px-1.5 text-left text-sm text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            aria-label={`${expanded ? "Collapse" : "Expand"} route ${label}`}
            aria-expanded={hasChildren ? expanded : undefined}
            disabled={!hasChildren}
          >
            {expanded ? (
              <ChevronDown className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mr-1.5 size-3.5 shrink-0 text-muted-foreground" />
            )}
            <FileCode2
              className="mr-1.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{label}</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

function selectionMatchesEditableNode(
  node: PreviewEditableNode,
  selection: EditorSelectionDescriptor | null | undefined,
): boolean {
  if (!selection || selection.isSection) return false;
  const target = node.target;
  if (target.fieldPath && selection.fieldPath) {
    return target.fieldPath === selection.fieldPath;
  }
  if (target.nodeId && selection.nodeId) {
    return target.nodeId === selection.nodeId;
  }
  if (target.fieldKey && selection.fieldKey) {
    return target.fieldKey === selection.fieldKey;
  }
  // A plain layout element carries no field, no marker and no element key. Its
  // compile-time source position is the only identity it has, and leaving it
  // out here is what left such an element selected on the canvas with nothing
  // selected in the tree.
  if (target.sourceLocation && selection.sourceLocation) {
    return target.sourceLocation === selection.sourceLocation;
  }
  return Boolean(
    target.elementKey && target.elementKey === selection.elementKey,
  );
}

function EditableNodeRow({
  node,
  selected,
  expanded,
  hasChildren,
  onSelect,
  onToggleExpanded,
  onRequestDelete,
  deleteDisabled,
  children,
}: {
  node: PreviewEditableNode;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onRequestDelete: () => void;
  deleteDisabled?: boolean;
  children?: React.ReactNode;
}) {
  const icon = editableNodeIcon(node);
  const NodeIcon = icon.component;
  return (
    <SidebarMenuSubItem
      data-editor-tree-node-selected={selected ? "true" : undefined}
      isActive={selected}
      className="h-auto min-h-8 gap-0 overflow-visible pl-0 data-[active=false]:hover:bg-transparent! [&>div:first-child]:hidden"
    >
      <Collapsible
        open={expanded}
        onOpenChange={onToggleExpanded}
        className="w-full"
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className="flex h-8 w-full min-w-0 cursor-pointer items-center"
              onClick={onSelect}
              onContextMenu={onSelect}
            >
              {hasChildren ? (
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
                    className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </button>
                </CollapsibleTrigger>
              ) : (
                <span
                  className="flex size-6 shrink-0 items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="size-1 rounded-full bg-muted-foreground/50" />
                </span>
              )}
              <SidebarMenuSubButton asChild size="sm" isActive={selected}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  className="h-8 min-w-0 flex-1 cursor-pointer text-left"
                  title={
                    node.stableId
                      ? `${node.label} · ${node.stableId}${
                          isGeneratedElementName(node.stableId)
                            ? " (added by the editor)"
                            : ""
                        }`
                      : node.label
                  }
                >
                  <NodeIcon
                    className="shrink-0 text-muted-foreground"
                    data-editor-tree-icon={icon.name}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{node.label}</span>
                  {node.stableId ? (
                    // Marked rather than named: a style bound to one instance needs
                    // an identity that survives edits, so which elements have one is
                    // worth seeing — but `el-a3f9c2b4d1e0` names nothing, and in
                    // place of "Heading" it would make the tree unreadable.
                    <span
                      aria-hidden="true"
                      data-editor-tree-identity={
                        isGeneratedElementName(node.stableId)
                          ? "generated"
                          : "authored"
                      }
                      className="mr-1 size-1 shrink-0 rounded-full bg-muted-foreground/40 data-[editor-tree-identity=authored]:bg-muted-foreground/70"
                    />
                  ) : null}
                </button>
              </SidebarMenuSubButton>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem
              variant="destructive"
              disabled={deleteDisabled}
              onSelect={onRequestDelete}
            >
              <Trash2 className="size-3.5" />
              <span>Delete</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                Del
              </span>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarMenuSubItem>
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
  onToggleSectionEnabled,
  editableNodes = [],
  activeSelection,
  onSelectEditableNode,
  activeRoute = null,
  routeStructurePending = false,
  themeRoutes = [],
  onPrefetchThemeRoute,
  onOpenThemeRoute,
  onOpenThemeRouteCode,
  sectionOptions = [],
  onAddSection,
  onDeleteSection,
  onDeleteEditableNode,
}: EditorSectionsPanelProps) {
  const activeTemplate = resolveEditorTemplate(context, search);
  // A route whose kind has no template still loads the editor against a
  // borrowed one. Showing that template's sections here is what let the panel
  // offer the product template for editing while an About page was previewed,
  // so the tree falls back to the route's own structure instead.
  // Memoised because an effect below syncs state from this array by identity:
  // returning a fresh `[]` each render sets state on every render, which is an
  // infinite loop rather than an empty tree.
  const sourceSections = useMemo(
    () =>
      templateAppliesToRoute(activeTemplate, search.routePath)
        ? (activeTemplate?.document.sections ?? NO_SECTIONS)
        : NO_SECTIONS,
    [activeTemplate, search.routePath],
  );
  const [sections, setSections] = useState(sourceSections);
  const sectionsRef = useRef(sourceSections);
  const dragStartSectionsRef = useRef<EditorSection[] | null>(null);
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(
    () => new Set(search.section ? [search.section] : []),
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [deleteCandidate, setDeleteCandidate] =
    useState<EditorDeleteCandidate | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const nodesByParent = useMemo(() => {
    const result = new Map<string, PreviewEditableNode[]>();
    for (const node of editableNodes) {
      const key = `${node.sectionId}\u0000${node.parentId ?? ""}`;
      const siblings = result.get(key) ?? [];
      siblings.push(node);
      result.set(key, siblings);
    }
    return result;
  }, [editableNodes]);
  const templateSectionIds = useMemo(
    () => new Set(sections.map((section) => section.id)),
    [sections],
  );

  /**
   * The page's own roots: layout shell, route file, Header, Footer.
   *
   * These were shown only when the template had no sections, so Home listed
   * five editable sections and no way to reach the header or footer that were
   * plainly on the canvas -- the same header a product page let you select.
   * They are ordered by where they appear in the rendered page and split
   * around the template's sections, so the tree reads top to bottom like the
   * page does.
   */
  const layoutRoots = useMemo(() => {
    const before: string[] = [];
    const after: string[] = [];
    if (!activeRoute) return { before, after };
    const seen = new Set<string>();
    let passedTemplateSections = false;
    for (const node of editableNodes) {
      const sectionId = node.sectionId;
      if (!sectionId) continue;
      if (templateSectionIds.has(sectionId)) {
        passedTemplateSections = true;
        continue;
      }
      if (seen.has(sectionId)) continue;
      seen.add(sectionId);
      (passedTemplateSections ? after : before).push(sectionId);
    }
    return { before, after };
  }, [activeRoute, editableNodes, templateSectionIds]);

  const layoutRootIds = useMemo(
    () => [...layoutRoots.before, ...layoutRoots.after],
    [layoutRoots],
  );
  const editableNodeById = useMemo(
    () => new Map(editableNodes.map((node) => [node.id, node])),
    [editableNodes],
  );
  const selectedEditableNode = useMemo(
    () =>
      editableNodes.find(
        (node) =>
          node.sectionId === (activeSelection?.sectionId ?? search.section) &&
          selectionMatchesEditableNode(node, activeSelection),
      ) ?? null,
    [activeSelection, editableNodes, search.section],
  );
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
      if (!onReorderSections) {
        throw new Error("This route does not support source reordering.");
      }
      return onReorderSections(sectionIds);
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
  const addMutation = useMutation({
    onMutate: () => onSaveStateChange("saving"),
    mutationFn: async (option: ThemeRouteSectionOption) => {
      if (!onAddSection) {
        throw new Error("This route does not support adding sections.");
      }
      return onAddSection(option);
    },
    onSuccess: () => onSaveStateChange("idle"),
    onError: (error) => {
      onSaveStateChange("error");
      toast.error(
        error instanceof Error ? error.message : "Failed to add section",
      );
    },
  });

  const confirmDelete = async () => {
    if (!deleteCandidate || isDeletePending) return;

    setIsDeletePending(true);
    try {
      const result =
        deleteCandidate.kind === "section"
          ? onDeleteSection
            ? await onDeleteSection(deleteCandidate.sectionId)
            : null
          : onDeleteEditableNode
            ? await onDeleteEditableNode(deleteCandidate.node)
            : null;
      if (!result) return;
      if (result.success) {
        setDeleteCandidate(null);
        return;
      }
      toast.error(result.message);
    } finally {
      setIsDeletePending(false);
    }
  };

  useIsomorphicLayoutEffect(() => {
    sectionsRef.current = sourceSections;
    setSections(sourceSections);
  }, [sourceSections]);

  useIsomorphicLayoutEffect(() => {
    const sectionId = search.section;
    if (!sectionId) return;
    setExpandedSectionIds((current) => {
      if (current.has(sectionId)) return current;
      const next = new Set(current);
      next.add(sectionId);
      return next;
    });
  }, [search.section]);

  useIsomorphicLayoutEffect(() => {
    if (layoutRootIds.length === 0) return;
    setExpandedSectionIds((current) => {
      let changed = false;
      const next = new Set(current);
      for (const sectionId of layoutRootIds) {
        if (next.has(sectionId)) continue;
        next.add(sectionId);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [layoutRootIds]);

  useIsomorphicLayoutEffect(() => {
    if (!selectedEditableNode) return;
    setExpandedSectionIds((current) => {
      if (current.has(selectedEditableNode.sectionId)) return current;
      const next = new Set(current);
      next.add(selectedEditableNode.sectionId);
      return next;
    });
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      let parentId = selectedEditableNode.parentId;
      let changed = false;
      while (parentId) {
        if (!next.has(parentId)) {
          next.add(parentId);
          changed = true;
        }
        parentId = editableNodeById.get(parentId)?.parentId ?? null;
      }
      return changed ? next : current;
    });
  }, [editableNodeById, selectedEditableNode]);

  const renderEditableNodes = (
    sectionId: string,
    parentId: string | null,
  ): React.ReactNode => {
    const nodes =
      nodesByParent.get(`${sectionId}\u0000${parentId ?? ""}`) ?? [];
    if (!nodes.length) return null;
    return (
      <SidebarMenuSub className="ml-3 w-[calc(100%-0.75rem)] gap-0 border-l border-sidebar-border/60 pl-1.5">
        {nodes.map((node) => {
          const hasChildren =
            (nodesByParent.get(`${sectionId}\u0000${node.id}`)?.length ?? 0) >
            0;
          const expanded = expandedNodeIds.has(node.id);
          return (
            <EditableNodeRow
              key={node.id}
              node={node}
              selected={selectedEditableNode?.id === node.id}
              expanded={expanded}
              hasChildren={hasChildren}
              onSelect={() => onSelectEditableNode?.(node.target)}
              onToggleExpanded={() =>
                setExpandedNodeIds((current) => {
                  const next = new Set(current);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
              onRequestDelete={() =>
                setDeleteCandidate({
                  kind: "node",
                  node,
                  label: node.label,
                })
              }
              deleteDisabled={
                isDeletePending ||
                !onDeleteEditableNode ||
                (!node.target.nodeId && !node.target.sourceLocation)
              }
            >
              {hasChildren ? renderEditableNodes(sectionId, node.id) : null}
            </EditableNodeRow>
          );
        })}
      </SidebarMenuSub>
    );
  };

  /** A page root the template does not own: the layout, Header, Footer. */
  const renderLayoutRoot = (sectionId: string): React.ReactNode => {
    const sectionNodes = nodesByParent.get(`${sectionId} `) ?? [];
    const sourceName = sectionId.split("/").at(-1) ?? sectionId;
    const sourceStem = sourceName.replace(/\.[cm]?[jt]sx?$/, "");
    const label =
      sectionId === activeRoute?.sourcePath
        ? activeRoute.path === "/"
          ? "Home"
          : activeRoute.path
        : sourceStem
            .replace(/[-_]+/g, " ")
            .replace(/\w/g, (character) => character.toUpperCase());
    return (
      <RouteTreeRootRow
        key={sectionId}
        label={label}
        expanded={expandedSectionIds.has(sectionId)}
        hasChildren={sectionNodes.length > 0}
        onToggleExpanded={() =>
          setExpandedSectionIds((current) => {
            const next = new Set(current);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
          })
        }
      >
        {sectionNodes.length > 0 ? renderEditableNodes(sectionId, null) : null}
      </RouteTreeRootRow>
    );
  };

  return (
    <aside
      style={style}
      className={cn(
        "min-h-0 min-w-0 shrink-0 border-r bg-component max-md:hidden",
        className,
      )}
    >
      <SidebarProvider className="h-full min-h-0 w-full">
        <Sidebar
          collapsible="none"
          className="h-full min-h-0 w-full bg-component"
        >
          <SidebarHeader className="h-[3.25rem] flex-row items-center gap-2 border-b px-3 py-0">
            <Layers3 className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Pages &amp; Sections</h2>
          </SidebarHeader>

          {themeRoutes.length > 0 ? (
            <SidebarGroup className="border-b border-solid p-2">
              <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                Pages
              </div>
              <SidebarMenu aria-label="Theme pages">
                {themeRoutes.map((route) => (
                  <SidebarMenuItem
                    key={`${route.sourcePath}:${route.path}`}
                    className="group/page"
                  >
                    <SidebarMenuButton
                      type="button"
                      size="sm"
                      className="cursor-pointer"
                      isActive={(search.routePath ?? "/") === route.path}
                      onMouseEnter={() => onPrefetchThemeRoute?.(route)}
                      onFocus={() => onPrefetchThemeRoute?.(route)}
                      onClick={() => onOpenThemeRoute?.(route)}
                      title={`Preview ${route.path}`}
                    >
                      <FileCode2 aria-hidden="true" />
                      <span>{route.path === "/" ? "Home /" : route.path}</span>
                    </SidebarMenuButton>
                    {/* Opening the source is a deliberate act, not what every
                        click on a page happens to do. */}
                    <SidebarMenuAction
                      type="button"
                      aria-label={`Open ${route.sourcePath}`}
                      title={`Open ${route.sourcePath}`}
                      className="opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/page:opacity-100 group-hover/page:opacity-100"
                      onClick={() => onOpenThemeRouteCode?.(route)}
                    >
                      <Code2 aria-hidden="true" />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          ) : null}

          <SidebarContent className="min-h-0 w-full">
            <SidebarGroup className="border-0 p-2" aria-label="Theme structure">
              {routeStructurePending ? (
                <div
                  className="m-1 rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  Loading route structure…
                </div>
              ) : sections.length > 0 || layoutRootIds.length > 0 ? (
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
                    if (
                      initialIds.every((id, index) => id === nextIds[index])
                    ) {
                      return;
                    }
                    reorderMutation.mutate(nextIds);
                  }}
                >
                  <SidebarMenu>
                    {layoutRoots.before.map(renderLayoutRoot)}
                    {sections.map((section, index) => {
                      const sectionNodes =
                        nodesByParent.get(`${section.id}\u0000`) ?? [];
                      const expanded = expandedSectionIds.has(section.id);
                      return (
                        <SortableSectionRow
                          key={section.id}
                          section={section}
                          index={index}
                          selected={
                            (activeSelection?.sectionId ?? search.section) ===
                              section.id &&
                            (!activeSelection || activeSelection.isSection)
                          }
                          disabled={reorderMutation.isPending}
                          expanded={expanded}
                          hasChildren={sectionNodes.length > 0}
                          onSelect={() =>
                            onSearchChange({ section: section.id })
                          }
                          onToggleExpanded={() =>
                            setExpandedSectionIds((current) => {
                              const next = new Set(current);
                              if (next.has(section.id)) next.delete(section.id);
                              else next.add(section.id);
                              return next;
                            })
                          }
                          onToggleEnabled={() =>
                            onToggleSectionEnabled?.(
                              section.id,
                              section.enabled === false,
                            )
                          }
                          onRequestDelete={() =>
                            setDeleteCandidate({
                              kind: "section",
                              sectionId: section.id,
                              label: section.type,
                            })
                          }
                          deleteDisabled={
                            isDeletePending ||
                            reorderMutation.isPending ||
                            !onDeleteSection
                          }
                        >
                          {sectionNodes.length > 0
                            ? renderEditableNodes(section.id, null)
                            : null}
                        </SortableSectionRow>
                      );
                    })}
                    {layoutRoots.after.map(renderLayoutRoot)}
                  </SidebarMenu>
                </DragDropProvider>
              ) : (
                <div className="m-1 rounded-md border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
                  This template has no sections yet. New sections will appear
                  here in their storefront order.
                </div>
              )}
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={
                    !onAddSection ||
                    sectionOptions.length === 0 ||
                    addMutation.isPending ||
                    reorderMutation.isPending
                  }
                >
                  <Plus /> Add section
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {sectionOptions.map((option) => (
                  <DropdownMenuItem
                    key={option.componentRef}
                    onSelect={() => addMutation.mutate(option)}
                  >
                    <Blocks aria-hidden="true" />
                    <span>{option.sectionType}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        <AlertDialog
          open={deleteCandidate !== null}
          onOpenChange={(open) => {
            if (!open && !isDeletePending) setDeleteCandidate(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete “{deleteCandidate?.label ?? "element"}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteCandidate?.kind === "section"
                  ? "This removes the section from the Theme route source and its content from this page. The change can be undone from the editor history."
                  : "This removes the selected element and all of its nested content from the Theme source. The change can be undone from the editor history."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletePending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDeletePending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDelete();
                }}
              >
                {isDeletePending ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarProvider>
    </aside>
  );
});
