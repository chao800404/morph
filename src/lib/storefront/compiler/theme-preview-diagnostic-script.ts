/**
 * The first script a Live Preview page runs: it reports why the page may never
 * announce itself to the editor.
 *
 * The page loads two module graphs, the Theme's entry and the preview bridge.
 * A module that fails to load stops its whole graph, so when a request inside
 * one is refused the bridge can be the thing that never runs — and then
 * nothing tells the editor, which waits out its timeout and reconnects. This
 * is a classic inline script with no imports, placed before both, so it runs
 * whatever happens to them.
 *
 * It reports; it does not recover. Two things are sent to the editor, which
 * logs them: a module script whose graph failed (the script element's `error`
 * event), and, once the page has loaded, every resource that answered with an
 * error status as Resource Timing recorded it. Paths only — never the query,
 * never the host, which carries the preview's credential.
 *
 * Addressed with the same `editorOrigin` and `previewSession` the bridge reads
 * from the page URL, and validated on the editor side like any other frame
 * message: exact origin, the framed window, the matching session.
 */
export const THEME_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE =
  "morph:storefront-preview-diagnostic";

/** Most messages one page may send, so a broken page cannot flood the editor. */
const MAX_MESSAGES = 10;
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
  function send(kind) {
    if (sent >= ${MAX_MESSAGES}) return;
    sent += 1;
    try {
      window.parent.postMessage(
        {
          type: "${THEME_PREVIEW_DIAGNOSTIC_MESSAGE_TYPE}",
          previewSession: session,
          kind: kind,
          failures: failures(),
          failedScripts: failedScripts.slice(0, ${MAX_ENTRIES}),
          elapsedMs: Math.round(performance.now() - started),
        },
        target,
      );
    } catch (error) {}
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
  window.addEventListener("load", function () {
    setTimeout(function () {
      if (failures().length > 0) send("load-summary");
    }, ${SUMMARY_DELAY_MS});
  });
})();`;
}
