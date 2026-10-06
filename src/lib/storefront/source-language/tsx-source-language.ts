import { hoistColocatedContentFieldsForPreview } from "../ast/hoist-colocated-content-fields";
import { injectPreviewBindings } from "../ast/inject-preview-bindings";
import { stripEditorMarkers } from "../ast/strip-editor-markers";

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
export function prepareSourcesForLivePreview(files: readonly SourceFile[]) {
  const bindings = injectPreviewBindings(files);
  const hoist = hoistColocatedContentFieldsForPreview(bindings.files);
  return { bindings, hoist, files: hoist.files };
}

/**
 * A build ships none of the editor's attributes. The Theme's stored source
 * keeps them — that is where a hand-written marker is doing its job — but a
 * shopper has no use for them.
 */
export function prepareSourcesForBuild(files: readonly SourceFile[]) {
  return stripEditorMarkers(files);
}
