/**
 * Monaco as Code mode runs it: bundled with Morph, never fetched from a CDN.
 *
 * Browser-only. Nothing imports this module statically; the one entry is the
 * dynamic import in `editor-code-monaco-loader.ts`, which the server build
 * drops. Evaluating it starts the editor core, registers the languages below
 * and points `@monaco-editor/react` at this copy through `loader.config`, so
 * the wrapper never injects its default jsDelivr `loader.js`.
 *
 * The language set is the one `getLanguage` and `getThemeModelLanguage` in
 * the workspace map file paths to: typescript, javascript, css, json, html,
 * xml and plaintext. Every other language Monaco ships is left out. Their
 * workers follow Monaco's ESM guide for Vite: `?worker` imports, which Vite
 * builds into same-origin worker scripts, handed out by
 * `MonacoEnvironment.getWorker`.
 */
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import * as cssLanguage from "monaco-editor/esm/vs/language/css/monaco.contribution.js";
import * as htmlLanguage from "monaco-editor/esm/vs/language/html/monaco.contribution.js";
import * as jsonLanguage from "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import * as typescriptLanguage from "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
// Syntax highlighting (Monarch). The language services above add completion,
// diagnostics and formatting; json brings its own tokenizer.
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js";
// The editor core with every contribution and the standalone quick-access
// commands: what `editor.main.js` contains apart from its language list.
import "monaco-editor/esm/vs/editor/edcore.main.js";
import * as editorApi from "monaco-editor/esm/vs/editor/editor.api.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker.js?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";

/** The worker a language service asks for, by the label Monaco passes. */
export function createMonacoWorker(label: string): Worker {
  switch (label) {
    case "typescript":
    case "javascript":
      return new TsWorker();
    case "css":
    case "scss":
    case "less":
      return new CssWorker();
    case "html":
    case "handlebars":
    case "razor":
      return new HtmlWorker();
    case "json":
      return new JsonWorker();
    default:
      return new EditorWorker();
  }
}

self.MonacoEnvironment = {
  getWorker: (_workerId: string, label: string) => createMonacoWorker(label),
};

// `editor.main.js` hangs the language services on `languages` as well as
// exporting them; callers here read both (`languages.typescript`, and `json`
// at the top level since 0.55), so the namespace below keeps both shapes.
Object.assign(editorApi.languages, {
  css: cssLanguage,
  html: htmlLanguage,
  json: jsonLanguage,
  typescript: typescriptLanguage,
});

/** The bundled Monaco namespace, in the shape `@monaco-editor/react` hands out. */
export const monaco = {
  ...editorApi,
  css: cssLanguage,
  html: htmlLanguage,
  json: jsonLanguage,
  typescript: typescriptLanguage,
} as unknown as Monaco;

loader.config({ monaco });

export { Editor };
