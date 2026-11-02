import { PREVIEW_SIZING_CSS } from "./preview-sizing-css";
import {
  parseEditorToPreviewWindowEvent,
  postPreviewToEditorMessage,
} from "./preview-protocol";

/**
 * How long to wait for images that never settle.
 *
 * The wait is what turns a gallery of unsized images from a frame that walks
 * upward one image at a time into a single correct answer. The timeout is the
 * safety valve: a decode that never resolves must not be able to withhold the
 * measurement altogether.
 */
const MEDIA_SETTLE_TIMEOUT_MS = 2_000;

/**
 * Reports how tall a preview is, so the editor can size the canvas around it.
 *
 * Shared rather than written once per preview, because the hard parts are not
 * obvious and getting any of them wrong is a visible bug: waiting for the
 * height to hold still across frames, waiting for fonts and images before
 * trusting it, resolving the root per measurement instead of capturing it, and
 * never observing the element whose size this measurement decides.
 *
 * Returns a dispose function, or `null` when there is nothing to measure yet.
 */
export function startPreviewHeightReporter({
  resolveRoot,
}: {
  /**
   * The element whose height is the page. Resolved on every measurement:
   * changing route replaces it, and a reporter holding the old node measures a
   * detached subtree that reads zero.
   */
  resolveRoot: () => HTMLElement | null;
}): (() => void) | null {
  // Resolved per measurement, never captured. Changing route replaces the
  // root element, and a bridge holding the old node measured a detached
  // subtree: height and scrollHeight both read 0, so the editor clamped the
  // frame to its 320px floor and the page looked truncated.
  const currentPreviewRoot = resolveRoot;
  if (!currentPreviewRoot()) return null;

  // Viewport units are rewritten against the editor-provided token; see
  // `preview-sizing-css` for why, and for the selectors it must not match.
  //
  // The scroll lock is a rule here rather than an inline style on html and
  // body. Inline styles are what a Theme's own render clears — measured in a
  // real React preview, where the page had scrolled itself by the time the
  // first height was reported — and a rule in a stylesheet this owns cannot
  // be reset that way. It also means disposing is just removing the element,
  // with no previous value to remember and restore.
  const previewSizingStyle = document.createElement("style");
  previewSizingStyle.dataset.storefrontPreviewSizing = "true";
  previewSizingStyle.textContent = `html,body{overflow:hidden!important}\n${PREVIEW_SIZING_CSS}`;
  document.head.appendChild(previewSizingStyle);

  let animationFrame = 0;
  let candidateHeight: number | null = null;
  let stableFrameCount = 0;
  let lastPublishedHeight: number | null = null;
  let measurementRevision = 0;
  let isDisposed = false;

  const measureUntilStable = () => {
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(() => {
      if (isDisposed) return;

      // `getBoundingClientRect()` captures the visible border box while
      // `scrollHeight` captures content that extends beyond it. Reading
      // both in the same animation frame keeps this a read-only geometry
      // phase and avoids layout read/write thrashing.
      // Between routes the old root is gone and the new one is not mounted
      // yet. Returning here would abandon the measurement altogether and
      // leave the editor on the previous route's height until something else
      // happened to resize; keep waiting for the new root instead.
      const previewRoot = currentPreviewRoot();
      if (!previewRoot) {
        measureUntilStable();
        return;
      }
      observeCurrentRoot(previewRoot);

      const nextHeight = Math.ceil(
        Math.max(
          previewRoot.getBoundingClientRect().height,
          previewRoot.scrollHeight,
        ),
      );
      if (
        candidateHeight !== null &&
        Math.abs(candidateHeight - nextHeight) < 1
      ) {
        stableFrameCount += 1;
      } else {
        candidateHeight = nextHeight;
        stableFrameCount = 1;
      }

      if (stableFrameCount < 2) {
        measureUntilStable();
        return;
      }

      if (
        lastPublishedHeight !== null &&
        Math.abs(lastPublishedHeight - nextHeight) < 1
      ) {
        return;
      }

      lastPublishedHeight = nextHeight;
      postPreviewToEditorMessage({
        type: "morph:storefront-preview-size",
        height: nextHeight,
        measurementRevision,
      });
    });
  };

  const observer = new ResizeObserver(() => {
    stableFrameCount = 0;
    measureUntilStable();
  });

  let observedRoot: HTMLElement | null = null;
  const observeCurrentRoot = (root: HTMLElement) => {
    if (observedRoot === root) return;
    if (observedRoot) observer.unobserve(observedRoot);
    observedRoot = root;
    observer.observe(root);
  };

  // `body` is the one node that outlives a route change, so a swapped root is
  // still noticed even before anything inside the new one resizes. It is also
  // the only stable candidate: `documentElement` is sized by the iframe, and
  // the iframe is sized from this measurement, so observing it would close
  // the frame/content feedback loop the sizing token exists to break.
  observer.observe(document.body);

  // An image with no reserved space resizes the page when it lands, so a
  // gallery of them walks the frame up one image at a time and the editor
  // spends seconds converging. Waiting for them turns that into a single
  // correct answer. The race is the safety valve: a decode that never
  // settles must not be able to withhold the measurement entirely.
  const waitForMedia = async () => {
    const root = currentPreviewRoot();
    if (!root) return;
    const pending = Array.from(root.querySelectorAll("img")).filter(
      (image) => !image.complete,
    );
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending.map((image) => image.decode())),
      new Promise((resolve) => setTimeout(resolve, MEDIA_SETTLE_TIMEOUT_MS)),
    ]);
  };

  // Measure now so the editor is never left holding a stale frame, then
  // again once fonts and images have settled to correct it.
  const measureNowAndAfterMedia = () => {
    measureUntilStable();
    void (async () => {
      await document.fonts.ready;
      await waitForMedia();
      if (isDisposed) return;
      stableFrameCount = 0;
      measureUntilStable();
    })();
  };
  const handleSizeRequest = (event: MessageEvent<unknown>) => {
    const message = parseEditorToPreviewWindowEvent(event);
    if (message?.type === "morph:storefront-preview-request-size") {
      measurementRevision = message.measurementRevision;
      // An explicit request means the editor does not know the height, so the
      // answer has to be sent even when it repeats the last one. Skipping it
      // as a duplicate is how a re-measure could leave the editor holding the
      // provisional height it shrank to in order to ask.
      lastPublishedHeight = null;
      stableFrameCount = 0;
      measureNowAndAfterMedia();
    }
  };
  window.addEventListener("message", handleSizeRequest);
  measureNowAndAfterMedia();

  const dispose = () => {
    isDisposed = true;
    cancelAnimationFrame(animationFrame);
    observer.disconnect();
    window.removeEventListener("message", handleSizeRequest);
    previewSizingStyle.remove();
  };

  return dispose;
}
