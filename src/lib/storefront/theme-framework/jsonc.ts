/**
 * Parses JSON with comments and trailing commas, the form Wrangler accepts in
 * `wrangler.jsonc`.
 *
 * Comments are removed only outside strings, so a URL such as
 * `"https://example.com"` keeps its `//`. Throws on anything JSON.parse
 * would still reject.
 */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
    } else {
      out += char;
    }
  }
  // Trailing commas before a closing bracket or brace, outside strings: the
  // comment pass above already left strings intact, so match on structure.
  return JSON.parse(removeTrailingCommas(out));
}

function removeTrailingCommas(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') inString = true;
    if (char === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j += 1;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += char;
  }
  return out;
}
