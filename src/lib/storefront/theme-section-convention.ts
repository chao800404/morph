/**
 * The folder convention that makes a Theme component a section.
 *
 * A section is a component a route can render as one editable block. Add
 * section uses this folder as its source of truth, so a component becomes a
 * candidate by living in the folder instead of being registered in a manifest
 * or inferred from its content fields. Content capability resolution remains a
 * separate concern: it decides which props Design Mode may write after a
 * section has been selected.
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
 * A Theme that has not adopted the convention has no Add section candidates.
 * Existing route slots can still be read through their source imports and the
 * manifest compatibility path; this rule only defines what the Add section
 * action is allowed to create.
 */

/** The one folder a section may be declared by living in. */
export const THEME_SECTION_FOLDER_PATH = "src/components/sections";

/** Page-owned copies are section implementations, but never Add section candidates. */
export const THEME_PAGE_SECTION_FOLDER_PATH = "src/components/page-sections";

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

/**
 * Recognizes the entry file of a page-owned copy without adding it to the
 * shared Add section library.
 *
 * The first segment after `page-sections` is the route key. Add section and
 * detach write `<route key>/<slot id>/index.tsx`, one folder per placed
 * instance; the direct `<route key>/<Name>.tsx` shape is what earlier detaches
 * wrote, and stays readable so those copies keep their inferred fields.
 */
export function readThemePageSectionEntry(
  path: string,
): ThemeSectionEntry | null {
  const normalized = normalizePath(path);
  const prefix = `${THEME_PAGE_SECTION_FOLDER_PATH}/`;
  if (!normalized.startsWith(prefix)) return null;

  const segments = normalized.slice(prefix.length).split("/");
  if (segments.length === 2) {
    const base = readDirectEntryBaseName(segments[1]!);
    return base === null ? null : buildEntry(normalized, base);
  }
  if (segments.length === 3) {
    const isIndex = SECTION_ENTRY_EXTENSIONS.some(
      (extension) => segments[2] === `index${extension}`,
    );
    return isIndex ? buildEntry(normalized, segments[1]!) : null;
  }
  return null;
}

/** A source file that can expose inferred content fields as a section. */
export function isThemeSectionSourcePath(path: string): boolean {
  return Boolean(
    readThemeSectionEntry(path) ?? readThemePageSectionEntry(path),
  );
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
