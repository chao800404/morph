/**
 * Morph Theme Component AST Transformer & Parser
 *
 * Provides bidirectional parsing and patching for React component source code
 * in the theme virtual workspace (Code as SSOT).
 */

export type SourceLocation = {
  line: number;
  column: number;
};

export type ComponentElementMeta = {
  elementName: string;
  tag: string;
  className: string;
  location: SourceLocation;
};

export type ParsedComponentMeta = {
  defaultProps: Record<string, string>;
  elements: Record<string, ComponentElementMeta>;
};

/**
 * Parses component source code to extract default prop values and morph element locations.
 */
export function parseComponentSource(sourceCode: string): ParsedComponentMeta {
  const defaultProps: Record<string, string> = {};
  const elements: Record<string, ComponentElementMeta> = {};

  // 1. Extract default props from destructuring (e.g. heading = "Objects for everyday rituals.")
  const propPattern = /(\w+)\s*=\s*(["'`])((?:\\.|[^\\])*?)\2/g;
  let propMatch: RegExpExecArray | null;
  while ((propMatch = propPattern.exec(sourceCode)) !== null) {
    const key = propMatch[1];
    const value = propMatch[3];
    if (key && value !== undefined) {
      defaultProps[key] = value;
    }
  }

  // 2. Extract data-morph-element metadata & line locations
  const lines = sourceCode.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const elementMatch = /data-morph-element=["']([\w-]+)["']/.exec(line);
    if (elementMatch) {
      const elementName = elementMatch[1];
      // Check for tag name in previous or current line
      let tag = "div";
      const tagMatch = /<([a-zA-Z0-9]+)/.exec(line);
      if (tagMatch) {
        tag = tagMatch[1];
      }

      // Check for className in current or nearby lines
      let className = "";
      const classMatch = /className=["']([^"']*)["']/.exec(line);
      if (classMatch) {
        className = classMatch[1];
      }

      elements[elementName] = {
        elementName,
        tag,
        className,
        location: {
          line: lineIndex + 1,
          column: elementMatch.index + 1,
        },
      };
    }
  }

  return {
    defaultProps,
    elements,
  };
}

/**
 * Patches a default prop string literal inside component source code.
 */
export function patchComponentDefaultProp(
  sourceCode: string,
  propName: string,
  newValue: string,
): string {
  const regex = new RegExp(`(${propName}\\s*=\\s*)(["'\`])(?:\\\\.|[^\\\\])*?\\2`, "g");
  if (!regex.test(sourceCode)) {
    return sourceCode;
  }
  // Escape quotes in newValue if necessary
  const escaped = newValue.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return sourceCode.replace(regex, `$1"${escaped}"`);
}

/**
 * Patches the className of a specific morph element in component source code.
 */
export function patchElementClassName(
  sourceCode: string,
  elementName: string,
  updater: (prevClasses: string) => string,
): string {
  const lines = sourceCode.split(/\r?\n/);
  const elementPattern = new RegExp(`data-morph-element=["']${elementName}["']`);

  for (let i = 0; i < lines.length; i++) {
    if (elementPattern.test(lines[i])) {
      // Find className in this line or subsequent lines before next tag
      for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 3); j++) {
        const classMatch = /className=["']([^"']*)["']/.exec(lines[j]);
        if (classMatch) {
          const currentClass = classMatch[1];
          const nextClass = updater(currentClass);
          lines[j] = lines[j].replace(
            `className="${currentClass}"`,
            `className="${nextClass}"`,
          );
          return lines.join("\n");
        }
      }
    }
  }

  return sourceCode;
}

/**
 * Find exact line and column location of an element for Monaco editor positioning.
 */
export function findSourceLocation(
  sourceCode: string,
  elementName: string,
): SourceLocation | null {
  const parsed = parseComponentSource(sourceCode);
  return parsed.elements[elementName]?.location ?? null;
}
