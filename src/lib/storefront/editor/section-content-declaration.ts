/**
 * Where a section's content is declared, and what it shows before anything is
 * stored.
 *
 * The Inspector draws a field the Document holds nothing for from the
 * component's own defaults, and the canvas shows the same defaults. Anything
 * that writes such a field from outside the Inspector — a drag on the canvas
 * reordering a list — has to start from those very rows, or it writes a list
 * other than the one on screen. So both ask here, and neither keeps a copy of
 * the rule.
 */
import {
  getComponentFilePath,
  parseComponentSource,
  type ParsedComponentMeta,
} from "../ast/theme-ast-transformer";
import type { ThemeComponentContentCapability } from "../theme-content-capabilities";
import { resolveThemeContentCapabilitiesFromFiles } from "../theme-content-capability-resolver";
import { identifyUnstoredListRows, type RowIdScope } from "./normalize-row-ids";

/** The workspace as the editor holds it: every source file with its text. */
type ThemeFiles = ReadonlyArray<{ path: string; content: string }>;

export type SectionContentDeclaration = {
  /** What the section may edit, or null when nothing declares it. */
  capability: ThemeComponentContentCapability | null;
  /** The file the declaration, and the defaults, are read from. */
  sourcePath: string | null;
};

/**
 * The declaration that answers for a section's content.
 *
 * Resolved from the workspace rather than the manifest alone so a component
 * that declares its own `contentFields` is editable without being registered
 * anywhere. Server validation resolves the same way, so the form and what the
 * server accepts cannot diverge.
 *
 * In order: the section's `componentRef`; the selected element's own file
 * (`componentPath`), so a component that was never registered anywhere — the
 * case co-located declaration exists to support — still resolves what it
 * declares; last the section's own component. `componentPath` follows the
 * selection, so clicking a button rendered by a shared link component asks
 * that shared file what this section may edit — and it declares nothing,
 * because the fields belong to the section's component.
 */
export function resolveSectionContentDeclaration(
  themeFiles: ThemeFiles | undefined,
  args: {
    componentRef?: string | null;
    componentPath: string | null;
    sectionComponentPath: string | null;
  },
): SectionContentDeclaration {
  const { componentRef, componentPath, sectionComponentPath } = args;
  if (!themeFiles) return { capability: null, sourcePath: componentPath };
  const { capabilities } = resolveThemeContentCapabilitiesFromFiles(themeFiles);
  const fromRef = componentRef ? capabilities[componentRef] : null;
  if (fromRef) {
    return {
      capability: fromRef,
      sourcePath: sectionComponentPath ?? componentPath,
    };
  }
  const fromSelection = componentPath ? capabilities[componentPath] : null;
  if (fromSelection) {
    return { capability: fromSelection, sourcePath: componentPath };
  }
  const fromSection = sectionComponentPath
    ? capabilities[sectionComponentPath]
    : null;
  return fromSection
    ? { capability: fromSection, sourcePath: sectionComponentPath }
    : { capability: null, sourcePath: componentPath };
}

/**
 * What the component itself renders for a field when the Document holds
 * nothing for it, when its source states a default: the structured value
 * (a list, a link) where there is one, else the string form. `undefined`
 * when the source states none.
 *
 * A default stated as `null` is returned as `null`: the parser reports it as
 * a stated value (`{ ok: true, value: null }`) precisely so it can be told
 * from no default, and a caller deciding what to show must see that.
 */
export function declaredContentDefault(
  meta: Pick<ParsedComponentMeta, "defaultProps" | "defaultPropValues"> | null,
  fieldKey: string,
): unknown {
  if (!meta) return undefined;
  return Object.prototype.hasOwnProperty.call(meta.defaultPropValues, fieldKey)
    ? meta.defaultPropValues[fieldKey]
    : meta.defaultProps[fieldKey];
}

/**
 * The rows the Inspector draws for a declared list the Document does not
 * store yet: the component's declared defaults, with the ids their first edit
 * stores (`identifyUnstoredListRows`, the derivation `normalizeDocumentRowIds`
 * applies on the server). `undefined` when the section declares no such list
 * or its source states no list default — then there are no drawn rows to
 * start from, and a write must not invent them.
 *
 * Only for a list nothing stores: an id is derived partly from the row's
 * content, so deriving one for a list an edit has touched would name a
 * different row.
 */
export function declaredUnstoredListRows(
  themeFiles: ThemeFiles | undefined,
  section: { type: string; componentRef?: string | null },
  args: {
    fieldKey: string;
    scope: RowIdScope;
    /** The selected element's file, when the selection is in this section. */
    selectionSourceFilePath?: string | null;
  },
): Record<string, unknown>[] | undefined {
  if (!themeFiles) return undefined;
  const sectionComponentPath = getComponentFilePath(
    section.type,
    [...themeFiles],
    section.componentRef ?? undefined,
  );
  const componentPath =
    (args.selectionSourceFilePath &&
    themeFiles.some((file) => file.path === args.selectionSourceFilePath)
      ? args.selectionSourceFilePath
      : null) ?? sectionComponentPath;
  const { capability, sourcePath } = resolveSectionContentDeclaration(
    themeFiles,
    {
      componentRef: section.componentRef,
      componentPath,
      sectionComponentPath,
    },
  );
  if (capability?.fields[args.fieldKey]?.type !== "array") return undefined;
  const file = themeFiles.find((candidate) => candidate.path === sourcePath);
  if (!file?.content) return undefined;
  const rows = declaredContentDefault(
    parseComponentSource(file.content, file.path),
    args.fieldKey,
  );
  if (!Array.isArray(rows)) return undefined;
  return identifyUnstoredListRows(args.fieldKey, rows, args.scope) as Record<
    string,
    unknown
  >[];
}
