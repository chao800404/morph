#!/usr/bin/env node
/**
 * Fails when an end-to-end assertion can pass without having run.
 *
 * Three of the failures in this suite's history were the same shape, and none
 * of them failed where they broke:
 *
 * - `if (await images.count()) { … }` wrapped an assertion. The markers it
 *   looked for had been removed by a starter upgrade, so `count()` returned
 *   zero, the assertion was skipped in silence, and the run died sixty seconds
 *   later on an unrelated selector.
 * - `expect(page).not.toHaveURL(/sign-in/)` was used to prove a session. A
 *   negative URL assertion is satisfied the instant a navigation commits,
 *   before the client decides there is no session and redirects — so it passed
 *   for a browser that was never signed in, saved a storage state that had
 *   never worked, and let the suite run against the sign-in page.
 * - `watch: null` in a preview test disabled the watcher entirely and stayed
 *   green, because nothing downstream asserted that a write had arrived.
 *
 * The common property is that absence satisfies them. So the rule is
 * structural rather than stylistic: after a navigation, wait for something
 * positive — a URL that only the intended destination has, or an element only
 * it renders — and never make an assertion conditional on a locator matching.
 *
 * Deliberately a text scan and not a lint rule. It costs nothing to run, it
 * needs no plugin, and the two patterns are recognisable without a parser.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const e2eDir = join(projectRoot, "e2e");

/**
 * The body an `if` guards, and whether it has an `else`.
 *
 * Brace-matched rather than pattern-matched: the closing brace of the
 * consequent is the only reliable place to look, and its indentation is not.
 * A braceless `if` takes the rest of its line, which is how every single-
 * statement guard in these files is written.
 *
 * String and comment contents are not parsed, which is acceptable here — a
 * brace inside a string literal between the condition and its `else` would be
 * needed to fool it, and that is not something these files do.
 */
function guardedBranch(source, index) {
  // Balanced from the `if`'s own parenthesis. Taking the next `)` instead
  // finds the one closing `count()`, which is what this did at first: the
  // body then read as `) {` and the rule silently matched nothing.
  const conditionStart = source.indexOf("(", index);
  if (conditionStart === -1) return { body: "", hasElse: false };
  let conditionEnd = -1;
  let parens = 0;
  for (let at = conditionStart; at < source.length; at += 1) {
    if (source[at] === "(") parens += 1;
    else if (source[at] === ")") {
      parens -= 1;
      if (parens === 0) {
        conditionEnd = at;
        break;
      }
    }
  }
  if (conditionEnd === -1) return { body: "", hasElse: false };
  const rest = source.slice(conditionEnd + 1);
  const leading = rest.match(/^\s*/)?.[0].length ?? 0;
  if (rest[leading] !== "{") {
    const newline = rest.indexOf("\n");
    return { body: newline === -1 ? rest : rest.slice(0, newline), hasElse: false };
  }
  const open = conditionEnd + 1 + leading;
  let depth = 0;
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === "{") depth += 1;
    else if (source[at] === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          body: source.slice(open + 1, at),
          hasElse: /^\s*else\b/.test(source.slice(at + 1)),
        };
      }
    }
  }
  return { body: "", hasElse: false };
}

/**
 * Whether a conditional is guarding an assertion rather than an action.
 *
 * A conditional click or cleanup step is not this rule's business — the editor
 * suite restores a hidden section in a `finally` with `if (await show.count())`
 * and then asserts, unconditionally, that the section came back. What the rule
 * forbids is the assertion itself disappearing when a locator stops matching,
 * so it looks for an `expect` inside the branch and for an `else` that would
 * make the absent case asserted too.
 */
function skipsAnAssertion(source, index) {
  const { body, hasElse } = guardedBranch(source, index);
  return /\bexpect\s*[(.]/.test(body) && !hasElse;
}

const RULES = [
  {
    label: "an assertion skipped entirely when a locator stops matching",
    pattern: /if\s*\(\s*await\s+[^)\n]*\.count\(\s*\)/g,
    // A branch that also says what must be true when the element is absent is
    // sound: absence is then asserted rather than assumed. One without an
    // `else` is the failure this exists to catch, because a locator that
    // stopped matching returns zero and the whole check disappears.
    allow: (source, index) => !skipsAnAssertion(source, index),
    remedy:
      "assert the element directly, or give the branch an `else` that says what must be true when it is absent. A locator that stops matching returns zero, which satisfies the condition and removes the check with no trace.",
  },
  {
    label: "a navigation proved by the absence of a URL",
    pattern: /\.not\s*\.\s*toHaveURL\s*\(/g,
    remedy:
      "wait for the destination instead: `await expect(page).toHaveURL(/…/)`, or `page.waitForURL(…)`. A positive assertion polls until it matches; a negative one is satisfied before a client-side redirect has had the chance to run.",
  },
];

/** Every spec and helper under `e2e/`, which is where these rules apply. */
function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collect(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const files = collect(e2eDir);
const findings = [];

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split("\n").length;
      // A rule may name itself in a comment explaining why it exists.
      if (/^\s*(\/\/|\*|\/\*)/.test(lines[line - 1] ?? "")) continue;
      if (rule.allow?.(source, match.index)) continue;
      findings.push({
        file: relative(projectRoot, file),
        line,
        label: rule.label,
        remedy: rule.remedy,
      });
    }
  }
}

if (findings.length > 0) {
  console.error("\n[check-e2e-assertions] Assertions that can pass without running:\n");
  for (const { file, line, label, remedy } of findings) {
    console.error(`  ${file}:${line}\n    → ${label}\n      ${remedy}\n`);
  }
  process.exit(1);
}

console.log(
  `[check-e2e-assertions] OK — scanned ${files.length} files, no assertions that absence would satisfy.`,
);
