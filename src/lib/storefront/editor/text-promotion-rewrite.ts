import { inferThemeContentFields } from "../ast/infer-theme-content-fields";
import { parseColocatedContentFields } from "../ast/theme-content-fields-source";
import {
  analyzeTextPromotion,
  defaultComponent,
  findTargetElement,
  parseSource,
  propsTypeBody,
  typeBodyMembers,
  type AnyNode,
  type TextPromotionInput,
  type TextPromotionRefusal,
} from "./text-promotion";

/**
 * The source edit that turns fixed text into a field.
 *
 * `<p>hello world</p>` becomes `<p>{text}</p>`, with `text = "hello world"`
 * added to the destructured props, `text?: string` to a props type this file
 * defines, and an entry to a colocated `contentFields` declaration when the
 * component has one. The default is the text exactly as it rendered, so every
 * page that stores no value for the field renders as it did before.
 *
 * Edits are spliced in at the AST's positions rather than printed from a
 * rewritten tree, so the author's formatting and comments survive; the result
 * is parsed again and must declare the field before it is offered to anyone.
 */

export type TextPromotionRewriteRefusal =
  | TextPromotionRefusal
  /** Not an identifier a prop can be named, or one React/Morph reserves. */
  | "invalid-name"
  /** The component already uses the name, or the page passes it. */
  | "name-taken"
  /** The rewritten source did not come out declaring the field. */
  | "rewrite-unverified";

export type TextPromotionRewrite =
  | Readonly<{
      status: "rewritten";
      content: string;
      fieldName: string;
      /** The field's default: the text as it rendered before. */
      text: string;
    }>
  | Readonly<{ status: "refused"; reason: TextPromotionRewriteRefusal }>;

const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]*$/;

/**
 * Names a field must not take whatever the component says: React's own props,
 * the section switch the Document stores beside the content, and words that
 * cannot be a binding.
 */
const RESERVED_NAMES = new Set([
  "children",
  "key",
  "ref",
  "className",
  "style",
  "enabled",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "null",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
  "let",
  "static",
  "implements",
  "interface",
  "package",
  "private",
  "protected",
  "public",
  "await",
  "arguments",
  "eval",
  "undefined",
]);

export function isValidTextFieldName(name: string): boolean {
  return FIELD_NAME.test(name) && !RESERVED_NAMES.has(name);
}

/** `heading2` → `Heading 2`, `ctaLabel` → `Cta label`. */
export function textFieldLabel(name: string): string {
  const words = name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Edit = { start: number; end: number; text: string };

function applyEdits(source: string, edits: Edit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

function skipWhitespace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length && /\s/.test(source[cursor]!)) cursor += 1;
  return cursor;
}

/** Leading whitespace of the line `index` is on. */
function indentAt(source: string, index: number): string {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  return /^[ \t]*/.exec(source.slice(lineStart))![0];
}

/**
 * Adds `entry` as the last item of a braced list — an object pattern, an
 * object literal, a type literal or an interface body — the way its author
 * wrote the rest: on its own line when the items are, with the separator the
 * items already use, keeping a trailing separator if there was one.
 */
function appendToBracedList(
  source: string,
  openBrace: number,
  items: readonly AnyNode[],
  entry: string,
  defaultSeparator: "," | ";",
): Edit | null {
  if (source[openBrace] !== "{") return null;
  if (items.length === 0) {
    const close = skipWhitespace(source, openBrace + 1);
    if (source[close] !== "}") return null;
    return { start: openBrace + 1, end: close, text: ` ${entry} ` };
  }
  const last = items[items.length - 1]!;
  const multiline = source.slice(openBrace, items[0]!.start).includes("\n");
  // A type member's own range can include its separator.
  const ownSeparator = source[last.end - 1];
  let separator: string = defaultSeparator;
  let insertAt = last.end;
  let trailing = false;
  if (ownSeparator === "," || ownSeparator === ";") {
    separator = ownSeparator;
    trailing = true;
  } else {
    const next = skipWhitespace(source, last.end);
    if (source[next] === "," || source[next] === ";") {
      separator = source[next]!;
      insertAt = next + 1;
      trailing = true;
    }
  }
  if (multiline) {
    const indent = indentAt(source, last.start);
    return {
      start: insertAt,
      end: insertAt,
      text: trailing
        ? `\n${indent}${entry}${separator}`
        : `${separator}\n${indent}${entry}`,
    };
  }
  return {
    start: insertAt,
    end: insertAt,
    text: trailing ? ` ${entry}${separator}` : `${separator} ${entry}`,
  };
}

