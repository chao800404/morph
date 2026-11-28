/**
 * The check of a Vite Web Worker bundle's built module graph, as plugin
 * source for a config Morph writes.
 *
 * A worker (`?worker`, `new Worker(new URL(...))`) is its own bundle, built
 * with `worker.plugins` only. Morph's import guard runs there first, but a
 * resolver hook is answered by whichever plugin returns first, so once the
 * worker is built its resolved graph is held to the guard's two rules
 * whichever resolver answered:
 *
 * - a module outside every package lies in the workspace;
 * - a package imported from outside every package is approved. Imports
 *   between packages are the packages' own, as the import guard leaves them.
 *
 * A module's package is the one its path names after its last
 * `node_modules/`, virtual (`\0`) ids included, so a package's own CommonJS
 * proxies stay that package's. Other virtual ids have no file to contain.
 *
 * Reads `path` and `fs` from the config around it; `allowedPackages` and
 * `workspaceRoot` are expressions there: a `Set` of approved package names,
 * and the workspace's absolute path.
 */
export function themeWorkerGraphGuardPluginSource(options: {
  allowedPackages: string;
  workspaceRoot: string;
}): string {
  return `{
    name: "morph:worker-graph-guard",
    buildEnd(error) {
      if (error) return;
      const allowed = ${options.allowedPackages};
      const roots = [String(${options.workspaceRoot}).replace(/\\\\/g, "/")];
      try {
        roots.push(fs.realpathSync(${options.workspaceRoot}).replace(/\\\\/g, "/"));
      } catch {}
      const inWorkspace = (file) =>
        roots.some((root) => file === root || file.startsWith(root + "/"));
      const ownerOf = (id) => {
        const file = id.replace(/^\\0/, "").split("?")[0].replace(/\\\\/g, "/");
        const packages = file.lastIndexOf("/node_modules/");
        if (packages < 0) {
          return { file, pkg: null, virtual: id.startsWith("\\0") || !path.isAbsolute(file) };
        }
        const parts = file.slice(packages + "/node_modules/".length).split("/");
        return {
          file,
          pkg: parts[0].startsWith("@") ? parts[0] + "/" + parts[1] : parts[0],
          virtual: false,
        };
      };
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info) continue;
        const owner = ownerOf(id);
        if (owner.pkg === null) {
          if (!owner.virtual && !inWorkspace(owner.file)) {
            this.error('WORKSPACE_PATH_ESCAPE: Worker module "' + id + '" resolves outside the workspace.');
          }
          continue;
        }
        if (allowed.has(owner.pkg)) continue;
        for (const importer of [...(info.importers ?? []), ...(info.dynamicImporters ?? [])]) {
          if (ownerOf(importer).pkg !== null) continue;
          this.error('UNAPPROVED_DEPENDENCY: Theme worker module "' + importer + '" imports "' + id + '" from package "' + owner.pkg + '", which is not an approved dependency.');
        }
      }
    },
  }`;
}
