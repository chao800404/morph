import {
  buildLivePreviewUrl,
  type LivePreviewExecutionMode,
} from "./live-preview-security";

/**
 * Which of the two previews the editor frames, and at what address.
 *
 * The two are addressed in opposite ways, which is the whole reason this is a
 * decision rather than a string. The compatibility preview lives at a Morph
 * route the editor composes, and is told which template to render through the
 * URL. A preview server has no such route: a real Theme serves its own pages
 * and is told which one to show after it connects, so all its URL carries is
 * the channel back to the editor.
 *
 * Unconfigured means the compatibility preview, always. Running a Theme's own
 * JavaScript is something a deployment opts into by giving it a host of its
 * own, never something that happens because a setting was missing.
 */

export type LivePreviewSource =
  | Readonly<{ kind: "compatibility-renderer"; url: string; origin: string }>
  | Readonly<{ kind: "preview-server"; url: string; origin: string }>;

export type ResolveLivePreviewSourceInput = Readonly<{
  executionMode: LivePreviewExecutionMode;
  editorOrigin: string;
  previewSession: string;
  /** Where the compatibility preview is served from. */
  compatibilityOrigin: string;
  storefrontId: string;
  themeId: string;
  templateId: string;
  routePath?: string;
  viewportHeight: number;
  /**
   * The address a running preview server reported, already checked against
   * the configured host. Absent while one is starting, or when none is.
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

export function resolveLivePreviewSource(
  input: ResolveLivePreviewSourceInput,
): LivePreviewSource {
  if (input.executionMode === "user-code" && input.previewServerUrl) {
    const url = withPreviewChannel(input.previewServerUrl, input);
    return {
      kind: "preview-server",
      url,
      origin: new URL(url).origin,
    };
  }

  return {
    kind: "compatibility-renderer",
    url: buildLivePreviewUrl({
      previewOrigin: input.compatibilityOrigin,
      storefrontId: input.storefrontId,
      themeId: input.themeId,
      templateId: input.templateId,
      routePath: input.routePath,
      viewportHeight: input.viewportHeight,
      editorOrigin: input.editorOrigin,
      previewSession: input.previewSession,
    }),
    origin: input.compatibilityOrigin,
  };
}
