import { parse as parseBabel } from "@babel/parser";
import type { AnyNode } from "./text-promotion";

export type ResolvedDefaultNode =
  | {
      status: "default";
      component: {
        localName: string | null;
        exportNames: string[];
        isDefault: boolean;
      };
      value: string;
      target: { start: number; end: number; quote: string };
    }
  | { status: "ambiguous" | "missing" | "unreadable" | "component-unknown" };

export type ResolveSourceDefaultInput = Readonly<{
  files: readonly Readonly<{ path: string; content?: string | null }>[];
  componentSourcePath: string;
  fieldKey: string;
  componentName?: string;
  parseForPath?: (path: string, content: string) => AnyNode | null;
}>;

type Candidate = {
  localName: string | null;
  exportNames: string[];
  isDefault: boolean;
  fn: AnyNode;
  value?: string;
  start?: number;
  end?: number;
};

const isFunction = (node: AnyNode | null | undefined) =>
  node?.type === "FunctionDeclaration" ||
  node?.type === "FunctionExpression" ||
  node?.type === "ArrowFunctionExpression";

const literalValue = (node: AnyNode): string | null => {
  if (node?.type === "StringLiteral") return node.value;
  if (
    node?.type === "TemplateLiteral" &&
    (node.expressions?.length ?? 0) === 0
  ) {
    return node.quasis?.[0]?.value?.cooked ?? null;
  }
  return null;
};

/** The `field = "literal"` default in a component's first parameter. */
function defaultNode(fn: AnyNode, fieldKey: string) {
  const pattern = fn.params?.[0];
  if (pattern?.type !== "ObjectPattern") return null;
  for (const prop of pattern.properties ?? []) {
    if (prop.type !== "ObjectProperty" || prop.computed) continue;
    const key =
      prop.key?.type === "Identifier" ? prop.key.name : prop.key?.value;
    if (key !== fieldKey) continue;
    const value = prop.value;
    if (value?.type !== "AssignmentPattern") continue;
    const literal = literalValue(value.right);
    if (literal === null || typeof value.right?.start !== "number") continue;
    return { value: literal, start: value.right.start, end: value.right.end };
  }
  return null;
}

function collectComponents(program: AnyNode): Candidate[] {
  const candidates: Candidate[] = [];
  const defaultLocals = new Set<string>();
  const aliases = new Map<string, string[]>();
  const add = (
    fn: AnyNode,
    localName: string | null,
    exportNames: string[],
    isDefault: boolean,
  ) => {
    candidates.push({ localName, exportNames, isDefault, fn });
  };

  for (const statement of program.body ?? []) {
    if (statement.type === "FunctionDeclaration" && statement.id) {
      add(statement, statement.id.name, [statement.id.name], false);
    } else if (statement.type === "VariableDeclaration") {
      for (const declaration of statement.declarations ?? []) {
        if (declaration.id?.type === "Identifier" && isFunction(declaration.init)) {
          add(declaration.init, declaration.id.name, [declaration.id.name], false);
        }
      }
    } else if (statement.type === "ExportDefaultDeclaration") {
      const declaration = statement.declaration;
      if (isFunction(declaration)) {
        add(declaration, declaration.id?.name ?? null, [], true);
      } else if (declaration?.type === "Identifier") {
        defaultLocals.add(declaration.name);
      }
    } else if (statement.type === "ExportNamedDeclaration") {
      const declaration = statement.declaration;
      if (declaration?.type === "FunctionDeclaration" && declaration.id) {
        add(declaration, declaration.id.name, [declaration.id.name], false);
      } else if (declaration?.type === "VariableDeclaration") {
        for (const item of declaration.declarations ?? []) {
          if (item.id?.type === "Identifier" && isFunction(item.init)) {
            add(item.init, item.id.name, [item.id.name], false);
          }
        }
      }
      for (const specifier of statement.specifiers ?? []) {
        if (specifier.type !== "ExportSpecifier") continue;
        const local = specifier.local?.name;
        const exported =
          specifier.exported?.type === "Identifier"
            ? specifier.exported.name
            : specifier.exported?.value;
        if (!local || !exported) continue;
        aliases.set(local, [...(aliases.get(local) ?? []), exported]);
      }
    }
  }

  for (const [local, names] of aliases) {
    const hit = candidates.find((candidate) => candidate.localName === local);
    if (hit) hit.exportNames.push(...names);
  }
  for (const candidate of candidates) {
    if (candidate.localName && defaultLocals.has(candidate.localName)) {
      candidate.isDefault = true;
    }
  }
  return candidates;
}

export function resolveSourceDefaultNode(
  input: ResolveSourceDefaultInput,
): ResolvedDefaultNode {
  const file = input.files.find(
    (candidate) => candidate.path === input.componentSourcePath,
  );
  const source = file?.content;
  if (typeof source !== "string") return { status: "missing" };
  const parse =
    input.parseForPath ??
    ((_path: string, content: string) =>
      parseBabel(content, {
        sourceType: "module",
        plugins: ["typescript", "jsx"],
      }));
  const parsed = parse(input.componentSourcePath, source);
  const program = parsed?.program ?? parsed;
  if (!program) return { status: "unreadable" };

  const candidates = collectComponents(program)
    .map((candidate) => ({ ...candidate, ...defaultNode(candidate.fn, input.fieldKey) }))
    .filter(
      (candidate) =>
        candidate.value !== undefined && candidate.start !== undefined,
    ) as Array<
    Candidate & { value: string; start: number; end: number }
  >;
  if (candidates.length === 0) return { status: "missing" };

  const matching = input.componentName
    ? candidates.filter(
        (candidate) =>
          candidate.localName === input.componentName ||
          candidate.exportNames.includes(input.componentName!),
      )
    : candidates;
  if (matching.length === 0) return { status: "component-unknown" };
  if (matching.length > 1) return { status: "ambiguous" };
  const hit = matching[0]!;
  return {
    status: "default",
    component: {
      localName: hit.localName,
      exportNames: hit.exportNames,
      isDefault: hit.isDefault,
    },
    value: hit.value,
    target: {
      start: hit.start,
      end: hit.end,
      quote: source[hit.start] ?? '"',
    },
  };
}

/**
 * Replace exactly the resolved literal range with a safe string literal.
 * JSON.stringify escapes quotes, backslashes, newlines and interpolation
 * markers, so a double-quoted string is always inert.
 */
export function patchStringLiteralAt(
  source: string,
  target: { start: number; end: number; quote: string },
  newValue: string,
): string {
  return (
    source.slice(0, target.start) +
    JSON.stringify(newValue) +
    source.slice(target.end)
  );
}
