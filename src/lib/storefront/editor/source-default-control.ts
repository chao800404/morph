import { patchComponentDefaultProp } from "../ast/theme-ast-transformer";
import {
  declarationCounts,
  isReference,
  normalizeThemeSourcePath,
  parentMap,
  resolveThemeSourceImport,
} from "../ast/theme-content-binding";
import { parseSource, type AnyNode } from "./text-promotion";

/**
 * Whether editing a component's default prop changes what the canvas shows.
 *
 * A component with no Document section behind it is edited by rewriting the
 * default written in its own source (`patchComponentDefaultProp`). That is
 * only the value on screen when the place rendering the component leaves the
 * prop out: `<Hero title={title} />` renders the parent's `title`, so a new
 * default is saved and nothing on the page changes. Content binding contract
 * (ROADMAP 1.2): what cannot be proven is shown as controlled by code, never
 * guessed at and never written.
 *
 * Proven, per field, only when every element in the workspace that renders
 * the component is plain JSX that passes neither an attribute of that name
 * nor a spread that could carry it. Any other use of the component — passed
 * as a value, re-exported, imported dynamically or through a path this
 * cannot follow — leaves where it renders unknown, and so every field is
 * controlled by code.
 *
 * Pure analysis of the source the write would patch: the Inspector, which
 * only describes the answer, and the write, which refuses on it, ask the same
 * function and cannot disagree.
 */

export type SourceDefaultRefusal =
  /** A call site writes this prop, so the parent's value is what renders. */
  | "passed-by-caller"
  /** A call site spreads props onto the component; they could hold this one. */
  | "spread-by-caller"
  /** The component states no default for this prop that can be rewritten. */
  | "no-default"
  /**
   * Where the component is rendered could not be followed: it is used other
   * than as a JSX element, or no element rendering it was found.
   */
  | "call-site-unknown";

export type SourceDefaultFieldControl =
  | Readonly<{ status: "default" }>
  | Readonly<{ status: "code"; reason: SourceDefaultRefusal }>;

export type SourceDefaultControlInput = Readonly<{
  files: readonly Readonly<{ path: string; content?: string | null }>[];
  /** The file whose default would be rewritten. */
  componentSourcePath: string;
  fieldKeys: readonly string[];
  /** Parses a module; a caller asking repeatedly can pass one that remembers. */
  parse?: (content: string) => AnyNode | null;
}>;

