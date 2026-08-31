/**
 * Dependency policy shared by the CMS request boundary and the isolated
 * theme compiler.  The package map is supplied by cms.config; this module
 * never resolves packages from user input or from the host filesystem.
 */
export type ThemeDependencyMap = Readonly<Record<string, string>>;

export type ThemeDependencyCatalogItem = {
  name: string;
  version: string;
  root: string;
};

const PACKAGE_SPECIFIER_PATTERN =
  /^(?:@[a-z0-9._~-]+\/[a-z0-9._~-]+|[a-z0-9._~-]+)(?:\/[a-z0-9._~-]+)*$/i;
const EXACT_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function themePackageRoot(specifier: string): string {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] ?? specifier);
}

export function normalizeThemeDependencyMap(
  dependencies: ThemeDependencyMap | undefined,
): Record<string, string> {
  if (!dependencies) return {};
  return Object.fromEntries(
    Object.entries(dependencies).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

export function getThemeDependencyCatalog(
  dependencies: ThemeDependencyMap | undefined,
): ThemeDependencyCatalogItem[] {
  const roots = new Map<string, string>();
  for (const [specifier, version] of Object.entries(dependencies ?? {})) {
    const root = themePackageRoot(specifier);
    if (!roots.has(root)) roots.set(root, version);
  }
  return [...roots.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, version]) => ({ name, version, root: name }));
}

/**
 * Validates a customer-selected map against the platform-owned cms.config
 * map.  A tenant may enable a package already approved by the platform, but
 * can never introduce an arbitrary npm specifier or version from the UI.
 */
export function validateThemeDependencySelection(
  selected: ThemeDependencyMap | undefined,
  approved: ThemeDependencyMap | undefined,
): string[] {
  const errors: string[] = [];
  const approvedMap = approved ?? {};
  const approvedRoots = new Map<string, string>();

  for (const [specifier, version] of Object.entries(approvedMap)) {
    approvedRoots.set(themePackageRoot(specifier), version);
  }

  for (const [specifier, version] of Object.entries(selected ?? {})) {
    if (!PACKAGE_SPECIFIER_PATTERN.test(specifier)) {
      errors.push(`Theme dependency name "${specifier}" is invalid.`);
      continue;
    }
    if (!EXACT_VERSION_PATTERN.test(version)) {
      errors.push(
        `Theme dependency ${specifier} must use an exact semver version (received "${version}").`,
      );
      continue;
    }
    const root = themePackageRoot(specifier);
    const approvedVersion = approvedMap[specifier] ?? approvedRoots.get(root);
    if (!approvedVersion) {
      errors.push(
        `Theme dependency "${specifier}" is not approved in cms.config.ts.`,
      );
    } else if (approvedVersion !== version) {
      errors.push(
        `Theme dependency "${specifier}" must use the platform-approved version "${approvedVersion}".`,
      );
    }
  }

  return errors;
}

export function mergeThemeDependencyMaps(
  approved: ThemeDependencyMap,
  selected: ThemeDependencyMap | undefined,
): Record<string, string> {
  return normalizeThemeDependencyMap({ ...approved, ...(selected ?? {}) });
}
