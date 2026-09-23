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
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { Input } from "@/components/ui/input";
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
import {
  EditorAddPageDialog,
  type AddPageResult,
} from "./editor-add-page-dialog";
import type { ThemeRouteSectionOption } from "@/lib/storefront/compiler/theme-route-sections";
import type { EditorUnboundSection } from "@/lib/storefront/editor/editor-section-model";
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
import {
  planSectionDragEnd,
  planSectionDragOver,
} from "./section-reorder-gesture";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Blocks,
  Box,
  ChevronDown,
  ChevronRight,
  Code2,
  Component,
  Copy,
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
  PenLine,
  Plus,
  Table2,
  TextCursorInput,
  TextQuote,
  Type,
  Video,
  FileCode2,
  Globe,
  CircleAlert,
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
import { splitPageRoots } from "@/lib/storefront/editor/page-structure";
import {
  resolveEditorTemplate,
  routeOwnsDocument,
  templateAppliesToRoute,
} from "./editor-template";
import { EditorPagesSearch } from "./editor-pages-search";
import {
  GLOBAL_LAYOUT_LABEL,
  SHARED_LAYOUT_HINT,
} from "./editor-layout-labels";
import { parseThemeSourceLocation } from "@/lib/storefront/compiler/theme-source-location-plugin";

/**
 * What a reorder reports back.
 *
 * The shell's implementation throws on every failure and returns
 * `{ success: true }` otherwise, so the failure branch below is defensive
 * rather than exercised. It is declared because the prop is an extension
 * point: a route that reports a failure instead of throwing needs somewhere to
 * say so, and `Promise<unknown>` here is what let an `any` sit on the panel's
 * error path.
 */
export type SectionReorderResult = {
  success: boolean;
  message?: string;
};

