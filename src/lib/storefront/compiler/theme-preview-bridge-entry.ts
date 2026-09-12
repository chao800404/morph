/**
 * The script a Live Preview page runs so the editor can find content in it.
 *
 * It travels into the container as source, alongside a copy of the protocol
 * it speaks, because the container holds no Morph code. What it does is
 * narrow on purpose: report that the page is ready, and answer the editor's
 * question about what is on it. Everything it says goes out through the
 * protocol's own `postPreviewToEditorMessage`, so the origin it posts to and
 * the session it stamps are decided by the code the editor was tested
 * against — not restated here.
 *
 * The page it runs in executes Theme JavaScript, so it is treated as the
 * untrusted side throughout: it reads the DOM and reports, and holds no
 * capability of its own beyond the preview URL it was loaded from.
 */
export function themePreviewBridgeEntrySource(): string {
  return `import {
  postPreviewToEditorMessage,
  readPreviewRuntimeChannel,
  parseEditorToPreviewWindowEvent,
} from "./preview/preview-protocol";
import {
  collectPreviewEditableNodes,
  resolveSelectable,
  selectionKindOf,
  selectionMetadata,
  selectionStyleSnapshot,
} from "./preview/preview-dom";
import { startPreviewHeightReporter } from "./preview/preview-height-reporter";
import { createPreviewSelectionOverlays } from "./preview/preview-selection-overlays";
import { createInlineTextEditor } from "./preview/inline-text-editor";
import {
  isCompatibleReorderTarget,
  reorderCommitFor,
  reorderIdentity,
} from "./preview/preview-reorder-identity";

// No channel means this page was opened without an editor behind it — someone
// following the preview URL directly. It renders; it just says nothing.
const channel = readPreviewRuntimeChannel(window.location.href);

// Off until the editor asks for it, so a preview being merely watched behaves
// like the real storefront: links follow, menus open, carousels advance. In
// select mode the click belongs to the editor instead, which is the only way
// to reach an element inside a link without leaving the page.
let selectionEnabled = false;
let selectedItem = null;
let hoveredItem = null;

const overlays = channel ? createPreviewSelectionOverlays() : null;

const inlineEditor = createInlineTextEditor({
  onCommit: (commit) => {
    if (!channel) return;
    postPreviewToEditorMessage(
      { type: "morph:storefront-preview-commit-inline-text", ...commit },
      channel,
    );
  },
  // Typing changes how much room the text takes, so the rings follow it.
  onLayoutChanged: () => drawOverlays(),
});

const toOverlayItem = (item) =>
  item
    ? {
        element: item.element,
        label: item.label,
        tagName: item.tagName,
        kind: selectionKindOf(item),
      }
    : null;

/**
 * The handle only appears on something that can actually move, so its absence
 * is the answer to "why can I not drag this" rather than a drag that starts
 * and then quietly does nothing.
 */
function syncDragHandle() {
  const movable =
    selectionEnabled && selectedItem
      ? reorderIdentity(selectedItem.element)
      : null;
  overlays?.setDragHandle(
    Boolean(movable),
    movable ? \`Drag \${selectedItem.label} to reorder\` : undefined,
  );
}

function drawOverlays() {
  overlays?.position({
    enabled: selectionEnabled,
    selected: toOverlayItem(selectedItem),
    hovered: toOverlayItem(hoveredItem),
    selectedFrozen: false,
    inlineEditing: false,
  });
}

function reportStructure() {
  if (!channel) return;
  postPreviewToEditorMessage(
    {
      type: "morph:storefront-preview-structure",
      nodes: collectPreviewEditableNodes(document),
    },
    channel,
  );
}

/**
 * Describes what was clicked, in the shape the editor's Inspector reads.
 *
 * Assembled from the same resolution the compatibility renderer uses, so a
 * click lands on the same element and offers the same fields whichever
 * preview the author happens to be looking at.
 */
function reportSelection(target) {
  if (!channel) return;
  const item = resolveSelectable(target);
  if (!item?.sectionId) return;
  selectedItem = item;
  syncDragHandle();
  drawOverlays();

  const styleOf = (element) =>
    element ? selectionStyleSnapshot(window.getComputedStyle(element)) : null;

  postPreviewToEditorMessage(
    {
      type: "morph:storefront-preview-select-section",
      sectionId: item.sectionId,
      componentType: item.type,
      kind: selectionKindOf(item),
      sourceLocation: item.element.dataset.morphLoc ?? null,
      nodeId: item.element.dataset.morphNode || undefined,
      elementKey: item.elementKey,
      fieldKey: item.fieldKey,
      // A container that holds editable children is selected as the
      // container, not as a field: offering both would let one edit write
      // over the other.
      field:
        item.descendantFields.length > 0
          ? null
          : (item.fieldKey ?? item.elementKey),
      descendantFields: item.descendantFields,
      ...selectionMetadata(item),
      styleRevision: Number(
        document.documentElement.dataset.storefrontStyleRevision ?? 0,
      ),
      className: item.element.getAttribute("class") ?? "",
      isSection: item.element === item.section,
      inspectorOverride: item.element.dataset.morphInspector ?? null,
      computedStyle: styleOf(item.element),
      parentComputedStyle: styleOf(item.element.parentElement ?? item.element),
      sectionComputedStyle: styleOf(item.section ?? item.element),
    },
    channel,
  );
}

let gesture = null;

/**
 * The Theme source revision the editor is waiting to see rendered.
 *
 * Confirmed only once Vite says the page has actually taken the update, never
 * on receiving the message. Morph writes the files into the container and the
 * page updates itself; saying "applied" any earlier would be reporting
 * someone else's work as done.
 */
let pendingStyleRevision = null;

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => {
    if (pendingStyleRevision === null || !channel) return;
    const styleRevision = pendingStyleRevision;
    pendingStyleRevision = null;
    postPreviewToEditorMessage(
      { type: "morph:storefront-preview-theme-files-applied", styleRevision },
      channel,
    );
    // The update changed the page, so what is on it has changed with it.
    reportStructure();
  });

  import.meta.hot.on("vite:error", () => {
    if (pendingStyleRevision === null || !channel) return;
    const styleRevision = pendingStyleRevision;
    pendingStyleRevision = null;
    postPreviewToEditorMessage(
      { type: "morph:storefront-preview-theme-files-failed", styleRevision },
      channel,
    );
  });
}

/** The sibling of the dragged element that a pointer is currently over. */
function dropTargetUnder(target) {
  if (!gesture || !(target instanceof HTMLElement)) return null;
  let candidate = target;
  while (candidate && candidate.parentElement !== gesture.parent) {
    candidate = candidate.parentElement;
  }
  if (!candidate || candidate === gesture.dragged) return null;
  const identity = reorderIdentity(candidate);
  if (!identity || !isCompatibleReorderTarget(identity, gesture)) return null;
  return { element: candidate, identity };
}

function endGesture() {
  gesture = null;
  document.documentElement.removeAttribute(
    "data-storefront-editor-reordering",
  );
  drawOverlays();
}

function reportReady() {
  if (!channel) return;
  postPreviewToEditorMessage(
    { type: "morph:storefront-preview-ready" },
    channel,
  );
  reportStructure();
}

if (channel) {
  // A Theme mounts itself; there is no Morph wrapper to measure. The mount
  // point is the whole page, and body is the fallback for a Theme that
  // renders somewhere else entirely.
  startPreviewHeightReporter({
    resolveRoot: () => document.getElementById("root") ?? document.body,
  });


  // Capture, so a Theme that stops its own clicks cannot make an element
  // unselectable. Selecting is the editor's, not the Theme's, to decide.
  // A double click on selected text edits it in place. Checked before the
  // click handler takes the event away, since editing needs the caret the
  // browser is about to place.
  window.addEventListener(
    "dblclick",
    (event) => {
      if (!selectionEnabled) return;
      const item = resolveSelectable(event.target);
      if (!item?.sectionId) return;
      if (
        inlineEditor.begin(
          { ...item, kind: selectionKindOf(item) },
          { selectionEnabled },
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    { capture: true },
  );

  window.addEventListener(
    "click",
    (event) => {
      if (!selectionEnabled) return;
      // A click inside the text being edited is the caret moving, not a new
      // selection: taking it would end the edit on the first click.
      const editing = inlineEditor.editingElement();
      if (
        editing &&
        event.target instanceof Node &&
        editing.contains(event.target)
      ) {
        return;
      }
      inlineEditor.finish(true);
      // Capture and stop, so a Theme's own link or handler cannot make an
      // element unselectable. What a click means is the editor's to decide.
      event.preventDefault();
      event.stopPropagation();
      reportSelection(event.target);
    },
    { capture: true },
  );

  // Pointer rather than mouse, so a pen or touch highlights the same way.
  window.addEventListener(
    "pointermove",
    (event) => {
      if (!selectionEnabled) return;
      const item = resolveSelectable(event.target);
      // Redraw only when the answer changed: this runs on every pixel of
      // movement, and the geometry it would otherwise recompute is the
      // expensive part.
      if (item?.element === hoveredItem?.element) return;
      hoveredItem = item?.sectionId ? item : null;
      drawOverlays();
    },
    { capture: true, passive: true },
  );

  window.addEventListener("pointerleave", () => {
    if (!hoveredItem) return;
    hoveredItem = null;
    drawOverlays();
  });

  // The rings are drawn in viewport coordinates, so anything that moves the
  // page moves what they should be around.
  for (const moved of ["scroll", "resize"]) {
    window.addEventListener(moved, () => drawOverlays(), { passive: true });
  }

  // Dragging starts from the handle on the selection ring and nowhere else,
  // so a Theme's own draggable content still behaves as it does on the real
  // storefront.
  document.addEventListener(
    "dragstart",
    (event) => {
      if (!selectionEnabled || !selectedItem || inlineEditor.editingElement()) {
        return;
      }
      const fromHandle =
        event.target instanceof Element &&
        event.target.closest('[data-storefront-editor-drag-handle="true"]');
      const identity = fromHandle
        ? reorderIdentity(selectedItem.element)
        : null;
      if (!identity) return;

      gesture = {
        kind: identity.kind,
        dragged: selectedItem.element,
        parent: identity.parent,
        sectionId: identity.sectionId,
        sourceFilePath: identity.sourceFilePath,
        arrayPath: identity.arrayPath,
        draggedNodeId: identity.nodeId,
        draggedFieldPath: identity.fieldPath,
      };
      document.documentElement.setAttribute(
        "data-storefront-editor-reordering",
        "true",
      );
      hoveredItem = null;
      drawOverlays();
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(
          "text/plain",
          identity.fieldPath ?? identity.nodeId ?? "",
        );
      }
    },
    { capture: true },
  );

  document.addEventListener("dragover", (event) => {
    if (!gesture) return;
    // Only a compatible sibling is a drop target, and the browser cancels the
    // drop unless the default is prevented over one.
    if (!dropTargetUnder(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  });

  document.addEventListener("drop", (event) => {
    if (!gesture) return;
    event.preventDefault();
    const held = gesture;
    const target = dropTargetUnder(event.target);
    endGesture();
    if (!target || !channel) return;

    // Swap the two nodes so the page shows the new order at once. The editor
    // is told separately, and its own re-render is what makes it durable.
    const marker = document.createComment("morph-reorder");
    held.dragged.replaceWith(marker);
    target.element.replaceWith(held.dragged);
    marker.replaceWith(target.element);
    if (held.kind === "array" && held.draggedFieldPath && target.identity.fieldPath) {
      held.dragged.dataset.storefrontFieldPath = target.identity.fieldPath;
      target.element.dataset.storefrontFieldPath = held.draggedFieldPath;
    }
    selectedItem = resolveSelectable(held.dragged);
    syncDragHandle();
    drawOverlays();

    const commit = reorderCommitFor(held, target.identity);
    if (commit) postPreviewToEditorMessage(commit, channel);
  });

  document.addEventListener("dragend", () => {
    if (gesture) endGesture();
  });

  window.addEventListener("message", (event) => {
    // Origin, source, session and schema are all checked in here. Anything
    // that fails any of them is not a message as far as this page cares.
    const message = parseEditorToPreviewWindowEvent(event);
    if (message?.type === "morph:storefront-preview-ping") {
      postPreviewToEditorMessage(
        {
          type: "morph:storefront-preview-pong",
          heartbeatId: message.heartbeatId,
        },
        channel,
      );
      return;
    }
    if (message?.type === "morph:storefront-preview-request-structure") {
      reportStructure();
    }
    if (message?.type === "morph:storefront-preview-update-theme-files") {
      // The files themselves are not taken from here: Morph writes them into
      // the container, which is what Vite is watching. This only records the
      // revision to confirm once the page has taken them.
      pendingStyleRevision = message.styleRevision;
    }
    if (message?.type === "morph:storefront-preview-set-route") {
      // A real Theme owns its router, so the entry Morph generates hands it
      // over. Without one there is nothing to navigate and the page simply
      // stays where it is, which is better than reloading it out from under
      // an edit in progress.
      const router = window.__morphPreviewRouter;
      if (router) {
        inlineEditor.finish(true);
        selectedItem = null;
        hoveredItem = null;
        syncDragHandle();
        drawOverlays();
        void router.navigate({ to: message.routePath ?? "/" });
        // The page it lands on is a different set of elements entirely.
        window.setTimeout(reportStructure, 0);
      }
    }
    if (message?.type === "morph:storefront-preview-set-selection-mode") {
      selectionEnabled = message.enabled;
      // Leaving select mode drops the highlight with it: a ring left behind
      // would point at something the author can no longer click.
      if (!selectionEnabled) {
        hoveredItem = null;
        selectedItem = null;
      }
      syncDragHandle();
      drawOverlays();
    }
  });

  // React has to have rendered before there is anything to enumerate, and the
  // editor asks again whenever it needs a fresher answer.
  if (document.readyState === "complete") {
    queueMicrotask(reportReady);
  } else {
    window.addEventListener("load", reportReady, { once: true });
  }
}
`;
}

/** Where the bridge is written, relative to the workspace root. */
export const THEME_PREVIEW_BRIDGE_PATH = "src/morph/preview-bridge.ts";
