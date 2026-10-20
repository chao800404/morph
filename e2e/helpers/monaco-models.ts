import type { Page } from "@playwright/test";

/**
 * Reading and writing Code mode's Monaco models from a test.
 *
 * Monaco used to arrive as jsDelivr's AMD build, which sets `window.monaco`,
 * and the specs read the models there. The editor now runs the ESM build
 * bundled with Morph, which sets no global, and production gets no test-only
 * one. These helpers reach the same instance the editor uses instead: the
 * suite runs against `vite dev`, where the runtime module is served at its
 * source path and the browser keeps one instance per URL, so importing that
 * URL again returns the module the editor loaded, with its `monaco` export.
 *
 * Only once the page shows a Monaco editor, so a helper never loads Monaco
 * itself: before that, there is no model to read and the answer is
 * `undefined`, exactly as `window.monaco?.` gave before.
 */
export const MONACO_RUNTIME_PATH =
  "/src/routes/_editor/-components/editor-code-monaco-runtime.ts";

/** The text of the model whose path ends with `suffix`, if Monaco has one. */
export function readMonacoModel(
  page: Page,
  suffix: string,
): Promise<string | undefined> {
  return page.evaluate(
    async ({ runtime, suffix }) => {
      if (!document.querySelector(".monaco-editor")) return undefined;
      const { monaco } = await import(/* @vite-ignore */ runtime);
      return monaco.editor
        .getModels()
        .find((model: { uri: { path: string } }) =>
          model.uri.path.endsWith(suffix),
        )
        ?.getValue() as string | undefined;
    },
    { runtime: MONACO_RUNTIME_PATH, suffix },
  );
}

/** Whether Monaco holds a model whose path ends with `suffix`. */
export async function hasMonacoModel(page: Page, suffix: string) {
  return (await readMonacoModel(page, suffix)) !== undefined;
}

/**
 * Replaces the model's text, as an author's edit does. Throws when there is no
 * such model, as the `window.monaco.` calls this replaces did.
 */
export async function setMonacoModelValue(
  page: Page,
  suffix: string,
  value: string,
) {
  await page.evaluate(
    async ({ runtime, suffix, value }) => {
      if (!document.querySelector(".monaco-editor")) {
        throw new Error("No Monaco editor on the page");
      }
      const { monaco } = await import(/* @vite-ignore */ runtime);
      const model = monaco.editor
        .getModels()
        .find((candidate: { uri: { path: string } }) =>
          candidate.uri.path.endsWith(suffix),
        );
      if (!model) throw new Error(`No Monaco model for ${suffix}`);
      model.setValue(value);
    },
    { runtime: MONACO_RUNTIME_PATH, suffix, value },
  );
}
