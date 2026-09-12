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
import { collectPreviewEditableNodes } from "./preview/preview-dom";

// No channel means this page was opened without an editor behind it — someone
// following the preview URL directly. It renders; it just says nothing.
const channel = readPreviewRuntimeChannel(window.location.href);

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

function reportReady() {
  if (!channel) return;
  postPreviewToEditorMessage(
    { type: "morph:storefront-preview-ready" },
    channel,
  );
  reportStructure();
}

if (channel) {
  window.addEventListener("message", (event) => {
    // Origin, source, session and schema are all checked in here. Anything
    // that fails any of them is not a message as far as this page cares.
    const message = parseEditorToPreviewWindowEvent(event);
    if (message?.type === "morph:storefront-preview-request-structure") {
      reportStructure();
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
