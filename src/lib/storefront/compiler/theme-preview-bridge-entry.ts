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

// No channel means this page was opened without an editor behind it — someone
// following the preview URL directly. It renders; it just says nothing.
const channel = readPreviewRuntimeChannel(window.location.href);

// Off until the editor asks for it, so a preview being merely watched behaves
// like the real storefront: links follow, menus open, carousels advance. In
// select mode the click belongs to the editor instead, which is the only way
// to reach an element inside a link without leaving the page.
let selectionEnabled = false;

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

function reportReady() {
  if (!channel) return;
  postPreviewToEditorMessage(
    { type: "morph:storefront-preview-ready" },
    channel,
  );
  reportStructure();
}

if (channel) {
  // Capture, so a Theme that stops its own clicks cannot make an element
  // unselectable. Selecting is the editor's, not the Theme's, to decide.
  window.addEventListener(
    "click",
    (event) => {
      if (!selectionEnabled) return;
      // Capture and stop, so a Theme's own link or handler cannot make an
      // element unselectable. What a click means is the editor's to decide.
      event.preventDefault();
      event.stopPropagation();
      reportSelection(event.target);
    },
    { capture: true },
  );

  window.addEventListener("message", (event) => {
    // Origin, source, session and schema are all checked in here. Anything
    // that fails any of them is not a message as far as this page cares.
    const message = parseEditorToPreviewWindowEvent(event);
    if (message?.type === "morph:storefront-preview-request-structure") {
      reportStructure();
    }
    if (message?.type === "morph:storefront-preview-set-selection-mode") {
      selectionEnabled = message.enabled;
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