const SOURCE_FILE = /\.(tsx|ts|jsx|js)$/;
/** Specifiers a bundler may map to a Theme file this analysis cannot resolve. */
const ALIAS_SPECIFIER = /^(@\/|~|#|\/)/;
const SENTINEL = "__morph_source_default_probe__";

function isFunction(node: AnyNode | undefined | null): boolean {
  return (
    node?.type === "FunctionDeclaration" ||
    node?.type === "FunctionExpression" ||
    node?.type === "ArrowFunctionExpression"
  );
}

function contains(node: AnyNode, offset: number): boolean {
  return (
    typeof node?.start === "number" &&
    typeof node?.end === "number" &&
    node.start <= offset &&
    offset < node.end
  );
}

type PatchedComponent = Readonly<{
  /** The name the file itself refers to it by, if any. */
  localName: string | null;
  /** Whether other files reach it as the module's default export. */
  isDefault: boolean;
  /** The names other files import it by. */
  exportedNames: ReadonlySet<string>;
}>;

/**
 * The top-level component whose parameters hold the default the patch would
 * rewrite, found by asking the patch itself: the offset where its output
 * first differs from the source lies in exactly one function's parameters.
 * Null when that function is not a plain top-level declaration (wrapped in
 * `memo`, nested, a class), so who renders it cannot be read.
 */
function patchedComponent(
  program: AnyNode,
  offset: number,
): PatchedComponent | null {
  let found: {
    fn: AnyNode;
    localName: string | null;
    isDefault: boolean;
  } | null = null;
  const exportedNames = new Set<string>();
  const exportedLocals: Array<{ local: string; exported: string }> = [];
  let defaultLocal: string | null = null;

  const consider = (
    fn: AnyNode | null | undefined,
    localName: string | null,
    isDefault: boolean,
  ) => {
    if (!isFunction(fn)) return;
    if ((fn!.params ?? []).some((param: AnyNode) => contains(param, offset))) {
      found = { fn: fn!, localName, isDefault };
    }
  };

  for (const statement of program.body ?? []) {
    if (statement?.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration;
      if (declaration?.type === "Identifier") {
        defaultLocal = declaration.name;
      } else {
        consider(declaration, declaration?.id?.name ?? null, true);
      }
      continue;
    }
    const exported = statement?.type === "ExportNamedDeclaration";
    if (exported && !statement.declaration) {
      if (statement.source) continue;
      for (const specifier of statement.specifiers ?? []) {
        if (specifier?.type !== "ExportSpecifier") continue;
        const local = specifier.local?.name;
        const name =
          specifier.exported?.type === "StringLiteral"
            ? specifier.exported.value
            : specifier.exported?.name;
        if (typeof local === "string" && typeof name === "string") {
          exportedLocals.push({ local, exported: name });
        }
      }
      continue;
    }
    const declaration = exported ? statement.declaration : statement;
    if (declaration?.type === "FunctionDeclaration") {
      const name = declaration.id?.name ?? null;
      consider(declaration, name, false);
      if (exported && name)
        exportedLocals.push({ local: name, exported: name });
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations ?? []) {
        const name =
          declarator?.id?.type === "Identifier" ? declarator.id.name : null;
        consider(declarator?.init, name, false);
        if (exported && name) {
          exportedLocals.push({ local: name, exported: name });
        }
      }
    }
  }

  const component = found as {
    fn: AnyNode;
    localName: string | null;
    isDefault: boolean;
  } | null;
  if (!component) return null;
  let isDefault = component.isDefault;
  if (component.localName) {
    if (defaultLocal === component.localName) isDefault = true;
    for (const entry of exportedLocals) {
      if (entry.local !== component.localName) continue;
      if (entry.exported === "default") isDefault = true;
      else exportedNames.add(entry.exported);
    }
  }
  return { localName: component.localName, isDefault, exportedNames };
}

/** The offset of the first character two strings differ at. */
function firstDifference(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return index;
  }
  return length;
}

type CallSites = { unknown: true } | { unknown: false; elements: AnyNode[] };

