/**
 * The first script a Live Preview page runs: it reports why the page may never
 * announce itself to the editor, and that it is still getting there.
 *
 * The page loads two module graphs, the Theme's entry and the preview bridge.
 * A module that fails to load stops its whole graph, so when a request inside
 * one is refused the bridge can be the thing that never runs — and then
 * nothing tells the editor, which waits out its timeout and reconnects. This
 * is a classic inline script with no imports, placed before both, so it runs
 * whatever happens to them.
 *
 * It reports; it does not recover. Three things are sent to the editor:
 *
 * - a module script whose graph failed (the script element's `error` event);
 * - once the page has loaded, every resource that answered with an error
 *   status as Resource Timing recorded it;
 * - progress while the page loads: which milestones it has reached and how
 *   many resources have finished, so the editor can tell a slow page that is
 *   still moving from one that has stopped. Sent on each milestone and on a
 *   heartbeat, until the bridge says it is ready or the page goes away.
 *
 * Paths and counts only — never the query, never the host, which carries the
 * preview's credential.
 *
 * Addressed with the same `editorOrigin` and `previewSession` the bridge reads
 * from the page URL, and validated on the editor side like any other frame
 * message: exact origin, the framed window, the matching session.
 */
export const THEME_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE =
  "morph:storefront-preview-diagnostic";

/**
 * Window events the bridge fires so this script can report on it without
 * sharing a module with it. The bridge lives in a module graph this script
 * must not depend on; an event is the one thing both can reach.
 */
export const THEME_PREVIEW_BRIDGE_STARTED_EVENT =
  "morph:storefront-preview-bridge-started";
export const THEME_PREVIEW_BRIDGE_READY_EVENT =
  "morph:storefront-preview-bridge-ready";

/** Most failure reports one page may send, so a broken page cannot flood the editor. */
const MAX_MESSAGES = 10;
/**
 * Most progress reports one page may send. Counted apart from failures, so a
 * slow page spending its heartbeat cannot silence the report of why it failed.
 * At the heartbeat below this covers about five minutes, longer than the
 * editor waits for any frame.
 */
const MAX_PROGRESS_MESSAGES = 60;
const PROGRESS_INTERVAL_MS = 5_000;
const MAX_ENTRIES = 20;
const MAX_PATH_LENGTH = 300;
/** How long after `load` to look, so late module fetches are included. */
const SUMMARY_DELAY_MS = 1_000;

export function themePreviewDiagnosticScriptSource(): string {
  return `(function () {
  var params = new URLSearchParams(location.search);
  var target = params.get("editorOrigin");
  var session = params.get("previewSession");
  if (!target || !session || window.parent === window) return;
  var started = performance.now();
  var failedScripts = [];
  var sent = 0;
  var progressSent = 0;
  var reached = [];
  var resources = 0;
  var heartbeat = null;
  // Counted as entries arrive rather than read from the buffer, which holds
  // a bounded number of entries and can be cleared by the page.
  try {
    new PerformanceObserver(function (list) {
      resources += list.getEntries().length;
    }).observe({ type: "resource", buffered: true });
  } catch (error) {}
  function trim(value) {
    return String(value).slice(0, ${MAX_PATH_LENGTH});
  }
  function failures() {
    var out = [];
    var entries = performance.getEntriesByType("resource");
    for (var i = 0; i < entries.length && out.length < ${MAX_ENTRIES}; i++) {
      var status = entries[i].responseStatus;
      if (typeof status !== "number" || status < 400 || status > 599) continue;
      try {
        out.push({ path: trim(new URL(entries[i].name).pathname), status: status });
      } catch (error) {}
    }
    return out;
  }
  function post(message) {
    message.type = "${THEME_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE}";
    message.previewSession = session;
    message.elapsedMs = Math.round(performance.now() - started);
    try {
      window.parent.postMessage(message, target);
    } catch (error) {}
  }
  function send(kind) {
    if (sent >= ${MAX_MESSAGES}) return;
    sent += 1;
    post({
      kind: kind,
      failures: failures(),
      failedScripts: failedScripts.slice(0, ${MAX_ENTRIES}),
    });
  }
  function stopProgress() {
    if (heartbeat === null) return;
    clearInterval(heartbeat);
    heartbeat = null;
  }
  function progress(milestone) {
    if (milestone && reached.indexOf(milestone) === -1) reached.push(milestone);
    if (progressSent >= ${MAX_PROGRESS_MESSAGES}) {
      stopProgress();
      return;
    }
    progressSent += 1;
    post({ kind: "progress", reached: reached.slice(), resources: resources });
  }
  window.addEventListener(
    "error",
    function (event) {
      var element = event.target;
      if (!element || element.tagName !== "SCRIPT") return;
      var src = element.getAttribute("src");
      if (!src) return;
      try {
        failedScripts.push(trim(new URL(src, location.href).pathname));
      } catch (error) {
        return;
      }
      send("script-failed");
    },
    true,
  );
  window.addEventListener("DOMContentLoaded", function () {
    progress("dom");
  });
  window.addEventListener("${THEME_PREVIEW_BRIDGE_STARTED_EVENT}", function () {
    progress("bridge");
  });
  window.addEventListener("load", function () {
    progress("load");
    setTimeout(function () {
      if (failures().length > 0) send("load-summary");
    }, ${SUMMARY_DELAY_MS});
  });
  // Ready is the bridge's to say, and it says so to the editor itself; past
  // it there is nothing left to wait for, so the heartbeat stops.
  window.addEventListener("${THEME_PREVIEW_BRIDGE_READY_EVENT}", function () {
    progress("ready");
    stopProgress();
  });
  window.addEventListener("pagehide", stopProgress);
  progress("script");
  heartbeat = setInterval(function () {
    progress(null);
  }, ${PROGRESS_INTERVAL_MS});
})();`;
}
