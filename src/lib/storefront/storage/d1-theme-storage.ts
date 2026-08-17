import { storefrontThemeBuildDal } from "@/lib/storefront/dal/storefront-theme-build.dal";
import { storefrontThemeFileDal } from "@/lib/storefront/dal/storefront-theme-file.dal";
import type {
  ThemeRevisionStore,
  ThemeSourceStore,
} from "./theme-storage.types";

/**
 * Current D1-backed implementation of the mutable theme workspace boundary.
 *
 * This intentionally delegates to the existing DAL so source-generation and
 * file-version OCC semantics remain unchanged while callers stop depending on
 * the concrete D1 representation.
 */
export const d1ThemeSourceStore: ThemeSourceStore = {
  initStarterTheme: (...args) => storefrontThemeFileDal.initStarterTheme(...args),
  listFiles: (...args) => storefrontThemeFileDal.listFiles(...args),
  getWorkspaceSnapshot: (...args) => storefrontThemeFileDal.listFiles(...args),
  getFileByPath: (...args) => storefrontThemeFileDal.getFileByPath(...args),
  saveFile: (...args) => storefrontThemeFileDal.saveFile(...args),
  saveFilesBatch: (...args) => storefrontThemeFileDal.saveFilesBatch(...args),
  deleteFile: (...args) => storefrontThemeFileDal.deleteFile(...args),
  getSourceGeneration: (...args) =>
    storefrontThemeFileDal.getSourceGeneration(...args),
};

/**
 * Current D1-backed implementation of immutable theme revisions.
 *
 * `materializeRevision` is the storage seam used by the build pipeline. Today
 * it returns the existing D1 revision DTO; a future object/artifact backend can
 * reconstruct the same DTO without exposing its storage representation.
 */
export const d1ThemeRevisionStore: ThemeRevisionStore = {
  createRevision: (...args) => storefrontThemeFileDal.createRevision(...args),
  getRevision: (...args) => storefrontThemeBuildDal.getRevision(...args),
  async materializeRevision(storefrontId, themeId, revisionId) {
    const revision = await storefrontThemeBuildDal.getRevision(
      storefrontId,
      themeId,
      revisionId,
    );
    if (!revision) {
      throw new Error(
        `SOURCE_REVISION_NOT_FOUND: Immutable source revision "${revisionId}" was not found for storefront "${storefrontId}" and theme "${themeId}".`,
      );
    }
    return revision;
  },
  listRevisions: (...args) => storefrontThemeFileDal.listRevisions(...args),
  rollbackToRevision: (...args) =>
    storefrontThemeFileDal.rollbackToRevision(...args),
  getLatestPublishedRevision: (...args) =>
    storefrontThemeFileDal.getLatestPublishedRevision(...args),
};
