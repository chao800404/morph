import { hoistColocatedContentFieldsForPreview } from "../ast/hoist-colocated-content-fields";
import { injectPreviewBindings } from "../ast/inject-preview-bindings";
import { stripEditorMarkers } from "../ast/strip-editor-markers";
import { applyHideGuards } from "../ast/theme-hide-guard";

/**
 * The TSX/JSX file-language layer: what Morph does to a Theme's source files,
 * independent of which framework serves or builds them.
 *
 * docs/multi-runtime-theme-plan.md keeps two layers apart: a framework adapter
 * (`src/lib/storefront/theme-framework/`) decides how a project is previewed,
 * built and shipped; a file-language adapter decides how a file is parsed,
 * located and rewritten. This module is the second kind, for `.tsx`/`.jsx`.
 * Another file language (`.astro`, `.vue`) gets its own module of this shape.
 *
 * The functions are the same passes Morph already ran, gathered so the
 * workspace planner and the Live Preview file sync call one place.
 */

type SourceFile = Readonly<{ path: string; content: string }>;

/**
 * Editor identity and Fast Refresh preparation, for files served by a Live
 * Preview.
 *
 * Identity is written before the declaration is lifted, and the lift moves no
 * byte: injection reads `contentFields` to know which names are really fields,
 * and that reading only works while the module still exports it. Run the other
 * way round, every row field would be judged undeclared and nothing repeated
 * would be editable.
 */
export function prepareSourcesForLivePreview(
  files: readonly SourceFile[],
  options: Readonly<{ hideGuards?: boolean }> = {},
) {
  const bindings = injectPreviewBindings(files, options);
  const hoist = hoistColocatedContentFieldsForPreview(bindings.files);
  return { bindings, hoist, files: hoist.files };
}

/**
 * An incremental Code save still needs the whole saved source graph so the
 * binding analyser can resolve imports and component declarations. The
 * edited files override that same-generation snapshot for analysis, but only
 * those edited paths are returned for writing into the preview workspace.
 */
export function prepareChangedSourcesForLivePreview(
  changedFiles: readonly SourceFile[],
  sourceFiles: readonly SourceFile[],
) {
  const changedPaths = new Set(changedFiles.map((file) => file.path));
  const analysisFiles = new Map(sourceFiles.map((file) => [file.path, file]));
  for (const file of changedFiles) analysisFiles.set(file.path, file);

  const prepared = prepareSourcesForLivePreview([...analysisFiles.values()]);
  const preparedByPath = new Map(
    prepared.files.map((file) => [file.path, file]),
  );

  return {
    ...prepared,
    files: changedFiles.flatMap((file) => {
      const output = preparedByPath.get(file.path);
      return output && changedPaths.has(output.path) ? [output] : [];
    }),
  };
}

/**
 * A build ships none of the editor's attributes. The Theme's stored source
 * keeps them — that is where a hand-written marker is doing its job — but a
 * shopper has no use for them.
 *
 * It does ship Morph's hide guard (M3 Hide, `theme-hide-guard.ts`), the same
 * one the Live Preview runs, so a hidden section disappears from the
 * published site exactly as it does from the preview. The guard is applied
 * to the files as built (markers stripped), which are the files analysed.
 * Its version is part of the build's compiler identity
 * (`withThemeHideGuardIdentity`).
 */
export function prepareSourcesForBuild(
  files: readonly SourceFile[],
  options: Readonly<{ hideGuards?: boolean }> = {},
) {
  const stripped = stripEditorMarkers(files);
  if (options.hideGuards === false) return { ...stripped, hideGuarded: {} };
  const guarded = applyHideGuards(stripped.files);
  return { ...stripped, files: guarded.files, hideGuarded: guarded.guarded };
}
