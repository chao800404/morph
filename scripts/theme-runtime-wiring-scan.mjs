/**
 * Decides whether Morph Core's Theme Worker transport is wired, from the
 * configuration alone.
 *
 * Three states, and the third is the point: `PENDING` is not a pass. A guard
 * that goes green because nothing is configured encodes "not done" as
 * "verified" — the same defect as `required.every(passed)` over an empty status
 * rollup, which reported a mergeable pull request for the seconds before the
 * required check existed. `docs/visual-editor-progress.md` states the rule this
 * makes checkable: 未完成前不得把 build artifact 說成已上線 runtime.
 *
 * The config is read as JSONC, not as text, and the reason is measured rather
 * than asserted. Two naive readings of the real `wrangler.jsonc` disagree with
 * each other, so "a pattern match" is not one thing:
 *
 * - matching `"services"` against the **raw** file finds the commented-out
 *   example and reports `MY_SERVICE` — a `FAIL` against a placeholder where the
 *   truth is `PENDING`;
 * - stripping `//` to end-of-line **first** blanks that comment and yields
 *   `PENDING` — the right answer for the wrong reason, and only because the
 *   example happens to be commented out.
 *
 * Neither is acceptable, and the strip has to be string-aware as a requirement
 * rather than a precaution: the same file spells `http(s)://` **ten** times, and
 * a naive strip removes **all ten** — including the real `vars.PUBLIC_URL`,
 * whose line ends up as `"PUBLIC_URL": "https:`. A string-aware strip keeps
 * exactly one, the one that is a value.
 *
 * What this decides, and what it cannot:
 *
 * - `services[].binding` is compared against the constant the runtime actually
 *   reads (`DEFAULT_THEME_SERVICE_BINDING`), so a rename on either side is
 *   caught rather than silently falling through to a 503.
 * - The target script name can only be checked for **shape**. It is
 *   `morph-theme-<storefrontId>`, and the storefront id is a deployment fact
 *   that is not in the repository. `themeWorkerScriptName(themeBuildId)`
 *   produces the same shape, so a config pointing at a build-scoped name passes
 *   this check. `theme-runtime.types.ts` says those two names are "kept separate
 *   … so the two topologies cannot silently share a target" — by shape alone
 *   they cannot be told apart, and only the storefront id can settle it. Stated
 *   here rather than left as an implied guarantee.
 */

export const PENDING = "PENDING";
export const PASS = "PASS";
export const FAIL = "FAIL";

/**
 * Shape of a storefront's stable Theme Worker script name.
 *
 * Mirrors `toScriptNameSegment` in `theme-runtime.types.ts`: lowercased,
 * `[^a-z0-9-]` folded to `-`, at most 54 characters.
 */
const STOREFRONT_SCRIPT_NAME = /^morph-theme-[a-z0-9-]{1,54}$/;

/**
 * Blanks out `//` and block comments without moving any byte.
 *
 * Offsets are preserved (comment characters become spaces) so a parse error can
 * still point at the line it came from.
 */
export function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      } else {
        out += " ";
      }
      continue;
    }

    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        out += "  ";
        i += 1;
      } else {
        out += ch === "\n" ? ch : " ";
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      out += "  ";
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      out += "  ";
      i += 1;
      continue;
    }
    out += ch;
  }

  return out;
}

/** Drops a `,` that is followed only by whitespace and a closing bracket. */
export function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === "}" || text[j] === "]") {
        out += " ";
        continue;
      }
    }

    out += ch;
  }

  return out;
}

/**
 * Parses a JSONC document, reporting failure rather than throwing.
 *
 * A config this guard cannot read is a `FAIL`, never a `PENDING`: "I could not
 * look" and "there is nothing there" are different answers, and only one of
 * them is true here.
 */
export function parseJsonc(text) {
  try {
    return { ok: true, value: JSON.parse(stripTrailingCommas(stripJsonComments(text))) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Reads the binding name the runtime resolves, from its own source.
 *
 * The guard must not carry a second copy of this string: comparing a hardcoded
 * `"THEME_WORKER"` against the config would pass while the runtime looked for
 * something else entirely.
 */
export function readDefaultThemeServiceBinding(source) {
  const match = source.match(
    /export\s+const\s+DEFAULT_THEME_SERVICE_BINDING\s*=\s*"([^"]+)"/,
  );
  return match ? match[1] : null;
}

/**
 * The three-state decision.
 *
 * `services` absent → `PENDING` (not configured; the request path ends in a 503).
 * `services` present but disagreeing with the runtime → `FAIL`.
 * Agreeing → `PASS`.
 */
export function evaluateThemeRuntimeWiring({ config, defaultBindingName }) {
  if (typeof defaultBindingName !== "string" || defaultBindingName.trim() === "") {
    return {
      state: FAIL,
      message:
        "DEFAULT_THEME_SERVICE_BINDING could not be read from " +
        "src/lib/storefront/service/storefront-request-routing.ts, so this guard has no " +
        "subject. Restore the export or update this guard.",
    };
  }

  const services = Array.isArray(config?.services) ? config.services : [];
  if (services.length === 0) {
    return {
      state: PENDING,
      message:
        'wrangler.jsonc declares no "services" binding, so createThemeRuntime falls ' +
        "through service-binding -> dispatch -> local to UnavailableThemeRuntime and " +
        "every storefront request answers 503. Declare " +
        `{ "binding": "${defaultBindingName}", "service": "morph-theme-<storefrontId>" } ` +
        "in the production environment.",
    };
  }

  const declared = services.map((entry) =>
    entry && typeof entry.binding === "string" ? entry.binding : "(unnamed)",
  );
  const theme = services.find(
    (entry) => entry && entry.binding === defaultBindingName,
  );

  if (!theme) {
    return {
      state: FAIL,
      message:
        `services declares ${declared.join(", ")}; none is "${defaultBindingName}", ` +
        "which is the name createThemeRuntime resolves. A misspelled binding does not " +
        "error — it returns null, hasServiceBinding is false, and the request falls " +
        `through to a 503 whose message tells the reader to bind "${defaultBindingName}", ` +
        "which is what they already did.",
    };
  }

  if (typeof theme.service !== "string" || !STOREFRONT_SCRIPT_NAME.test(theme.service)) {
    return {
      state: FAIL,
      message:
        `"${defaultBindingName}" points at ` +
        `${typeof theme.service === "string" ? `"${theme.service}"` : "a missing or non-string service"}, ` +
        "which is not a storefront Theme Worker script name (morph-theme-<storefrontId>, " +
        "lowercase, [a-z0-9-], at most 54 characters).",
    };
  }

  return {
    state: PASS,
    message: `"${defaultBindingName}" -> "${theme.service}" (storefront-stable shape).`,
  };
}
