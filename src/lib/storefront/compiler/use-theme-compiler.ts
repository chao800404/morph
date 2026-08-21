import { useEffect, useRef, useState } from "react";
import { themeCompilerManager } from "./theme-compiler-manager";
import type {
  ThemeCompilerDiagnostic,
  ThemeCompilerFile,
  ThemeCompilerResult,
} from "./theme-compiler.types";

export type ThemeCompilerApplication = {
  files: ThemeCompilerFile[];
  applicationKey?: number;
  didApplySource: boolean;
};

type UseThemeCompilerOptions = {
  themeId?: string;
  storefrontId?: string;
  sourceGeneration?: number;
  debounceMs?: number;
  autoInjectStyles?: boolean;
  applicationKey?: number;
  onStylesApplied?: (application: ThemeCompilerApplication) => void;
};

/**
 * React hook that drives the Theme Compiler pipeline for Preview surfaces.
 * Automatically handles debouncing, caching, last-known-good fallback, and stylesheet injection.
 */
export function useThemeCompiler(
  themeFiles: ThemeCompilerFile[],
  options: UseThemeCompilerOptions = {},
) {
  const {
    themeId,
    storefrontId,
    sourceGeneration,
    debounceMs = 120,
    autoInjectStyles = true,
    applicationKey,
    onStylesApplied,
  } = options;

  const [result, setResult] = useState<ThemeCompilerResult | null>(null);
  const [isCompiling, setIsCompiling] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ThemeCompilerDiagnostic[]>([]);
  const latestFilesRef = useRef(themeFiles);
  latestFilesRef.current = themeFiles;
  const onStylesAppliedRef = useRef(onStylesApplied);
  onStylesAppliedRef.current = onStylesApplied;

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    if (!themeFiles || themeFiles.length === 0) return;

    let isCancelled = false;

    const timer = setTimeout(async () => {
      const filesToCompile = latestFilesRef.current;
      setIsCompiling(true);
      try {
        const compileResult = await themeCompilerManager.compile({
          files: filesToCompile,
          themeId,
          storefrontId,
          sourceGeneration,
        });

        if (isCancelled) return;

        setResult(compileResult);
        setDiagnostics(compileResult.diagnostics);

        if (autoInjectStyles) {
          injectThemeStyles(compileResult.css);
        }
        onStylesAppliedRef.current?.({
          files: filesToCompile,
          applicationKey,
          didApplySource: compileResult.success,
        });
      } catch (err: any) {
        if (isCancelled) return;
        const fallback = themeCompilerManager.getLastKnownGood(themeId);
        setDiagnostics([
          {
            level: "error",
            message: err?.message || "Unexpected compilation failure",
          },
        ]);
        if (fallback?.css && autoInjectStyles) {
          injectThemeStyles(fallback.css);
        }
        onStylesAppliedRef.current?.({
          files: filesToCompile,
          applicationKey,
          didApplySource: false,
        });
      } finally {
        if (!isCancelled) {
          setIsCompiling(false);
        }
      }
    }, debounceMs);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [
    themeFiles,
    themeId,
    storefrontId,
    sourceGeneration,
    debounceMs,
    autoInjectStyles,
    applicationKey,
  ]);

  return {
    result,
    isCompiling,
    diagnostics,
    hasErrors: diagnostics.some((d) => d.level === "error"),
    hasWarnings: diagnostics.some((d) => d.level === "warning"),
  };
}

function injectThemeStyles(css?: string) {
  if (typeof document === "undefined" || !css) return;

  let styleTag = document.getElementById("morph-theme-compiled-css") as HTMLStyleElement | null;
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "morph-theme-compiled-css";
    document.head.appendChild(styleTag);
  }

  if (styleTag.textContent !== css) {
    styleTag.textContent = css;
  }
}