export type EditorSectionsPanelProps = {
  context: StorefrontThemeEditorDTO;
  search: StorefrontThemeEditorSearch;
  style?: React.CSSProperties;
  className?: string;
  onSearchChange: (next: Partial<StorefrontThemeEditorSearch>) => void;
  onSectionOrderChange: (sectionIds: string[]) => void;
  onSaveStateChange: (state: "idle" | "saving" | "error") => void;
  onReorderSections?: (
    sectionIds: string[],
  ) => Promise<SectionReorderResult | void>;
  onToggleSectionEnabled?: (sectionId: string, enabled: boolean) => void;
  editableNodes?: readonly PreviewEditableNode[];
  activeSelection?: EditorSelectionDescriptor | null;
  onSelectEditableNode?: (target: PreviewSelectionRestoreTarget) => void;
  /** Source route currently rendered by the Design preview. */
  activeRoute?: ThemeRouteRecord | null;
  /**
   * Shared layout slots known from Theme source before the preview iframe is
   * ready. Runtime structure later enriches these rows with DOM children.
   */
  sourceLayoutRoots?: Readonly<{
    before: readonly string[];
    after: readonly string[];
  }>;
  /**
   * The URL already points at a source route, but its file tree has not been
   * loaded yet. Keep the previous template sections out of the first paint so
   * the tree never briefly shows a different page.
   */
  routeStructurePending?: boolean;
  /**
   * Sections the layout owns, which every page renders.
   *
   * They appear in this page's document so the tree can show them, but they
   * belong to another one, and only the page's own sections can be reordered.
   */
  sharedSectionIds?: ReadonlySet<string>;
  /**
   * Source paths and section ids whose definition is shared by more than one
   * rendered page. A child delete would otherwise rewrite the shared TSX.
   */
  sharedLayoutPaths?: ReadonlySet<string>;
  themeRoutes?: readonly ThemeRouteRecord[];
  /** Warm a route before navigation commits. */
  onPrefetchThemeRoute?: (route: ThemeRouteRecord) => void;
  onOpenThemeRoute?: (route: ThemeRouteRecord) => void;
  /** Explicit "show me the source" action on a page row. */
  onOpenThemeRouteCode?: (route: ThemeRouteRecord) => void;
  onAddPage?: (routePath: string) => Promise<AddPageResult>;
  onDeletePage?: (route: ThemeRouteRecord) => Promise<AddPageResult>;
  sectionOptions?: readonly ThemeRouteSectionOption[];
  onAddSection?: (option: ThemeRouteSectionOption) => Promise<unknown>;
  unboundSectionCandidates?: readonly EditorUnboundSection[];
  onBindSection?: (candidate: EditorUnboundSection) => Promise<unknown>;
  onDeleteSection?: (
    sectionId: string,
  ) => Promise<EditorEditableNodeDeleteResult>;
  /** Create a page-owned component copy before allowing structural edits. */
  detachableSectionIds?: ReadonlySet<string>;
  onDetachSection?: (
    sectionId: string,
  ) => Promise<EditorEditableNodeDeleteResult>;
  /** `null` clears the name and restores the one derived from the component. */
  onRenameSection?: (
    sectionId: string,
    name: string | null,
  ) => Promise<unknown>;
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
const NO_EDITABLE_NODES: readonly PreviewEditableNode[] = [];
const NO_LAYOUT_ROOTS: Readonly<{
  before: readonly string[];
  after: readonly string[];
}> = { before: [], after: [] };

type EditorDeleteCandidate =
  | { kind: "section"; sectionId: string; label: string }
  | { kind: "node"; node: PreviewEditableNode; label: string }
  | { kind: "detach"; sectionId: string; label: string };

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

function SortableSectionRow({
  section,
  displayLabel,
  domIdentity,
  index,
  selected,
  disabled,
  expanded,
  hasChildren,
  onSelect,
  onToggleExpanded,
  onToggleEnabled,
  onRequestDelete,
  onRequestRename,
  deleteDisabled,
  rootNode,
  rootNodeSelected,
  children,
}: {
  section: EditorSection;
  /** The real preview root's label; CMS section metadata stays on this row. */
  displayLabel: string;
  /** `section#hero` — what the row's element is, shown beside its name. */
  domIdentity?: string;
  index: number;
  selected: boolean;
  disabled: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onToggleEnabled: () => void;
  onRequestDelete: () => void;
  /** Absent while the editor has no writable template to store the name in. */
  onRequestRename?: () => void;
  deleteDisabled?: boolean;
  /**
   * The real DOM root represented by this row, when there is one.
   *
   * The row stands for both, which is why it offers one Delete and not two.
   * Removing the section removes the element that rendered it; offering
   * "Delete element" beside it described the same outcome twice and asked the
   * author to tell two destructive actions apart by name.
   */
  rootNode?: PreviewEditableNode | null;
  /** Whether the current selection is that root, rather than the section. */
  rootNodeSelected?: boolean;
  children?: React.ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: section.id,
    index,
    disabled,
  });
  return (
    <SidebarMenuItem
      ref={ref}
      // Says this row can be reordered. The shell's rows look the same and
      // carry the same icon, but they are deliberately outside the sortable
      // list, so nothing else in the tree distinguishes a row you can drag
      // from one you cannot.
      data-editor-tree-sortable={disabled ? undefined : "true"}
      // A section row stands for a real element whenever the preview reports a
      // root for it, so it answers the same two questions a node row does.
      // Without this a click on that element selected a row the tree could not
      // report as selected — visibly highlighted, and invisible to anything
      // reading the tree.
      data-editor-tree-node-id={rootNode?.id}
      data-editor-tree-node-selected={
        rootNode && rootNodeSelected ? "true" : undefined
      }
      className={cn(isDragging && "opacity-40")}
    >
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
                <span className="truncate">{displayLabel}</span>
                {domIdentity ? (
                  <span
                    aria-hidden="true"
                    className="shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground"
                  >
                    {domIdentity}
                  </span>
                ) : null}
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
                  // Active menu buttons use z-30; the visibility action must
                  // remain above that surface or a selected row intercepts
                  // its click (especially when the label carries "Global").
                  "top-1 right-1 z-40 size-5",
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
            {onRequestRename ? (
              <ContextMenuItem onSelect={onRequestRename}>
                <PenLine className="size-3.5" />
                <span>Rename</span>
              </ContextMenuItem>
            ) : null}
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
/**
 * What the row's element is, in DOM terms: `section#hero`, or `section`.
 *
 * Secondary to the name on purpose. A Section and a Route already have a name
 * the author chose — "Newsletter", "/products" — and every Starter section is
 * rooted in a `<section>`, so leading with the tag would print the same word
 * down the whole tree. The DOM side is still worth seeing, and is where an
 * authored id shows up for these rows.
 */
function domIdentityOf(
  node: PreviewEditableNode | null | undefined,
  options?: { omitTag?: boolean },
) {
  if (!node?.tagName) return undefined;
  if (node.htmlId) {
    return options?.omitTag
      ? `#${node.htmlId}`
      : `${node.tagName}#${node.htmlId}`;
  }
  return options?.omitTag ? undefined : node.tagName;
}

function RouteTreeRootRow({
  label,
  domIdentity,
  onRequestRename,
  shared,
  selected,
  rootNode,
  rootNodeSelected,
  expanded,
  hasChildren,
  onSelect,
  onToggleExpanded,
  children,
}: {
  label: string;
  /** The element identity beside its name, such as `#site-header`. */
  domIdentity?: string;
  /** Absent for a route row, whose name is its path rather than stored. */
  onRequestRename?: () => void;
  /** Supplied by the layout, so it is on every page rather than this one. */
  shared: boolean;
  selected: boolean;
  /** The real DOM root represented by this row, when there is one. */
  rootNode?: PreviewEditableNode | null;
  /** Whether the current selection is that root, rather than the route. */
  rootNodeSelected?: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  children?: React.ReactNode;
}) {
  const Icon = shared ? Globe : FileCode2;
  const row = (
    <SidebarMenuItem
      data-editor-tree-node-id={rootNode?.id}
      data-editor-tree-node-selected={
        rootNode && rootNodeSelected ? "true" : undefined
      }
    >
      <Collapsible open={expanded} onOpenChange={onToggleExpanded}>
        <div className="group/layout-root flex min-w-0 items-center">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${
                shared ? "shared layout" : "route"
              } ${label}${shared ? `. ${SHARED_LAYOUT_HINT}` : ""}`}
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
            type="button"
            size="sm"
            isActive={selected}
            className="min-w-0 flex-1 cursor-pointer px-1.5"
            onClick={onSelect}
            title={shared ? SHARED_LAYOUT_HINT : `Select ${label}`}
          >
            <Icon
              className="shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{label}</span>
            {domIdentity ? (
              <span
                aria-hidden="true"
                className="shrink-0 truncate font-mono text-[0.7rem] text-muted-foreground"
              >
                {domIdentity}
              </span>
            ) : null}
            {/* The sidebar has its own surface token; `text-foreground` is
                tuned for the page background and does not clear 4.5:1 here. */}
            {shared ? (
              <span className="ml-auto shrink-0 pl-2 text-[10px] font-medium text-sidebar-foreground">
                {GLOBAL_LAYOUT_LABEL}
              </span>
            ) : null}
          </SidebarMenuButton>
        </div>
        <CollapsibleContent>{children}</CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
  if (!onRequestRename) return row;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={onRequestRename}>
          <PenLine className="size-3.5" />
          <span>Rename</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  onRequestDetach,
  deleteDisabled,
  deleteDisabledReason,
  children,
}: {
  node: PreviewEditableNode;
  selected: boolean;
  expanded: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleExpanded: () => void;
  onRequestDelete: () => void;
  onRequestDetach?: () => void;
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
  children?: React.ReactNode;
}) {
  const icon = editableNodeIcon(node);
  const NodeIcon = icon.component;
  return (
    <SidebarMenuSubItem
      // Which node this row is, not just whether it is selected. Two rows can
      // read the same — every entry of a repeated field is labelled by the
      // field it fills — so text names a row only when the page happens not to
      // repeat anything.
      data-editor-tree-node-id={node.id}
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
            {onRequestDetach ? (
              <ContextMenuItem onSelect={onRequestDetach}>
                <Copy className="size-3.5" />
                <span>Create page copy</span>
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              variant="destructive"
              disabled={deleteDisabled}
              onSelect={onRequestDelete}
            >
              <Trash2 className="size-3.5" />
              <span>Delete</span>
              <span
                className="ml-auto text-[10px] text-muted-foreground"
                title={deleteDisabledReason}
              >
                {deleteDisabledReason ? "Shared" : "Del"}
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
  editableNodes,
  activeSelection,
  onSelectEditableNode,
  activeRoute = null,
  sourceLayoutRoots = NO_LAYOUT_ROOTS,
  routeStructurePending = false,
  sharedSectionIds,
  sharedLayoutPaths,
  themeRoutes = [],
  onPrefetchThemeRoute,
  onOpenThemeRoute,
  onOpenThemeRouteCode,
  onAddPage,
  onDeletePage,
  sectionOptions = [],
  onAddSection,
  unboundSectionCandidates = [],
  onBindSection,
  onDeleteSection,
  detachableSectionIds,
  onDetachSection,
  onRenameSection,
  onDeleteEditableNode,
}: EditorSectionsPanelProps) {
  const activeTemplate = resolveEditorTemplate(context, search);
  const previewEditableNodes = editableNodes ?? NO_EDITABLE_NODES;
  const documentSections = activeTemplate?.document.sections ?? NO_SECTIONS;
  // A route whose kind has no template still loads the editor against a
  // borrowed one. Showing that template's sections here is what let the panel
  // offer the product template for editing while an About page was previewed,
  // so the tree falls back to the route's own structure instead.
  // Memoised because an effect below syncs state from this array by identity:
  // returning a fresh `[]` each render sets state on every render, which is an
  // infinite loop rather than an empty tree.
  const sourceSections = useMemo(() => {
    // A route with a document of its own lists its sections even before that
    // document exists: the shell hands this panel the route's structure in
    // place of the borrowed template's, and the first write creates the
    // document they are stored in.
    if (
      !templateAppliesToRoute(activeTemplate, search.routePath) &&
      !routeOwnsDocument(search.routePath)
    ) {
      return NO_SECTIONS;
    }
    const all = documentSections;
    // The shell's sections are in this document so the tree can show them,
    // but they are not this page's to order: reordering rewrites the route
    // file, and the route does not declare the layout's slots. Leaving them
    // in the sortable list meant dragging Header sent the route a slot id it
    // had never heard of, which came back as a failed save and looked like
    // the drag doing nothing. Out of this list they render as page roots,
    // which is what they are.
    if (!sharedSectionIds?.size) return all;
    const own = all.filter((section) => !sharedSectionIds.has(section.id));
    return own.length === all.length ? all : own;
  }, [activeTemplate, documentSections, search.routePath, sharedSectionIds]);
  const [sections, setSections] = useState(sourceSections);
  const sectionsRef = useRef(sourceSections);
  const dragStartSectionsRef = useRef<EditorSection[] | null>(null);
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(
    () => new Set(search.section ? [search.section] : []),
  );
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pagesExpanded, setPagesExpanded] = useState(true);
  const [addPageOpen, setAddPageOpen] = useState(false);
  const [pageToDelete, setPageToDelete] = useState<ThemeRouteRecord | null>(
    null,
  );
  const [pageDeletePending, setPageDeletePending] = useState(false);
  const [pageDeleteError, setPageDeleteError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] =
    useState<EditorDeleteCandidate | null>(null);
  const [isDeletePending, setIsDeletePending] = useState(false);
  const [renameCandidate, setRenameCandidate] = useState<{
    sectionId: string;
    /** What the row reads now, so the field opens on the current name. */
    current: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renamePending, setRenamePending] = useState(false);
  const nodesByParent = useMemo(() => {
    const result = new Map<string, PreviewEditableNode[]>();
    for (const node of previewEditableNodes) {
      const key = `${node.sectionId}\u0000${node.parentId ?? ""}`;
      const siblings = result.get(key) ?? [];
      siblings.push(node);
      result.set(key, siblings);
    }
    return result;
  }, [previewEditableNodes]);
  /**
   * A Document section is represented in the preview by a transparent
   * platform wrapper around the component's real root. The wrapper owns the
   * CMS actions, while the first DOM node is the visual identity. Treat a
   * single top-level node as the section row itself; only its descendants are
   * rendered below it. If a component returns a fragment with multiple roots,
   * keep all of those roots as children so no content disappears.
   */
  const normalizedSectionTree = (sectionId: string) => {
    const roots = nodesByParent.get(`${sectionId}\u0000`) ?? [];
    const root = roots.length === 1 ? (roots[0] ?? null) : null;
    const childParentId = root?.id ?? null;
    const children =
      nodesByParent.get(`${sectionId}\u0000${childParentId ?? ""}`) ?? [];
    return { root, children, hasChildren: children.length > 0 };
  };
  const selectNormalizedRoot = (
    sectionId: string,
    root: PreviewEditableNode | null,
  ) => {
    if (root && onSelectEditableNode) {
      onSelectEditableNode(root.target);
      return;
    }
    onSearchChange({ section: sectionId });
  };
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
   */
  const layoutRoots = useMemo(() => {
    if (!activeRoute) {
      return { before: [], after: [], shared: new Set<string>() };
    }
    const rendered = splitPageRoots({
      editableNodes: previewEditableNodes,
      templateSectionIds,
      routeSourcePath: activeRoute.sourcePath,
    });
    const renderedIds = new Set([...rendered.before, ...rendered.after]);
    // Theme source already tells us which shared slots wrap the page. Keep
    // those rows present from the first paint, then let the iframe add route
    // roots and DOM children without replacing or renaming the source rows.
    const before = [
      ...sourceLayoutRoots.before.filter((id) => !renderedIds.has(id)),
      ...rendered.before,
    ];
    const after = [
      ...rendered.after,
      ...sourceLayoutRoots.after.filter((id) => !renderedIds.has(id)),
    ];
    return {
      before,
      after,
      shared: new Set([
        ...sourceLayoutRoots.before,
        ...sourceLayoutRoots.after,
        ...rendered.shared,
      ]),
    };
  }, [
    activeRoute,
    previewEditableNodes,
    sourceLayoutRoots,
    templateSectionIds,
  ]);

  const layoutRootIds = useMemo(
    () => [...layoutRoots.before, ...layoutRoots.after],
    [layoutRoots],
  );
  const editableNodeById = useMemo(
    () => new Map(previewEditableNodes.map((node) => [node.id, node])),
    [previewEditableNodes],
  );
  const selectedEditableNode = useMemo(
    () =>
      previewEditableNodes.find(
        (node) =>
          node.sectionId === (activeSelection?.sectionId ?? search.section) &&
          selectionMatchesEditableNode(node, activeSelection),
      ) ?? null,
    [activeSelection, previewEditableNodes, search.section],
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
    onSuccess: async (result) => {
      if (result && !result.success) {
        updateSections(sourceSections);
        onSaveStateChange("error");
        toast.error(result.message ?? "Failed to reorder theme sections");
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
  const bindMutation = useMutation({
    onMutate: () => onSaveStateChange("saving"),
    mutationFn: async (candidate: EditorUnboundSection) => {
      if (!onBindSection) {
        throw new Error("This section cannot be bound from the current route.");
      }
      return onBindSection(candidate);
    },
    onSuccess: () => onSaveStateChange("idle"),
    onError: (error) => {
      onSaveStateChange("error");
      toast.error(
        error instanceof Error ? error.message : "Failed to bind section",
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
          : deleteCandidate.kind === "detach"
            ? onDetachSection
              ? await onDetachSection(deleteCandidate.sectionId)
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
    // Only when the layout is all there is. With the template's sections in
    // the tree, opening Header and Footer as well buries them under rows
    // nobody asked to see.
    if (layoutRootIds.length === 0 || sections.length > 0) return;
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
  }, [layoutRootIds, sections.length]);

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
          const sourcePath = parseThemeSourceLocation(
            node.target.sourceLocation,
          )?.filePath;
          const isSharedScope =
            sharedLayoutPaths?.has(node.target.sectionId) === true ||
            (sourcePath !== undefined &&
              sharedLayoutPaths?.has(sourcePath) === true);
          const canDetach =
            isSharedScope && detachableSectionIds?.has(node.target.sectionId);
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
              onRequestDetach={
                canDetach
                  ? () =>
                      setDeleteCandidate({
                        kind: "detach",
                        sectionId: node.target.sectionId,
                        // The copy is of the whole section, not of the node
                        // the menu happened to be opened on.
                        label: node.target.sectionId,
                      })
                  : undefined
              }
              deleteDisabled={
                isDeletePending ||
                !onDeleteEditableNode ||
                (!node.target.nodeId && !node.target.sourceLocation) ||
                isSharedScope
              }
              deleteDisabledReason={
                isSharedScope
                  ? "Shared component; edit in Code mode or create a page-specific component first."
                  : undefined
              }
            >
              {hasChildren ? renderEditableNodes(sectionId, node.id) : null}
            </EditableNodeRow>
          );
        })}
      </SidebarMenuSub>
    );
  };

  /** A page root the template does not own: the global Header or Footer. */
  const renderLayoutRoot = (sectionId: string): React.ReactNode => {
    const normalized = normalizedSectionTree(sectionId);
    const sectionNodes = normalized.children;
    const sourceName = sectionId.split("/").at(-1) ?? sectionId;
    const sourceStem = sourceName.replace(/\.[cm]?[jt]sx?$/, "");
    // Layout slot ids are storage identities. The starter reserves the
    // `starter-header`/`starter-footer` forms, but exposing that prefix makes
    // the tree read like an implementation detail. Preserve other authored
    // names and only remove the reserved prefix when it identifies one of the
    // two global shell roles.
    const semanticLayoutStem =
      /^(?:starter[-_])?(header|footer)$/i.exec(sourceStem)?.[1] ?? sourceStem;
    const isGlobalShell = /^(header|footer)$/i.test(semanticLayoutStem);
    const rootLabel =
      sectionId === activeRoute?.sourcePath
        ? activeRoute.path === "/"
          ? "Home"
          : activeRoute.path
        : semanticLayoutStem
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase());
    // A route is its path and a shared layout is its file; neither is a plain
    // DOM element, so neither takes its name from one. Deferring to the root's
    // label also renamed the row a moment after it appeared, because the root
    // is only known once the preview has reported its structure — hidden in
    // the Starter by the coincidence of `Header.tsx` being rooted in a
    // `<header>`, and not hidden at all for one rooted in a `<div>`. What the
    // element actually is goes beside the name instead.
    // A layout section stores its name like any other, and the tree should show
    // it. One entry for the whole site means one name everywhere — which is
    // what the "Global" badge on this row tells the author.
    const storedName = documentSections.find(
      (section) => section.id === sectionId,
    )?.name;
    const label = storedName ?? rootLabel;
    return (
      <RouteTreeRootRow
        key={sectionId}
        label={label}
        // Header/Footer already name the semantic element. Showing a second
        // `header`/`footer` tag is redundant; keep an authored id visible as
        // the useful DOM identity when one exists.
        domIdentity={domIdentityOf(normalized.root, {
          omitTag: isGlobalShell,
        })}
        onRequestRename={
          onRenameSection &&
          documentSections.some((section) => section.id === sectionId)
            ? () => {
                setRenameCandidate({ sectionId, current: label });
                setRenameValue(storedName ?? "");
              }
            : undefined
        }
        shared={layoutRoots.shared.has(sectionId)}
        selected={
          (activeSelection?.sectionId ?? search.section) === sectionId &&
          (!activeSelection ||
            activeSelection.isSection ||
            Boolean(
              normalized.root &&
              selectionMatchesEditableNode(normalized.root, activeSelection),
            ))
        }
        rootNode={normalized.root}
        rootNodeSelected={Boolean(
          activeSelection &&
          !activeSelection.isSection &&
          normalized.root &&
          selectionMatchesEditableNode(normalized.root, activeSelection),
        )}
        expanded={expandedSectionIds.has(sectionId)}
        hasChildren={normalized.hasChildren}
        onSelect={() => selectNormalizedRoot(sectionId, normalized.root)}
        onToggleExpanded={() =>
          setExpandedSectionIds((current) => {
            const next = new Set(current);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
          })
        }
      >
        {sectionNodes.length > 0
          ? renderEditableNodes(sectionId, normalized.root?.id ?? null)
          : null}
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
            <EditorPagesSearch
              routes={themeRoutes}
              onPrefetchRoute={onPrefetchThemeRoute}
              onOpenRoute={onOpenThemeRoute}
            />
          ) : null}

          {themeRoutes.length > 0 ? (
            <Collapsible open={pagesExpanded} onOpenChange={setPagesExpanded}>
              <SidebarGroup className="border-b border-solid p-2">
                <div className="flex items-center gap-1 px-1 pb-1">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1 rounded-md px-1 py-1 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`${pagesExpanded ? "Collapse" : "Expand"} pages`}
                      aria-expanded={pagesExpanded}
                    >
                      {pagesExpanded ? (
                        <ChevronDown className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronRight className="size-3.5 shrink-0" />
                      )}
                      <span className="truncate">Pages</span>
                    </button>
                  </CollapsibleTrigger>
                  <span
                    // `/70` took a 10px counter to 2.72:1 on white. At this
                    // size the text needs 4.5:1, so the dimming has to come
                    // from the size, not from washing the colour out.
                    className="shrink-0 px-1 text-[10px] tabular-nums text-sidebar-foreground"
                    aria-live="polite"
                  >
                    {themeRoutes.length}/{themeRoutes.length}
                  </span>
                  {onAddPage ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Add page"
                      title="Add page"
                      onClick={() => setAddPageOpen(true)}
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>

                <CollapsibleContent>
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
                          <span>
                            {route.path === "/" ? "Home /" : route.path}
                          </span>
                        </SidebarMenuButton>
                        {/* Opening the source is a deliberate act, not what every
                            click on a page happens to do. */}
                        <SidebarMenuAction
                          type="button"
                          aria-label={`Open ${route.sourcePath}`}
                          title={`Open ${route.sourcePath}`}
                          className="right-8 opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/page:opacity-100 group-hover/page:opacity-100"
                          onClick={() => onOpenThemeRouteCode?.(route)}
                        >
                          <Code2 aria-hidden="true" />
                        </SidebarMenuAction>
                        {onDeletePage && route.path !== "/" ? (
                          <SidebarMenuAction
                            type="button"
                            aria-label={`Delete page ${route.path}`}
                            title={`Delete page ${route.path}`}
                            className="opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/page:opacity-100 group-hover/page:opacity-100"
                            onClick={() => {
                              setPageDeleteError(null);
                              setPageToDelete(route);
                            }}
                          >
                            <Trash2 aria-hidden="true" />
                          </SidebarMenuAction>
                        ) : null}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          ) : null}

          <SidebarContent className="min-h-0 w-full">
            {unboundSectionCandidates.length > 0 ? (
              <SidebarGroup
                className="border-b border-dashed p-2"
                aria-label="Unbound section candidates"
              >
                <div className="px-1 pb-1 text-xs font-medium text-muted-foreground">
                  Sections needing binding
                </div>
                <SidebarMenu>
                  {unboundSectionCandidates.map((candidate) => (
                    <SidebarMenuItem key={candidate.sourceLocation}>
                      <SidebarMenuButton
                        type="button"
                        size="sm"
                        className="min-w-0"
                        disabled={!candidate.canBind || bindMutation.isPending}
                        onClick={() =>
                          candidate.canBind && bindMutation.mutate(candidate)
                        }
                        title={
                          candidate.canBind
                            ? candidate.owner === "shell"
                              ? `Bind ${candidate.componentName} to Design content on every page`
                              : `Bind ${candidate.componentName} to Design content`
                            : candidate.diagnostic
                        }
                      >
                        {candidate.canBind ? (
                          <Blocks aria-hidden="true" />
                        ) : (
                          <CircleAlert aria-hidden="true" />
                        )}
                        <span className="min-w-0 truncate">
                          {candidate.componentName}
                        </span>
                        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                          {candidate.canBind
                            ? candidate.owner === "shell"
                              ? "Every page"
                              : "This page"
                            : "Unsupported"}
                        </span>
                      </SidebarMenuButton>
                      {candidate.canBind ? (
                        <SidebarMenuAction
                          type="button"
                          showOnHover
                          aria-label={`Bind ${candidate.componentName}`}
                          title="Enable Design content"
                          disabled={bindMutation.isPending}
                          onClick={() => bindMutation.mutate(candidate)}
                        >
                          <Link aria-hidden="true" />
                        </SidebarMenuAction>
                      ) : null}
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
                <p className="px-1 pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  These components render without a stored content section yet.
                  A layout one binds in the layout, so it applies to every page.
                </p>
              </SidebarGroup>
            ) : null}
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
                <>
                  {/*
                    Kept out of the sortable list on purpose. dnd-kit sorts by
                    the index it is given, so interleaving these made every
                    section's index depend on how many layout rows happened to
                    be above it -- a number that is 0 until the preview reports
                    its structure. Every row then re-registered and remounted,
                    which dropped the focus of anyone driving the tree from the
                    keyboard. Three sibling lists give the same reading order
                    with the sortables alone and their indices stable.
                  */}
                  <SidebarMenu>
                    {layoutRoots.before.map(renderLayoutRoot)}
                  </SidebarMenu>
                  <DragDropProvider
                    sensors={sensors}
                    onDragStart={() => {
                      dragStartSectionsRef.current = sectionsRef.current;
                    }}
                    onDragOver={(event) => {
                      const { source, target } = event.operation;
                      if (!source || !target) return;
                      if (!isSortable(source) || !isSortable(target)) return;
                      // Every decision is in `planSectionDragOver`, including
                      // every reason to do nothing, so "a drag in flight never
                      // writes" is something a test states rather than
                      // something a reader has to reconstruct from four guards.
                      const next = planSectionDragOver({
                        sections: sectionsRef.current,
                        sourceId: source.id,
                        targetId: target.id,
                        busy: reorderMutation.isPending,
                      });
                      if (next) updateSections([...next]);
                    }}
                    onDragEnd={(event) => {
                      const initial = dragStartSectionsRef.current;
                      dragStartSectionsRef.current = null;
                      const plan = planSectionDragEnd({
                        initial,
                        next: sectionsRef.current,
                        canceled: event.canceled,
                        busy: reorderMutation.isPending,
                      });
                      if (plan.kind === "restore") {
                        updateSections([...plan.sections]);
                        return;
                      }
                      if (plan.kind === "commit") {
                        reorderMutation.mutate(plan.ids);
                      }
                    }}
                  >
                    <SidebarMenu>
                      {sections.map((section, index) => {
                        const normalized = normalizedSectionTree(section.id);
                        const expanded = expandedSectionIds.has(section.id);
                        return (
                          <SortableSectionRow
                            key={section.id}
                            section={section}
                            // The root's name only when it is a name. With no
                            // authored id its label is just the tag, and every
                            // section in the Starter is rooted in a `<section>`
                            // — so the sidebar showed five rows all reading
                            // "Section". Worse, the root only arrives once the
                            // preview reports its structure, so each row renamed
                            // itself from "Newsletter" to "Section" a moment
                            // after appearing. The section's own type is stable
                            // and distinguishing; an id the author wrote still
                            // wins over it, being the name they chose.
                            // The section's own name, always. Every Starter
                            // section is rooted in a `<section>`, so the root's
                            // tag names all of them the same thing — and it
                            // only arrives once the preview has reported its
                            // structure, so a row that deferred to it renamed
                            // itself a moment after appearing. What the element
                            // is goes beside the name instead.
                            // The author's name for this placement, then the
                            // one derived from the component. Stored per
                            // section entry, so the same component placed on
                            // three pages carries three names.
                            displayLabel={section.name ?? section.type}
                            domIdentity={domIdentityOf(normalized.root)}
                            onRequestRename={
                              onRenameSection
                                ? () => {
                                    setRenameCandidate({
                                      sectionId: section.id,
                                      current: section.name ?? section.type,
                                    });
                                    setRenameValue(section.name ?? "");
                                  }
                                : undefined
                            }
                            rootNode={normalized.root}
                            index={index}
                            selected={
                              (activeSelection?.sectionId ?? search.section) ===
                                section.id &&
                              (!activeSelection ||
                                activeSelection.isSection ||
                                Boolean(
                                  normalized.root &&
                                  selectionMatchesEditableNode(
                                    normalized.root,
                                    activeSelection,
                                  ),
                                ))
                            }
                            rootNodeSelected={Boolean(
                              activeSelection &&
                              !activeSelection.isSection &&
                              normalized.root &&
                              selectionMatchesEditableNode(
                                normalized.root,
                                activeSelection,
                              ),
                            )}
                            disabled={reorderMutation.isPending}
                            expanded={expanded}
                            hasChildren={normalized.hasChildren}
                            onSelect={() =>
                              selectNormalizedRoot(section.id, normalized.root)
                            }
                            onToggleExpanded={() =>
                              setExpandedSectionIds((current) => {
                                const next = new Set(current);
                                if (next.has(section.id))
                                  next.delete(section.id);
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
                            {normalized.children.length > 0
                              ? renderEditableNodes(
                                  section.id,
                                  normalized.root?.id ?? null,
                                )
                              : null}
                          </SortableSectionRow>
                        );
                      })}
                    </SidebarMenu>
                  </DragDropProvider>
                  <SidebarMenu>
                    {layoutRoots.after.map(renderLayoutRoot)}
                  </SidebarMenu>
                </>
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
                    bindMutation.isPending ||
                    reorderMutation.isPending
                  }
                >
                  <Plus /> Add section
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-64">
                {/* Said before the choice, because the choice is where the
                    copy stops following the library. */}
                <DropdownMenuLabel className="text-[11px] font-normal leading-snug text-muted-foreground">
                  Adds a copy this page owns. Later changes to the section
                  library don&apos;t update it.
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
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

        {onAddPage ? (
          <EditorAddPageDialog
            open={addPageOpen}
            onOpenChange={setAddPageOpen}
            existingPaths={themeRoutes.map((route) => route.sourcePath)}
            onAddPage={onAddPage}
          />
        ) : null}

        <AlertDialog
          open={pageToDelete !== null}
          onOpenChange={(open) => {
            if (!open && !pageDeletePending) {
              setPageToDelete(null);
              setPageDeleteError(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete page “{pageToDelete?.path ?? ""}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This removes {pageToDelete?.sourcePath ?? "the route source"}{" "}
                and the address it answered on. A revision is saved first, so it
                can be restored from the file history in Code mode.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {pageDeleteError ? (
              <p role="alert" className="text-xs text-destructive">
                {pageDeleteError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pageDeletePending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={pageDeletePending}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(event) => {
                  event.preventDefault();
                  const route = pageToDelete;
                  if (!route || !onDeletePage) return;
                  setPageDeletePending(true);
                  setPageDeleteError(null);
                  void onDeletePage(route)
                    .then((result) => {
                      if (result.ok) {
                        setPageToDelete(null);
                        return;
                      }
                      setPageDeleteError(
                        result.reason ?? "Could not delete the page.",
                      );
                    })
                    .finally(() => setPageDeletePending(false));
                }}
              >
                {pageDeletePending ? "Deleting…" : "Delete page"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={renameCandidate !== null}
          onOpenChange={(open) => {
            if (!open && !renamePending) setRenameCandidate(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Rename “{renameCandidate?.current ?? "section"}”
              </AlertDialogTitle>
              <AlertDialogDescription>
                Names this placement in the editor only. The storefront never
                shows it, and the same component on another page keeps its own
                name. Leave it empty to go back to the derived name.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={renameValue}
              autoFocus
              maxLength={100}
              placeholder={renameCandidate?.current ?? ""}
              aria-label="Section name"
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget
                    .closest("[role=alertdialog]")
                    ?.querySelector<HTMLButtonElement>(
                      "[data-editor-rename-confirm]",
                    )
                    ?.click();
                }
              }}
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={renamePending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                data-editor-rename-confirm="true"
                disabled={renamePending || !onRenameSection}
                onClick={async (event) => {
                  event.preventDefault();
                  if (!renameCandidate || !onRenameSection) return;
                  setRenamePending(true);
                  try {
                    await onRenameSection(
                      renameCandidate.sectionId,
                      renameValue.trim() || null,
                    );
                    setRenameCandidate(null);
                  } finally {
                    setRenamePending(false);
                  }
                }}
              >
                {renamePending ? "Renaming…" : "Rename"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={deleteCandidate !== null}
          onOpenChange={(open) => {
            if (!open && !isDeletePending) setDeleteCandidate(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {deleteCandidate?.kind === "detach"
                  ? `Create a page-specific copy of “${deleteCandidate.label}”?`
                  : `Delete “${deleteCandidate?.label ?? "element"}”?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteCandidate?.kind === "detach"
                  ? "This copies the section's component into a folder this page owns and points only this page at the copy. Other pages, and every later Add section, keep using the original, and later changes to the original don't reach this copy."
                  : deleteCandidate?.kind === "section"
                  ? "This removes the section from the Theme route source and its content from this page. If the section has its own page copy, those files are deleted with it. To bring it back, restore an earlier revision from the file history in Code mode."
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
                {isDeletePending
                  ? deleteCandidate?.kind === "detach"
                    ? "Creating…"
                    : "Deleting…"
                  : deleteCandidate?.kind === "detach"
                    ? "Create copy"
                    : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarProvider>
    </aside>
  );
});
