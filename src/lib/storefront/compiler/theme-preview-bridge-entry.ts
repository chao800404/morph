import { PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE } from "@/lib/storefront/editor/preview-empty-text-layout";

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
  previewSectionSelector,
  resolvePreviewSelectionRestoreElement,
  resolveSelectable,
  selectionKindOf,
  selectionMetadata,
  selectionStyleSnapshot,
} from "./preview/preview-dom";
import { startPreviewHeightReporter } from "./preview/preview-height-reporter";
import { createPreviewSelectionOverlays } from "./preview/preview-selection-overlays";
import {
  createSelectionStylePreview,
  selectionStylePreviewNeedsOverlayUpdate,
} from "./preview/selection-style-preview";
import { createInlineTextEditor } from "./preview/inline-text-editor";
import {
  isCompatibleReorderTarget,
  reorderCommitFor,
  reorderIdentity,
} from "./preview/preview-reorder-identity";
import { updatePreviewContent } from "./preview-content";

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
let lastRestoreTarget = null;
let selectedSectionId = null;

const selectionStylePreview = createSelectionStylePreview();
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

function clearSelectionAttributes() {
  if (selectedItem?.element) {
    selectedItem.element.removeAttribute("data-storefront-editor-selected");
  }
}

function sendSelectionReport(item) {
  if (!channel || !item?.sectionId) return;
  const styleOf = (element) =>
    element ? selectionStyleSnapshot(window.getComputedStyle(element)) : null;

  postPreviewToEditorMessage(
    {
      type: "morph:storefront-preview-select-section",
      sectionId: item.sectionId,
      componentType: item.type,
      kind: selectionKindOf(item),
      sourceLocation: item.element.dataset.morphLoc ?? null,
      nodeId:
        item.element.getAttribute("data-morph-node") ||
        item.element.dataset.morphNode ||
        undefined,
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
      styleRevision: latestBridgeStyleRevision || Number(
        document.documentElement.dataset.storefrontStyleRevision ?? 0,
      ),
      selectionRevision,
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

function restoreSelectedSection() {
  clearSelectionAttributes();
  if (selectionEnabled && selectedSectionId) {
    const sectionEl = document.querySelector(
      previewSectionSelector(selectedSectionId),
    );
    if (sectionEl) {
      selectedItem = resolveSelectable(sectionEl);
      if (selectedItem?.element) {
        selectedItem.element.setAttribute(
          "data-storefront-editor-selected",
          "true",
        );
      }
    } else {
      selectedItem = null;
    }
  } else {
    selectedItem = null;
  }
  selectionStylePreview.clear();
  syncDragHandle();
  drawOverlays();
}

function restoreSelectedTarget(target) {
  const previousTarget = lastRestoreTarget;
  const targetChanged =
    !previousTarget ||
    previousTarget.sectionId !== target.sectionId ||
    previousTarget.sourceLocation !== target.sourceLocation ||
    previousTarget.nodeId !== target.nodeId ||
    previousTarget.fieldPath !== target.fieldPath ||
    previousTarget.elementKey !== target.elementKey ||
    previousTarget.fieldKey !== target.fieldKey ||
    previousTarget.isSection !== target.isSection;
  if (targetChanged) selectionStylePreview.clear();
  lastRestoreTarget = target;
  clearSelectionAttributes();
  selectedSectionId = target.sectionId;

  const section = document.querySelector(
    previewSectionSelector(target.sectionId),
  );
  if (!section) {
    selectedItem = null;
    syncDragHandle();
    drawOverlays();
    return;
  }

  const retainedElement = selectedItem?.element ?? null;
  const nextElement = resolvePreviewSelectionRestoreElement(
    section,
    target,
    retainedElement,
  );
  selectedItem = resolveSelectable(nextElement);
  if (selectedItem) {
    selectedItem = {
      ...selectedItem,
      fieldPath: target.fieldPath ?? selectedItem.fieldPath,
      fieldKey: target.fieldKey ?? selectedItem.fieldKey,
    };
    if (selectedItem.element) {
      selectedItem.element.setAttribute(
        "data-storefront-editor-selected",
        "true",
      );
    }
  }
  syncDragHandle();
  drawOverlays();
}

function domElementMatchesTarget(element, targetKey, sourceLocation) {
  if (element.dataset.morphNode === targetKey) return true;
  if (element.dataset.morphElement === targetKey) return true;
  return Boolean(sourceLocation) && element.dataset.morphLoc === sourceLocation;
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
  selectionRevision += 1;
  clearSelectionAttributes();
  selectionStylePreview.clear();
  selectedItem = item;
  selectedSectionId = item.sectionId;
  lastRestoreTarget = {
    sectionId: item.sectionId,
    sourceLocation: item.element.dataset.morphLoc ?? undefined,
    nodeId: item.element.dataset.morphNode || undefined,
    elementKey: item.elementKey || undefined,
    fieldKey: item.fieldKey || undefined,
    fieldPath: item.fieldPath || undefined,
    isSection: item.element === item.section,
  };
  if (selectedItem.element) {
    selectedItem.element.setAttribute("data-storefront-editor-selected", "true");
  }
  syncDragHandle();
  drawOverlays();
  sendSelectionReport(selectedItem);
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
let latestBridgeStyleRevision = 0;
let previewHmrCursor = 0;
let previewHmrApplyQueue = Promise.resolve();
const previewHmrCursorReady = fetch(
  "/__morph-theme-preview__/_morph/hmr?cursor=1",
  { cache: "no-store" },
)
  .then((response) => (response.ok ? response.json() : null))
  .then((value) => {
    if (Number.isSafeInteger(value?.sequence) && value.sequence >= 0) {
      previewHmrCursor = value.sequence;
    }
  })
  .catch(() => {});

function applyWrittenThemeRevision(styleRevision) {
  previewHmrApplyQueue = previewHmrApplyQueue.then(async () => {
    await previewHmrCursorReady;
    let response = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetch(
          "/__morph-theme-preview__/_morph/hmr?after=" + previewHmrCursor,
          { cache: "no-store" },
        );
        if (response.ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!response || !response.ok) throw new Error("PREVIEW_HMR_FETCH_FAILED");
    const value = await response.json();
    const entries = Array.isArray(value?.entries) ? value.entries : [];
    const applyPayload = globalThis.__morphApplyViteHmrPayload;
    if (typeof applyPayload !== "function" || entries.length === 0) {
      throw new Error("PREVIEW_HMR_PAYLOAD_MISSING");
    }
    for (const entry of entries) {
      if (
        !Number.isSafeInteger(entry?.sequence) ||
        entry.sequence <= previewHmrCursor ||
        !entry.payload ||
        typeof entry.payload !== "object"
      ) {
        continue;
      }
      previewHmrCursor = entry.sequence;
      await applyPayload(entry.payload);
    }
    if (pendingStyleRevision === styleRevision) {
      acknowledgePendingStyleRevision();
    }
  }).catch(() => {
    if (pendingStyleRevision !== styleRevision || !channel) return;
    pendingStyleRevision = null;
    postPreviewToEditorMessage(
      { type: "morph:storefront-preview-theme-files-failed", styleRevision },
      channel,
    );
  });
}

function acknowledgePendingStyleRevision() {
  if (pendingStyleRevision === null || !channel) return;
  const styleRevision = pendingStyleRevision;
  pendingStyleRevision = null;
  postPreviewToEditorMessage(
    { type: "morph:storefront-preview-theme-files-applied", styleRevision },
    channel,
  );
  reportStructure();
  if (lastRestoreTarget) {
    restoreSelectedTarget(lastRestoreTarget);
    if (selectedItem?.element && selectionStylePreview.hasPending()) {
      selectionStylePreview.carryTo(selectedItem.element);
    }
    scheduleSelectedTargetReport();
  }
}

/** Coalesces a React commit into one structure snapshot on the next frame. */
let structureReportFrame = null;

function scheduleStructureReport() {
  if (!channel || structureReportFrame !== null) return;
  structureReportFrame = window.requestAnimationFrame(() => {
    structureReportFrame = null;
    reportStructure();
  });
}

/**
 * Re-resolves the selected DOM node after React commits a Fast Refresh update.
 *
 * Vite's afterUpdate signal means the module update was accepted; React may
 * commit its class/text changes immediately afterward. Reading the selection
 * only in the acknowledgement handler can therefore send the Inspector the
 * previous className and computed style forever. A frame plus the DOM observer
 * below makes the rendered React tree the point at which the fresh descriptor
 * is reported.
 */
let selectionReportFrame = null;

function scheduleSelectedTargetReport() {
  if (
    !channel ||
    !selectionEnabled ||
    !lastRestoreTarget ||
    selectionReportFrame !== null
  ) {
    return;
  }
  selectionReportFrame = window.requestAnimationFrame(() => {
    selectionReportFrame = null;
    if (!selectionEnabled || !lastRestoreTarget) return;
    restoreSelectedTarget(lastRestoreTarget);
    if (selectedItem?.sectionId) sendSelectionReport(selectedItem);
  });
}

/**
 * How many times selection has moved, counting both sides.
 *
 * The editor discards an answer older than the request it last made, so an
 * answer that carries nothing is read as the oldest possible and thrown away.
 * Enabling the tool is itself a request, which is why a click that followed it
 * selected nothing at all until this was echoed back.
 */
let selectionRevision = 0;

if (import.meta.hot) {
  import.meta.hot.on("vite:afterUpdate", () => {
    acknowledgePendingStyleRevision();
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
  const ensurePreviewRoot = () => {
    const rootEl = document.getElementById("root") ?? document.body;
    if (rootEl && !rootEl.hasAttribute("data-storefront-preview-root")) {
      rootEl.setAttribute("data-storefront-preview-root", "true");
    }
  };
  ensurePreviewRoot();

  const initialViewportHeight = new URL(window.location.href).searchParams.get(
    "viewportHeight",
  );
  if (initialViewportHeight) {
    document.documentElement.style.setProperty(
      "--storefront-preview-viewport-height",
      \`\${Number(initialViewportHeight)}px\`,
    );
  }

  // A Theme mounts itself; there is no Morph wrapper to measure. The mount
  // point is the whole page, and body is the fallback for a Theme that
  // renders somewhere else entirely.
  startPreviewHeightReporter({
    resolveRoot: () => {
      ensurePreviewRoot();
      return document.getElementById("root") ?? document.body;
    },
  });

  // The bridge and the Theme are sibling module scripts. React may commit
  // after the bridge's load callback, so the first structure snapshots can
  // truthfully be empty even though the page appears a moment later. Watch
  // the DOM React owns and report once after each structural commit. Editor
  // selection attributes are deliberately absent from the filter, avoiding
  // a feedback loop when a selected element is highlighted.
  const previewStructureRoot =
    document.querySelector("[data-storefront-preview-root]") ?? document.body;
  const structureAttributes = new Set([
    "data-storefront-section-id",
    "data-storefront-field",
    "data-storefront-field-path",
    "data-storefront-item-id",
    "data-storefront-component",
    "data-morph-loc",
    "data-morph-node",
    "data-morph-element",
  ]);
  const structureObserver = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (mutation) =>
          mutation.type === "childList" ||
          (mutation.type === "attributes" &&
            structureAttributes.has(mutation.attributeName ?? "")),
      )
    ) {
      scheduleStructureReport();
    }
    // Class-only and text-only React commits do not change the editable tree,
    // but they do change the values the Inspector must show. The style
    // attribute stays out
    // of the filter so live slider previews cannot create a report loop.
    scheduleSelectedTargetReport();
  });
  structureObserver.observe(previewStructureRoot, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      ...structureAttributes,
      "class",
    ],
  });
  scheduleStructureReport();


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

  // The editor's own cursors and the layout an empty line needs to stay
  // clickable. Carried here rather than in the Theme, because it describes
  // what the editor is doing to the page and must not survive into a build.
  const editorStyle = document.createElement("style");
  editorStyle.dataset.storefrontEditorSelection = "true";
  editorStyle.textContent = \`
    html[data-storefront-editor-selection-enabled] [data-storefront-section-id],
    html[data-storefront-editor-selection-enabled] [data-storefront-component] {
      cursor: pointer !important;
    }
    [data-storefront-editor-drag-handle="true"] {
      cursor: grab !important;
    }
    html[data-storefront-editor-reordering="true"] [data-storefront-editor-drag-handle="true"] {
      cursor: grabbing !important;
    }
    html[data-storefront-editor-pan-enabled],
    html[data-storefront-editor-pan-enabled] body,
    html[data-storefront-editor-pan-enabled] body * {
      cursor: grab !important;
      user-select: none !important;
    }
    html[data-storefront-editor-panning="true"],
    html[data-storefront-editor-panning="true"] body,
    html[data-storefront-editor-panning="true"] body * {
      cursor: grabbing !important;
    }
    [${PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE}]::before {
      content: "\\\\00a0";
    }
    [${PREVIEW_EMPTY_TEXT_LINE_ATTRIBUTE}][data-storefront-editor-inline-editing="true"]::before {
      content: none;
    }
    [data-storefront-editor-inline-editing="true"] {
      cursor: text !important;
      user-select: text !important;
      /* The editor already draws its own ring and badge around this element,
         so the browser's focus outline is a second border on top of it — and
         it follows the Theme's own border-radius, which is why it showed up
         as a stray rounded line around a heading with rounded corners.
         Focus stays visible; it is the editor drawing it rather than the UA. */
      outline: none !important;
      box-shadow: none !important;
    }
  \`;
  document.head.appendChild(editorStyle);

  window.addEventListener("pointerleave", () => {
    if (!hoveredItem) return;
    hoveredItem = null;
    drawOverlays();
  });

  // The preview fills the canvas, so once the pointer is over it the editor
  // stops seeing wheel events at all: scrolling the storefront and zooming the
  // canvas both have to be forwarded from in here. The editor owns the canvas
  // transform and is the only side that knows where its visible region sits,
  // so this reports the gesture and decides nothing.
  let pendingWheel: {
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    clientX: number;
    clientY: number;
  } | null = null;
  let wheelPostFrame = 0;

  const publishPendingWheel = () => {
    wheelPostFrame = 0;
    const wheel = pendingWheel;
    pendingWheel = null;
    if (!wheel || !channel) return;
    postPreviewToEditorMessage(
      { type: "morph:storefront-preview-wheel", ...wheel },
      channel,
    );
  };

  window.addEventListener(
    "wheel",
    (event) => {
      // Ctrl+wheel is the browser's own page zoom, and a bare wheel would
      // scroll this document inside a frame the editor has sized to the whole
      // page. Both have to be taken before the canvas can act on them.
      event.preventDefault();

      // A high-resolution trackpad emits wheel events far faster than the
      // display refreshes, and the editor moves the canvas once per frame
      // regardless. Sum the deltas and send one message per frame — but never
      // across a change of modifier or unit, which would fold a zoom and a
      // scroll into a single gesture.
      if (
        pendingWheel &&
        (pendingWheel.ctrlKey !== event.ctrlKey ||
          pendingWheel.deltaMode !== event.deltaMode)
      ) {
        publishPendingWheel();
      }

      pendingWheel = {
        deltaY: (pendingWheel?.deltaY ?? 0) + event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        // Zoom anchors on where the pointer is now; scrolling ignores these.
        clientX: event.clientX,
        clientY: event.clientY,
      };
      if (wheelPostFrame === 0) {
        wheelPostFrame = requestAnimationFrame(publishPendingWheel);
      }
    },
    // Explicitly not passive: a wheel listener on window defaults to passive,
    // and a passive listener cannot preventDefault, which would leave the
    // browser zooming the preview document underneath the canvas.
    { passive: false },
  );

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

  window.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
      return;
    }
    const target = event.target;
    if (target && target.isContentEditable === true) return;
    event.preventDefault();
    postPreviewToEditorMessage(
      {
        type: "morph:storefront-preview-history-shortcut",
        direction: event.shiftKey ? "redo" : "undo",
      },
      channel,
    );
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
      latestBridgeStyleRevision = Number(message.styleRevision);
      document.documentElement.dataset.storefrontStyleRevision = String(
        message.styleRevision,
      );
    }
    if (message?.type === "morph:storefront-preview-theme-files-written") {
      applyWrittenThemeRevision(message.styleRevision);
    }
    if (message?.type === "morph:storefront-preview-set-route") {
      // A real Theme owns its router, so the entry Morph generates hands it
      // over. Without one there is nothing to navigate and the page simply
      // stays where it is, which is better than reloading it out from under
      // an edit in progress.
      const previewRoot = document.getElementById("root");
      previewRoot?.setAttribute(
        "data-morph-route-path",
        message.routePath ?? "/",
      );
      const router = window.__morphPreviewRouter;
      if (router) {
        inlineEditor.finish(true);
        selectedItem = null;
        hoveredItem = null;
        syncDragHandle();
        drawOverlays();
        void router.navigate({ to: message.routePath ?? "/" });
        // The page it lands on is a different set of elements entirely.
        window.setTimeout(() => {
          // The section command can arrive before this route commit when the iframe
          // is first loaded or rebuilt. Re-run the existing selection restore
          // after navigation so a page-root target is not lost just because
          // the root marker did not exist in the previous route.
          restoreSelectedSection();
          reportStructure();
        }, 0);
      }
    }
    if (message?.type === "morph:storefront-preview-update-section-props") {
      updatePreviewContent(message.sectionId, message.props, message.enabled);
      const section = document.querySelector(
        previewSectionSelector(message.sectionId),
      );
      if (section && typeof message.enabled === "boolean") {
        section.toggleAttribute("hidden", !message.enabled);
      }
      reportStructure();
      drawOverlays();
      return;
    }
    if (message?.type === "morph:storefront-preview-set-section-order") {
      const ordered = message.sectionIds
        .map((sectionId) =>
          document.querySelector(previewSectionSelector(sectionId)),
        )
        .filter(Boolean);
      const parent = ordered[0]?.parentElement;
      if (parent && ordered.every((section) => section.parentElement === parent)) {
        for (const section of ordered) parent.appendChild(section);
        reportStructure();
        drawOverlays();
      }
      return;
    }
    if (message?.type === "morph:storefront-preview-set-viewport-height") {
      const h = message.height;
      if (typeof h === "number" && h >= 320 && h <= 2160) {
        const heightValue = Math.round(h) + "px";
        document.documentElement.style.setProperty(
          "--storefront-preview-viewport-height",
          heightValue,
        );
        const rootEl = document.querySelector("[data-storefront-preview-root]");
        if (rootEl) {
          rootEl.style.setProperty(
            "--storefront-preview-viewport-height",
            heightValue,
          );
        }
      }
      return;
    }
    if (message?.type === "morph:storefront-preview-set-selection-mode") {
      // Taken forward, never back: the editor and this page each move the
      // count, and the higher of the two is the one both have seen.
      if (message.selectionRevision !== undefined) {
        selectionRevision = Math.max(
          selectionRevision,
          message.selectionRevision,
        );
      }
      if (!message.enabled) {
        inlineEditor.finish(false);
        selectionStylePreview.clear();
        clearSelectionAttributes();
      }
      selectionEnabled = message.enabled;
      // What the pointer is for, said on the document so CSS can answer it.
      // Selecting and panning are the two things a wheel-less pointer does
      // here, and they are mutually exclusive.
      document.documentElement.toggleAttribute(
        "data-storefront-editor-selection-enabled",
        selectionEnabled,
      );
      document.documentElement.toggleAttribute(
        "data-storefront-editor-pan-enabled",
        !selectionEnabled,
      );
      // Leaving select mode drops the highlight with it: a ring left behind
      // would point at something the author can no longer click.
      if (!selectionEnabled) {
        hoveredItem = null;
        selectedItem = null;
      }
      syncDragHandle();
      drawOverlays();
      if (message.restoreTarget) {
        restoreSelectedTarget(message.restoreTarget);
      } else if (selectionEnabled) {
        restoreSelectedSection();
      }
      return;
    }
    if (message?.type === "morph:storefront-preview-set-section") {
      if (message.selectionRevision !== undefined) {
        selectionRevision = Math.max(
          selectionRevision,
          message.selectionRevision,
        );
      }
      lastRestoreTarget = message.restoreTarget ?? null;
      selectedSectionId = message.sectionId;
      if (selectionEnabled && message.restoreTarget) {
        restoreSelectedTarget(message.restoreTarget);
      } else if (selectionEnabled) {
        restoreSelectedSection();
      }
      return;
    }
    if (
      message?.type ===
      "morph:storefront-preview-reset-selection-style-preview"
    ) {
      // A history reversal is about to render the source's previous value.
      // Carrying the current computed value across that render would pin the
      // value being undone and make the canvas appear unchanged. Clear both
      // the inline declaration and its carry-over record before the HMR pass.
      selectionStylePreview.clear();
      return;
    }
    if (
      message?.type === "morph:storefront-preview-update-selection-style" &&
      selectedItem?.element
    ) {
      const targetKey = message.targetElement;
      const scope = selectedItem.section ?? document;
      const selectedElementMatchesTarget =
        selectedItem.elementKey === targetKey ||
        domElementMatchesTarget(
          selectedItem.element,
          targetKey,
          message.sourceLocation,
        );
      const selectors = [
        '[data-morph-node="' + CSS.escape(targetKey) + '"]',
        '[data-morph-element="' + CSS.escape(targetKey) + '"]',
        '[data-storefront-field="' + CSS.escape(targetKey) + '"]',
      ];
      if (message.sourceLocation) {
        selectors.push('[data-morph-loc="' + CSS.escape(message.sourceLocation) + '"]');
      }
      const previewTarget =
        targetKey === "section" || targetKey === "root"
          ? (selectedItem.section ?? selectedItem.element)
          : selectedElementMatchesTarget
            ? selectedItem.element
            : scope.querySelector(selectors.join(","));
      if (!previewTarget) return;
      const previewStyles = message.styles;
      selectionStylePreview.apply(previewTarget, previewStyles);
      if (selectionStylePreviewNeedsOverlayUpdate(previewStyles)) {
        drawOverlays();
      }
      return;
    }
    if (message?.type === "morph:storefront-preview-request-selection-style") {
      if (selectedItem?.sectionId) {
        sendSelectionReport(selectedItem);
      }
      return;
    }
    if (
      message?.type === "morph:storefront-preview-set-selection-field-path" &&
      selectedItem?.sectionId === message.sectionId
    ) {
      selectedItem = {
        ...selectedItem,
        fieldPath: message.fieldPath,
      };
      return;
    }
    if (
      message?.type === "morph:storefront-preview-update-selection-field" &&
      selectedItem
    ) {
      const scope = selectedItem.section ?? document;
      const fieldPath = message.fieldPath;
      const groupedImagePath =
        message.fieldKey === "image" && fieldPath?.endsWith(".alt")
          ? fieldPath.slice(0, -4)
          : null;
      const target =
        (fieldPath
          ? scope.querySelector(
              '[data-storefront-field-path="' + CSS.escape(fieldPath) + '"]',
            )
          : null) ??
        (groupedImagePath
          ? scope.querySelector(
              '[data-storefront-field-path="' + CSS.escape(groupedImagePath) + '"]',
            )
          : null) ??
        scope.querySelector(
          '[data-storefront-field="' + CSS.escape(message.fieldKey) + '"]',
        ) ??
        (selectedItem.fieldKey === message.fieldKey
          ? selectedItem.element
          : null);
      if (!target) return;
      const mediaTarget =
        message.fieldKey === "image" ||
        message.fieldKey === "imageSrc" ||
        message.fieldKey === "imageAlt"
          ? target.matches("img,video,audio")
            ? target
            : (target.querySelector("img,video,audio") ?? target)
          : target;
      if (message.fieldKey === "image" && groupedImagePath) {
        mediaTarget.setAttribute("alt", message.value);
      } else if (message.fieldKey === "image") {
        mediaTarget.setAttribute("src", message.value);
      } else if (message.fieldKey === "imageSrc") {
        mediaTarget.setAttribute("src", message.value);
      } else if (message.fieldKey === "imageAlt") {
        mediaTarget.setAttribute("alt", message.value);
      } else if (message.fieldKey === "actionHref") {
        target.setAttribute("href", message.value);
      } else {
        target.textContent = message.value;
      }
      drawOverlays();
      return;
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
