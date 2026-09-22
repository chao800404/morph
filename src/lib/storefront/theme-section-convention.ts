/**
 * The folder convention that makes a Theme component a section.
 *
 * A section is a component a route can render as one editable block. Today a
 * Theme says so by registering it: either the manifest names it under
 * `components`, or the component declares its own `contentFields` and the
 * capability scanner finds it. Both work, and both can be forgotten — the
 * component exists, imports, renders, and simply never appears in Add section,
 * with nothing anywhere saying why. That silence is the actual cost: the author
 * sees a component they wrote and a list that does not contain it, and has no
 * way to tell a missing declaration from a broken one.
 *
 * This module declares the way to say it without registering anything: put the
 * file in the section folder and it is a section.
 *
 * The rule is deliberately narrow, because a convention that guesses is worse
 * than one that asks. Only two shapes are entries, and both are direct children
 * of the folder:
 *
 *   src/components/sections/Hero.tsx          → Hero
 *   src/components/sections/hero/index.tsx    → Hero
 *
 * Nothing deeper qualifies. `src/components/sections/hero/parts/Aside.tsx` is a
 * file Hero is built from, not a section: were depth enough to qualify, every
 * private helper under the folder would become a block an author could add to a
 * page, and the list would fill with components that were never meant to stand
 * alone. The one-level-down shape stays available for a section that needs
 * sibling files, which is the case it exists for.
 *
 * The convention is one more way to be a candidate, not a replacement for the
 * others. A Theme that has not adopted it keeps exactly the candidates it had,
 * because nothing here removes a registration — it only lets a file qualify
 * without one.
 */

/** The one folder a section may be declared by living in. */
export const THEME_SECTION_FOLDER_PATH = "src/components/sections";

/**
 * Extensions an entry file may carry.
 *
 * A section renders an element, so a `.ts` file cannot be one: offering it
 * would put a component in the list that has nothing to render.
 */
const SECTION_ENTRY_EXTENSIONS = [".tsx", ".jsx"] as const;

/**
 * A local binding has to be an identifier the generated import can name.
 *
 * A folder called `2-columns` derives `2Columns`, which no import statement can
 * bind. Refusing the entry is the fail-closed answer: the alternative is a
 * candidate whose Add section writes source that does not parse.
 */
const COMPONENT_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export type ThemeSectionEntry = Readonly<{
  /** Path of the entry file, as the workspace knows it. */
  componentSourcePath: string;
  /** Local binding the route imports the entry under. */
  componentName: string;
  /**
   * Ref the entry is addressed by when no manifest ref claims the same file.
   *
   * The source path, which is the same shape the capability scanner already
   * falls back to for a component it discovered from source rather than from
   * the manifest.
   */
  componentRef: string;
  /** Section type the entry maps to, derived from its name. */
  sectionType: string;
}>;

function normalizePath(path: string): string {
  const stack: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return "";
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

/** Splits a name into words on separators and camel-case boundaries. */
function words(segment: string): string[] {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);
}

function pascalCase(segment: string): string {
  return words(segment)
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join("");
}

function kebabCase(segment: string): string {
  return words(segment)
    .map((word) => word.toLowerCase())
    .join("-");
}

function buildEntry(
  componentSourcePath: string,
  base: string,
): ThemeSectionEntry | null {
  const componentName = pascalCase(base);
  if (!COMPONENT_NAME_PATTERN.test(componentName)) return null;
  return {
    componentSourcePath,
    componentName,
    componentRef: componentSourcePath,
    sectionType: kebabCase(base),
  };
}

/**
 * The name a file directly in the folder contributes, or `null` when the file
 * is not an entry.
 *
 * Two files look like entries and are not. A test sits beside the component it
 * tests — this repository colocates them — and would otherwise be offered as a
 * section of its own. A root `index` has no name to derive: a subfolder's
 * `index` is named after its folder, and the folder root has none, which makes
 * it the file most likely to be a barrel re-exporting the whole folder.
 */
function readDirectEntryBaseName(file: string): string | null {
  const extension = SECTION_ENTRY_EXTENSIONS.find((candidate) =>
    file.endsWith(candidate),
  );
  if (!extension) return null;
  const base = file.slice(0, -extension.length);
  if (!base || base === "index" || /\.(test|spec)$/i.test(base)) return null;
  return base;
}

/**
 * Reads one path as a section entry, or refuses it.
 *
 * Refusing is the common case and not an error: most files in a Theme are not
 * sections, and the caller is asking a question rather than reporting a
 * problem. Only the two shapes the convention names answer.
 */
export function readThemeSectionEntry(path: string): ThemeSectionEntry | null {
  const normalized = normalizePath(path);
  const prefix = `${THEME_SECTION_FOLDER_PATH}/`;
  if (!normalized.startsWith(prefix)) return null;

  const segments = normalized.slice(prefix.length).split("/");
  if (segments.length === 1) {
    const base = readDirectEntryBaseName(segments[0]!);
    return base === null ? null : buildEntry(normalized, base);
  }

  if (segments.length === 2) {
    const directory = segments[0]!;
    const file = segments[1]!;
    const isIndex = SECTION_ENTRY_EXTENSIONS.some(
      (extension) => file === `index${extension}`,
    );
    if (!isIndex) return null;
    // Named for the folder rather than for `index`, which is the name the
    // route's import would otherwise have to bind.
    return buildEntry(normalized, directory);
  }

  return null;
}

/** Every section entry among a Theme's files, ordered by section type. */
export function listThemeSectionEntries(
  files: readonly Readonly<{ path: string }>[],
): readonly ThemeSectionEntry[] {
  const entries: ThemeSectionEntry[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const entry = readThemeSectionEntry(file.path);
    if (!entry || seen.has(entry.componentSourcePath)) continue;
    seen.add(entry.componentSourcePath);
    entries.push(entry);
  }
  return entries.sort((left, right) =>
    left.sectionType.localeCompare(right.sectionType),
  );
}