/** Whether an identifier sits in a type, which renders nothing. */
function inTypePosition(
  node: AnyNode,
  parents: ReadonlyMap<AnyNode, AnyNode>,
): boolean {
  for (
    let current = parents.get(node);
    current;
    current = parents.get(current)
  ) {
    if (typeof current.type === "string" && current.type.startsWith("TS")) {
      if (
        current.type === "TSAsExpression" ||
        current.type === "TSSatisfiesExpression" ||
        current.type === "TSNonNullExpression" ||
        current.type === "TSTypeAssertion"
      ) {
        return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Every JSX element in one module that renders `localName`, or unknown when
 * the name is used in any way other than as an element's tag.
 */
function elementsRendering(ast: AnyNode, localName: string): CallSites {
  if ((declarationCounts(ast).get(localName) ?? 0) > 1)
    return { unknown: true };
  const parents = parentMap(ast);
  const elements: AnyNode[] = [];
  let unknown = false;
  const visit = (node: AnyNode) => {
    if (unknown || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.type === "JSXIdentifier" && node.name === localName) {
      const parent = parents.get(node);
      if (parent?.type === "JSXOpeningElement" && parent.name === node) {
        const element = parents.get(parent);
        if (element) elements.push(element);
      } else if (!(
        parent?.type === "JSXClosingElement" && parent.name === node
      )) {
        // `<Hero.Part />`, or an attribute that happens to share the name.
        if (parent?.type !== "JSXAttribute") unknown = true;
      }
    }
    if (node.type === "Identifier" && node.name === localName) {
      const parent = parents.get(node);
      const declaration =
        ((parent?.type === "FunctionDeclaration" ||
          parent?.type === "FunctionExpression" ||
          parent?.type === "VariableDeclarator") &&
          parent.id === node) ||
        parent?.type === "ImportDefaultSpecifier" ||
        parent?.type === "ImportSpecifier" ||
        parent?.type === "ExportSpecifier" ||
        (parent?.type === "ExportDefaultDeclaration" &&
          parent.declaration === node);
      if (
        !declaration &&
        isReference(node, parent) &&
        !inTypePosition(node, parents)
      ) {
        // Passed as a value, called, stored: rendered somewhere unreadable.
        unknown = true;
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "extra"
      ) {
        continue;
      }
      if (value && typeof value === "object") visit(value as AnyNode);
    }
  };
  visit(ast.program);
  return unknown ? { unknown: true } : { unknown: false, elements };
}

function lastSegment(specifier: string): string {
  const segment = specifier.split("/").filter(Boolean).pop() ?? "";
  return segment.replace(SOURCE_FILE, "");
}

function componentBaseNames(componentPath: string): Set<string> {
  const segments = componentPath.split("/");
  const file = (segments.pop() ?? "").replace(SOURCE_FILE, "");
  const names = new Set<string>([file]);
  // `components/Hero/index.tsx` is imported as `components/Hero`.
  if (file === "index" && segments.length > 0) names.add(segments.pop()!);
  return names;
}

/** Where a module imports, re-exports or loads the component, if it does. */
function callSitesInModule(
  ast: AnyNode,
  filePath: string,
  component: PatchedComponent,
  componentPath: string,
  filePaths: ReadonlySet<string>,
): CallSites {
  const baseNames = componentBaseNames(componentPath);
  const resolvesToComponent = (specifier: unknown): boolean => {
    if (typeof specifier !== "string") return false;
    if (specifier.startsWith(".")) {
      return (
        resolveThemeSourceImport(filePath, specifier, filePaths) ===
        componentPath
      );
    }
    return false;
  };
  const unresolvableAlias = (specifier: unknown): boolean =>
    typeof specifier === "string" &&
    ALIAS_SPECIFIER.test(specifier) &&
    (baseNames.has(lastSegment(specifier)) ||
      (() => {
        // `@/components` can be a barrel for `src/components/Hero.tsx` even
        // though the alias's last segment does not name the component. The
        // analyzer cannot know a Theme's alias map, so an alias matching a
        // source directory containing this component must remain unknown.
        const aliasedPath = normalizeThemeSourcePath(
          `src/${specifier.replace(/^(?:@\/|~\/|#\/|\/)/, "")}`,
        ).replace(SOURCE_FILE, "");
        const componentSourcePath = componentPath.replace(SOURCE_FILE, "");
        return (
          aliasedPath.length > 0 &&
          (componentSourcePath === aliasedPath ||
            componentSourcePath.startsWith(`${aliasedPath}/`))
        );
      })());

  const locals: string[] = [];
  for (const statement of ast.program?.body ?? []) {
    const source = statement?.source?.value;
    if (
      (statement?.type === "ExportNamedDeclaration" ||
        statement?.type === "ExportAllDeclaration") &&
      statement.source
    ) {
      if (resolvesToComponent(source) || unresolvableAlias(source)) {
        if (statement.exportKind !== "type") return { unknown: true };
      }
      continue;
    }
    if (statement?.type !== "ImportDeclaration") continue;
    if (statement.importKind === "type") continue;
    if (unresolvableAlias(source)) return { unknown: true };
    if (!resolvesToComponent(source)) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier?.importKind === "type") continue;
      if (specifier?.type === "ImportNamespaceSpecifier") {
        return { unknown: true };
      }
      const imported =
        specifier?.type === "ImportDefaultSpecifier"
          ? "default"
          : specifier?.imported?.type === "StringLiteral"
            ? specifier.imported.value
            : specifier?.imported?.name;
      const reaches =
        imported === "default"
          ? component.isDefault
          : component.exportedNames.has(imported);
      if (reaches && typeof specifier.local?.name === "string") {
        locals.push(specifier.local.name);
      }
    }
  }

  // `import("./Hero")` and `require("./Hero")`: loaded at run time.
  let loaded = false;
  const visit = (node: AnyNode) => {
    if (loaded || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (
      (node.type === "ImportExpression" &&
        (resolvesToComponent(node.source?.value) ||
          unresolvableAlias(node.source?.value))) ||
      (node.type === "CallExpression" &&
        (node.callee?.type === "Import" ||
          (node.callee?.type === "Identifier" &&
            node.callee.name === "require")) &&
        (resolvesToComponent(node.arguments?.[0]?.value) ||
          unresolvableAlias(node.arguments?.[0]?.value)))
    ) {
      loaded = true;
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "extra"
      ) {
        continue;
      }
      if (value && typeof value === "object") visit(value as AnyNode);
    }
  };
  visit(ast.program);
  if (loaded) return { unknown: true };

  const elements: AnyNode[] = [];
  for (const local of locals) {
    const found = elementsRendering(ast, local);
    if (found.unknown) return found;
    elements.push(...found.elements);
  }
  return { unknown: false, elements };
}

function attributeOverride(
  element: AnyNode,
  fieldKey: string,
): SourceDefaultRefusal | null {
  for (const attribute of element.openingElement?.attributes ?? []) {
    if (attribute?.type === "JSXSpreadAttribute") return "spread-by-caller";
    if (
      attribute?.type === "JSXAttribute" &&
      attribute.name?.type === "JSXIdentifier" &&
      attribute.name.name === fieldKey
    ) {
      return "passed-by-caller";
    }
  }
  return null;
}

/**
 * For each field, whether the value on screen is the component's own default
 * and so whether rewriting that default is an edit of what the author sees.
 */
export function analyzeSourceDefaultFields(
  input: SourceDefaultControlInput,
): Record<string, SourceDefaultFieldControl> {
  const componentPath = normalizeThemeSourcePath(input.componentSourcePath);
  const everyField = (
    reason: SourceDefaultRefusal,
  ): Record<string, SourceDefaultFieldControl> =>
    Object.fromEntries(
      input.fieldKeys.map((fieldKey) => [
        fieldKey,
        { status: "code", reason } as const,
      ]),
    );
  const parse = input.parse ?? parseSource;
  const componentFile = input.files.find(
    (file) => normalizeThemeSourcePath(file.path) === componentPath,
  );
  const componentSource = componentFile?.content;
  const componentAst =
    typeof componentSource === "string" ? parse(componentSource) : null;
  if (!componentSource || !componentAst) return everyField("call-site-unknown");

  const filePaths = new Set(
    input.files.map((file) => normalizeThemeSourcePath(file.path)),
  );
  const baseNames = componentBaseNames(componentPath);
  const callSitesFor = new Map<string, CallSites>();
  const callSitesOf = (component: PatchedComponent): CallSites => {
    const key = `${component.localName}:${component.isDefault}:${[...component.exportedNames].join(",")}`;
    const cached = callSitesFor.get(key);
    if (cached) return cached;
    const elements: AnyNode[] = [];
    let result: CallSites | null = null;
    for (const file of input.files) {
      const path = normalizeThemeSourcePath(file.path);
      if (!path.startsWith("src/") || !SOURCE_FILE.test(path)) continue;
      const content = file.content;
      if (typeof content !== "string") continue;
      if (path === componentPath) {
        if (component.localName) {
          const own = elementsRendering(componentAst, component.localName);
          if (own.unknown) {
            result = own;
            break;
          }
          elements.push(...own.elements);
        }
        continue;
      }
      // Cheap first: a module that never names the file cannot import it.
      if (![...baseNames].some((name) => content.includes(name))) continue;
      const ast = parse(content);
      if (!ast) {
        result = { unknown: true };
        break;
      }
      const found = callSitesInModule(
        ast,
        path,
        component,
        componentPath,
        filePaths,
      );
      if (found.unknown) {
        result = found;
        break;
      }
      elements.push(...found.elements);
    }
    result ??=
      elements.length > 0 ? { unknown: false, elements } : { unknown: true };
    callSitesFor.set(key, result);
    return result;
  };

  return Object.fromEntries(
    input.fieldKeys.map((fieldKey): [string, SourceDefaultFieldControl] => {
      const probe = patchComponentDefaultProp(
        componentSource,
        fieldKey,
        SENTINEL,
      );
      if (probe === componentSource) {
        return [fieldKey, { status: "code", reason: "no-default" }];
      }
      const component = patchedComponent(
        componentAst.program,
        firstDifference(componentSource, probe),
      );
      if (!component) {
        return [fieldKey, { status: "code", reason: "call-site-unknown" }];
      }
      const callSites = callSitesOf(component);
      if (callSites.unknown) {
        return [fieldKey, { status: "code", reason: "call-site-unknown" }];
      }
      for (const element of callSites.elements) {
        const override = attributeOverride(element, fieldKey);
        if (override) return [fieldKey, { status: "code", reason: override }];
      }
      return [fieldKey, { status: "default" }];
    }),
  );
}

/** One line an author can act on, for each reason. */
export function describeSourceDefaultRefusal(
  reason: SourceDefaultRefusal,
): string {
  switch (reason) {
    case "passed-by-caller":
      return "The page passes this value to the component in code, so it is edited in Code.";
    case "spread-by-caller":
      return "The page spreads values onto the component in code, and they can set this one, so it is edited in Code.";
    case "no-default":
      return "The component states no default for it that can be rewritten here, so it is edited in Code.";
    case "call-site-unknown":
      return "Where the page renders this component could not be read, so what it passes is not known. It is edited in Code.";
  }
}

/**
 * The component file a content edit with no Document section behind it is
 * written into: the one the selected element was rendered from, else a
 * stand-in section named by its file. Null when neither is a Theme file, and
 * then nothing is written. The Inspector's panel writes there; the editor's
 * other messages about the same selection ask here too.
 */
export function codeComponentSourcePath(
  selection:
    | Readonly<{
        sourceFilePath?: string | null;
        sectionId?: string | null;
      }>
    | null
    | undefined,
  files: readonly Readonly<{ path: string }>[] | null | undefined,
): string | null {
  const isFile = (path: string | null | undefined): path is string =>
    Boolean(path) && Boolean(files?.some((file) => file.path === path));
  if (isFile(selection?.sourceFilePath)) return selection.sourceFilePath;
  if (isFile(selection?.sectionId)) return selection.sectionId;
  return null;
}

/**
 * Asks, one field at a time, why rewriting `componentSourcePath`'s default
 * for it would not change the canvas — null when it would. Answers are kept,
 * so a panel asking about each control on every render parses once. With no
 * file to write into, every field is refused.
 */
export function sourceDefaultRefusalReader(
  files: SourceDefaultControlInput["files"],
  componentSourcePath: string | null,
): (fieldKey: string) => SourceDefaultRefusal | null {
  const answers = new Map<string, SourceDefaultRefusal | null>();
  const parsed = new Map<string, AnyNode | null>();
  const parse = (content: string) => {
    if (!parsed.has(content)) parsed.set(content, parseSource(content));
    return parsed.get(content) ?? null;
  };
  return (fieldKey) => {
    if (!componentSourcePath) return "call-site-unknown";
    if (!answers.has(fieldKey)) {
      const control = analyzeSourceDefaultFields({
        files,
        componentSourcePath,
        fieldKeys: [fieldKey],
        parse,
      })[fieldKey];
      answers.set(
        fieldKey,
        control?.status === "default"
          ? null
          : (control?.reason ?? "call-site-unknown"),
      );
    }
    return answers.get(fieldKey) ?? null;
  };
}
