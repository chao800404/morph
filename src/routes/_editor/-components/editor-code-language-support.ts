import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { suggestTailwindClasses } from "@/lib/storefront/ast/tailwind-class-suggestions";

const MORPH_THEME_JSX_TYPES = `
declare namespace JSX {
  interface Element {
    readonly __morphThemeJsxElement?: never;
  }

  interface ElementChildrenAttribute {
    children: unknown;
  }

  interface IntrinsicAttributes {
    key?: string | number;
  }

  interface IntrinsicElements {
    [elementName: string]: {
      children?: unknown;
      className?: string;
      style?: Record<string, string | number | undefined>;
      [attributeName: string]: unknown;
    };
  }
}
`;

export type TailwindCompletionContext = {
  query: string;
  excludedClasses: ReadonlySet<string>;
  startColumn: number;
  endColumn: number;
};

export function resolveTailwindCompletionContext(
  line: string,
  column: number,
): TailwindCompletionContext | null {
  const beforeCursor = line.slice(0, Math.max(0, column - 1));
  const match = beforeCursor.match(
    /(?:className|class)\s*=\s*(?:\{\s*)?(["'])([^"']*)$/,
  );
  if (!match) return null;

  const classValue = match[2];
  const tokens = classValue.split(/\s+/);
  const query = tokens.at(-1) ?? "";
  const excludedClasses = new Set(tokens.slice(0, -1).filter(Boolean));

  return {
    query,
    excludedClasses,
    startColumn: column - query.length,
    endColumn: column,
  };
}

export function configureThemeTypeScript(monaco: Monaco): void {
  const defaults = monaco.languages.typescript.typescriptDefaults;
  defaults.setEagerModelSync(true);
  defaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  defaults.setCompilerOptions({
    allowJs: true,
    allowNonTsExtensions: true,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    jsx: monaco.languages.typescript.JsxEmit.Preserve,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution:
      monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    noEmit: true,
    target: monaco.languages.typescript.ScriptTarget.ES2022,
  });
  defaults.addExtraLib(
    MORPH_THEME_JSX_TYPES,
    "file:///node_modules/@morph/theme-jsx/index.d.ts",
  );
}

export function registerTailwindCompletionProvider(monaco: Monaco) {
  const provider = {
    triggerCharacters: ["-", ":", "/", "["],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      if (!/\.(?:jsx|tsx)$/.test(model.uri.path)) {
        return { suggestions: [] };
      }

      const context = resolveTailwindCompletionContext(
        model.getLineContent(position.lineNumber),
        position.column,
      );
      if (!context) return { suggestions: [] };

      const range = new monaco.Range(
        position.lineNumber,
        context.startColumn,
        position.lineNumber,
        context.endColumn,
      );
      const suggestions = suggestTailwindClasses(
        context.query,
        context.excludedClasses,
      ).map((suggestion, index) => ({
        label: suggestion.value,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText: suggestion.value,
        detail: `Tailwind CSS · ${suggestion.group}`,
        range,
        sortText: String(index).padStart(3, "0"),
      }));

      return { suggestions };
    },
  };
  const registrations = ["typescript", "javascript"].map((language) =>
    monaco.languages.registerCompletionItemProvider(language, provider),
  );

  return {
    dispose() {
      registrations.forEach((registration) => registration.dispose());
    },
  };
}
