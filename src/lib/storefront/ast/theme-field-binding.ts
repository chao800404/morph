/**
 * Works out which content field an expression in JSX is showing.
 *
 * Pure analysis over a Babel AST, which is why the same answer can serve two
 * places that could hardly be more different: the Live Preview interpreter,
 * which asks while it is evaluating the expression, and the preview compiler,
 * which asks before anything runs so it can write the answer into the markup
 * React will render. One copy, because a preview that disagrees with itself
 * about which field an element shows is worse than one that cannot say.
 *
 * Every case here is a shape a Theme author actually writes. When none of
 * them matches the answer is `null` rather than a guess: binding an element
 * to the wrong field is worse than leaving it uneditable, because the author
 * would watch their edit land somewhere they never asked for.
 */

/**
 * The field a member chain off the repeated row belongs to.
 *
 * `item.image?.src` is the `image` field being read into, not a field called
 * `src`. Walking to the base and taking the first step back out is what makes
 * a grouped value editable without the component announcing itself.
 */
export function readRowFieldName(
  expression: any,
  itemVariableName: string | null,
): string | null {
  const steps: string[] = [];
  let node: any = expression;
  while (
    node?.type === "MemberExpression" ||
    node?.type === "OptionalMemberExpression"
  ) {
    // A computed step names nothing readable: `item[key]` depends on a value
    // this cannot see, and guessing would bind the element to the wrong field.
    if (node.computed === true || node.property?.type !== "Identifier") {
      return null;
    }
    steps.unshift(node.property.name);
    node = node.object;
  }
  if (node?.type !== "Identifier" || steps.length === 0) return null;
  // Off the row, the first step is the field. Anywhere else the expression
  // names a local value, which is not a field at all.
  return node.name === itemVariableName ? (steps[0] ?? null) : null;
}

/**
 * Prop name a JSX expression reads, when it reads exactly one.
 *
 * `{heading}` and `{item.title ?? ""}` both name a single editable value; an
 * expression that combines several, or computes one, names none. Returning
 * `null` there is deliberate: the Inspector must not offer to edit a field it
 * cannot write back unambiguously.
 */
export function inferBoundPropName(
  expression: any,
  itemVariableName: string | null,
): string | null {
  if (!expression) return null;
  switch (expression.type) {
    case "Identifier":
      return expression.name === itemVariableName ? null : expression.name;
    // `item.title`, and also `item.image.src` or `item.image?.src`: the field
    // is the first step off the row, and the rest is reaching inside the value
    // it holds. Optional chaining is the same expression with a different node
    // type, and treating it as unrecognised is why a grouped image had to be
    // labelled by hand.
    case "MemberExpression":
    case "OptionalMemberExpression":
      return readRowFieldName(expression, itemVariableName);
    // `{item.title ?? ""}` and `{value || "fallback"}`: the left side is the
    // stored value and the right side is only what shows when it is missing.
    case "LogicalExpression":
      return inferBoundPropName(expression.left, itemVariableName);
    case "ConditionalExpression":
      return inferBoundPropName(expression.consequent, itemVariableName);
    case "TSAsExpression":
    case "TSNonNullExpression":
      return inferBoundPropName(expression.expression, itemVariableName);
    default:
      return null;
  }
}
