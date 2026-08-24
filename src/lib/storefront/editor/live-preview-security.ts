export type LivePreviewExecutionMode = "compatibility-renderer" | "user-code";

export type LivePreviewSecurityConfig =
  | {
      enabled: true;
      previewOrigin: string;
      sandbox: "allow-same-origin allow-scripts";
    }
  | {
      enabled: false;
      reason:
        | "INVALID_EDITOR_ORIGIN"
        | "MISSING_PREVIEW_ORIGIN"
        | "INVALID_PREVIEW_ORIGIN"
        | "SAME_ORIGIN_USER_CODE_PREVIEW";
    };

function parseHttpOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function resolveLivePreviewSecurity({
  editorOrigin,
  configuredPreviewOrigin,
  executionMode,
}: {
  editorOrigin: string;
  configuredPreviewOrigin?: string;
  executionMode: LivePreviewExecutionMode;
}): LivePreviewSecurityConfig {
  const parsedEditorOrigin = parseHttpOrigin(editorOrigin);
  if (!parsedEditorOrigin) {
    return { enabled: false, reason: "INVALID_EDITOR_ORIGIN" };
  }

  if (executionMode === "compatibility-renderer") {
    return {
      enabled: true,
      previewOrigin: parsedEditorOrigin,
      sandbox: "allow-same-origin allow-scripts",
    };
  }

  if (!configuredPreviewOrigin?.trim()) {
    return { enabled: false, reason: "MISSING_PREVIEW_ORIGIN" };
  }
  const previewOrigin = parseHttpOrigin(configuredPreviewOrigin);
  if (!previewOrigin) {
    return { enabled: false, reason: "INVALID_PREVIEW_ORIGIN" };
  }
  if (previewOrigin === parsedEditorOrigin) {
    return {
      enabled: false,
      reason: "SAME_ORIGIN_USER_CODE_PREVIEW",
    };
  }
  return {
    enabled: true,
    previewOrigin,
    // Both tokens are allowed only because user-code mode requires a truly
    // cross-origin host. The browser origin boundary prevents parent access.
    sandbox: "allow-same-origin allow-scripts",
  };
}

export function buildLivePreviewUrl({
  previewOrigin,
  storefrontId,
  themeId,
  templateId,
  viewportHeight,
  editorOrigin,
  previewSession,
}: {
  previewOrigin: string;
  storefrontId: string;
  themeId: string;
  templateId: string;
  viewportHeight: number;
  editorOrigin: string;
  previewSession: string;
}) {
  const url = new URL(
    "/store/" +
      encodeURIComponent(storefrontId) +
      "/themes/" +
      encodeURIComponent(themeId) +
      "/preview",
    previewOrigin,
  );
  url.searchParams.set("templateId", templateId);
  url.searchParams.set("viewportHeight", String(viewportHeight));
  url.searchParams.set("editorOrigin", editorOrigin);
  url.searchParams.set("previewSession", previewSession);
  return url.toString();
}