function contentFieldsObject(program: AnyNode): AnyNode | null {
  for (const statement of program.body ?? []) {
    if (statement?.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations ?? []) {
      if (
        declarator.id?.type !== "Identifier" ||
        declarator.id.name !== "contentFields"
      ) {
        continue;
      }
      let init = declarator.init;
      while (
        init?.type === "TSAsExpression" ||
        init?.type === "TSSatisfiesExpression"
      ) {
        init = init.expression;
      }
      return init?.type === "ObjectExpression" ? init : null;
    }
  }
  return null;
}

export function rewriteTextPromotion(
  input: TextPromotionInput & { fieldName: string },
): TextPromotionRewrite {
  const analysis = analyzeTextPromotion(input);
  if (analysis.status === "code-only") {
    return { status: "refused", reason: analysis.reason };
  }
  const name = input.fieldName;
  if (!isValidTextFieldName(name)) {
    return { status: "refused", reason: "invalid-name" };
  }
  if (analysis.reservedNames.includes(name)) {
    return { status: "refused", reason: "name-taken" };
  }

  const file = input.files.find(
    (candidate) => candidate.path === input.componentSourcePath,
  )!;
  const source = file.content;
  const ast = parseSource(source)!;
  const { element } = findTargetElement(ast, input.targetKey)!;
  const parameter = defaultComponent(ast.program)!.params[0]!;
  const children = element.children as AnyNode[];

  const edits: Edit[] = [
    {
      start: children[0]!.start,
      end: children[children.length - 1]!.end,
      text: `{${name}}`,
    },
  ];
  const defaultValue = JSON.stringify(analysis.text);
  const property = appendToBracedList(
    source,
    parameter.start,
    parameter.properties,
    `${name} = ${defaultValue}`,
    ",",
  );
  if (!property) return { status: "refused", reason: "rewrite-unverified" };
  edits.push(property);

  const typeBody = propsTypeBody(ast.program, parameter);
  if (typeBody && typeBody !== "none") {
    const member = appendToBracedList(
      source,
      typeBody.start,
      typeBodyMembers(typeBody),
      `${name}?: string`,
      ";",
    );
    if (!member) return { status: "refused", reason: "rewrite-unverified" };
    edits.push(member);
  }

  if (analysis.fieldDeclaration === "colocated") {
    const declaration = contentFieldsObject(ast.program);
    const entry = declaration
      ? appendToBracedList(
          source,
          declaration.start,
          declaration.properties,
          `${name}: { type: "text", label: ${JSON.stringify(textFieldLabel(name))} }`,
          ",",
        )
      : null;
    if (!entry) return { status: "refused", reason: "rewrite-unverified" };
    edits.push(entry);
  }

  const content = applyEdits(source, edits);

  // The edit is only as good as what reads it back.
  const declared =
    analysis.fieldDeclaration === "colocated"
      ? parseColocatedContentFields(content).fields?.[name]
      : inferThemeContentFields(content).fields[name];
  const reparsed = parseSource(content);
  const component = reparsed ? defaultComponent(reparsed.program) : null;
  const added = component?.params?.[0]?.properties?.find(
    (candidate: AnyNode) =>
      candidate?.key?.name === name &&
      candidate.value?.type === "AssignmentPattern",
  );
  if (
    !declared ||
    (declared as { type?: string }).type !== "text" ||
    added?.value?.right?.type !== "StringLiteral" ||
    added.value.right.value !== analysis.text
  ) {
    return { status: "refused", reason: "rewrite-unverified" };
  }

  return {
    status: "rewritten",
    content,
    fieldName: name,
    text: analysis.text,
  };
}
