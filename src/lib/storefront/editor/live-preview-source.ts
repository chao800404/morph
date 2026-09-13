/**
 * The real React preview the editor frames, and at what address.
 *
 * A real Theme serves its own pages and is told which one to show after it
 * connects, so its URL only carries the authenticated channel back to the
 * editor. While the sandbox starts there is no source to frame; the lifecycle
 * UI stays visible instead of silently switching to a different renderer.
 */

export type LivePreviewSource = Readonly<{
  kind: "preview-server";
  url: string;
  origin: string;
}>;

export type ResolveLivePreviewSourceInput = Readonly<{
  editorOrigin: string;
  previewSession: string;
  /**
   * The address a running preview server reported, already checked against
   * the configured host. Absent while one is starting or reconnecting.
   */
  previewServerUrl?: string | null;
}>;

/**
 * Adds the channel a preview needs to talk back.
 *
 * The bridge reads both from its own URL, so they have to survive being put
 * there — and a preview URL may already carry a query of its own.
 */
export function withPreviewChannel(
  previewUrl: string,
  {
    editorOrigin,
    previewSession,
  }: { editorOrigin: string; previewSession: string },
): string {
  const url = new URL(previewUrl);
  url.searchParams.set("editorOrigin", editorOrigin);
  url.searchParams.set("previewSession", previewSession);
  return url.toString();
}

/**
 * Reaches a preview server that a browser cannot reach as addressed.
 *
 * A container always mints an `https://…` address, which is right where the
 * Worker sits behind TLS and wrong on a machine where it does not. The
 * rewrite is not gated on a development flag, because the conditions are the
 * definition: an editor served over plain http from loopback, previewing a
 * host under `.localhost`, which RFC 6761 reserves for the local machine.
 * A deployment cannot satisfy both — its editor is not on loopback — so
 * nothing about how it is reached depends on a build-time switch being right.
 *
 * Confidentiality is why the address is otherwise required to be https: it
 * carries the token that authorises the preview. Loopback traffic never
 * reaches a network for that to matter on.
 */
function reachableFromLoopback(
  previewUrl: string,
  editorOrigin: string,
): string {
  let preview: URL;
  let editor: URL;
  try {
    preview = new URL(previewUrl);
    editor = new URL(editorOrigin);
  } catch {
    return previewUrl;
  }

  const editorIsLoopbackHttp =
    editor.protocol === "http:" &&
    (editor.hostname === "localhost" ||
      editor.hostname === "127.0.0.1" ||
      editor.hostname.endsWith(".localhost"));
  if (!editorIsLoopbackHttp || !preview.hostname.endsWith(".localhost")) {
    return previewUrl;
  }

  // Same host, because that is what the Worker routes on; the editor's own
  // scheme and port, because that is where the Worker is actually listening.
  preview.protocol = editor.protocol;
  preview.port = editor.port;
  return preview.toString();
}

export function resolveLivePreviewSource(
  input: ResolveLivePreviewSourceInput,
): LivePreviewSource | null {
  if (!input.previewServerUrl) return null;
  const url = withPreviewChannel(
    reachableFromLoopback(input.previewServerUrl, input.editorOrigin),
    input,
  );
  return {
    kind: "preview-server",
    url,
    origin: new URL(url).origin,
  };
}
