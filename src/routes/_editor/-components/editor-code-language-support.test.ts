import { describe, expect, it, vi } from "vitest";
import type { Monaco } from "@monaco-editor/react";
import {
  configureThemeTypeScript,
  registerTailwindCompletionProvider,
  resolveTailwindCompletionContext,
} from "./editor-code-language-support";

describe("resolveTailwindCompletionContext", () => {
  it("resolves the active utility inside a JSX className string", () => {
    const line = '    <section className="flex items-center bg-st">';
    const column = line.indexOf('">') + 1;

    const context = resolveTailwindCompletionContext(line, column);

    expect(context).not.toBeNull();
    expect(context?.query).toBe("bg-st");
    expect([...context!.excludedClasses]).toEqual(["flex", "items-center"]);
    expect(line.slice(context!.startColumn - 1, context!.endColumn - 1)).toBe(
      "bg-st",
    );
  });

  it("supports a static className string wrapped in a JSX expression", () => {
    const line = '    <div className={"lg:grid-cols-"}>';
    const column = line.indexOf('"}') + 1;

    expect(resolveTailwindCompletionContext(line, column)?.query).toBe(
      "lg:grid-cols-",
    );
  });

  it("does not offer Tailwind utilities outside class attributes", () => {
    const line = 'const label = "bg-st";';

    expect(resolveTailwindCompletionContext(line, line.length + 1)).toBeNull();
  });

  it("does not treat a completed className string as an active context", () => {
    const line = '    <div className="flex">content';

    expect(resolveTailwindCompletionContext(line, line.length + 1)).toBeNull();
  });
});

describe("configureThemeTypeScript", () => {
  it("enables TSX parsing without disabling real syntax or semantic diagnostics", () => {
    const setEagerModelSync = vi.fn();
    const setDiagnosticsOptions = vi.fn();
    const setCompilerOptions = vi.fn();
    const addExtraLib = vi.fn();
    const monaco = {
      languages: {
        typescript: {
          typescriptDefaults: {
            setEagerModelSync,
            setDiagnosticsOptions,
            setCompilerOptions,
            addExtraLib,
          },
          JsxEmit: { Preserve: 1 },
          ModuleKind: { ESNext: 99 },
          ModuleResolutionKind: { NodeJs: 2 },
          ScriptTarget: { ES2022: 9 },
        },
      },
    } as unknown as Monaco;

    configureThemeTypeScript(monaco);

    expect(setEagerModelSync).toHaveBeenCalledWith(true);
    expect(setDiagnosticsOptions).toHaveBeenCalledWith({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });
    expect(setCompilerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ jsx: 1, noEmit: true }),
    );
    expect(addExtraLib).toHaveBeenCalledOnce();
  });
});

describe("registerTailwindCompletionProvider", () => {
  it("returns ranked Tailwind suggestions for the current class token", () => {
    let provider:
      | {
          provideCompletionItems: (
            model: { uri: { path: string }; getLineContent: () => string },
            position: { lineNumber: number; column: number },
          ) => { suggestions: Array<{ label: string; insertText: string }> };
        }
      | undefined;
    const monaco = {
      Range: class {
        constructor(
          readonly startLineNumber: number,
          readonly startColumn: number,
          readonly endLineNumber: number,
          readonly endColumn: number,
        ) {}
      },
      languages: {
        CompletionItemKind: { Value: 12 },
        registerCompletionItemProvider: vi.fn(
          (_language: string, nextProvider: typeof provider) => {
            provider = nextProvider;
            return { dispose: vi.fn() };
          },
        ),
      },
    } as unknown as Monaco;

    registerTailwindCompletionProvider(monaco);
    expect(monaco.languages.registerCompletionItemProvider).toHaveBeenCalledTimes(2);
    const line = '<div className="flex bg-st';
    const result = provider!.provideCompletionItems(
      { uri: { path: "/src/Hero.tsx" }, getLineContent: () => line },
      { lineNumber: 1, column: line.length + 1 },
    );

    expect(result.suggestions[0]).toMatchObject({
      label: "bg-stone-50",
      insertText: "bg-stone-50",
    });
    expect(result.suggestions.some(({ label }) => label === "flex")).toBe(false);
  });
});
