/**
 * Specifier the editor preview build must not resolve for real.
 *
 * A Theme reads the request being served through this module during SSR. The
 * preview build is client-only — it has no Start plugin and never runs a
 * loader — so the specifier cannot resolve and the build fails outright.
 */
export const THEME_START_SERVER_SPECIFIER = "@tanstack/react-start/server";

const VIRTUAL_ID = "\0morph-theme-start-server-stub";

/**
 * Stub the preview build substitutes for the Start server module.
 *
 * Every export throws: the preview never calls them, and a silent no-op would
 * let server-only code appear to work in a build that cannot support it.
 */
const STUB_SOURCE = `const unavailable = (name) => () => {
  throw new Error(
    "Theme preview cannot call " + name + "(): server APIs run only in the deployed Theme Worker.",
  );
};
export const getRequest = unavailable("getRequest");
export const getRequestHeaders = unavailable("getRequestHeaders");
export const getRequestHeader = unavailable("getRequestHeader");
export const getRequestIP = unavailable("getRequestIP");
export const setResponseHeader = unavailable("setResponseHeader");
export const setResponseStatus = unavailable("setResponseStatus");
export default {};
`;

/**
 * Vite plugin that redirects the Start server module in preview builds only.
 *
 * The runtime build keeps the real module, so production SSR is unaffected.
 */
export function createThemePreviewServerStubPlugin() {
  return {
    name: "morph-theme-preview-server-stub",
    enforce: "pre" as const,
    resolveId(source: string) {
      return source === THEME_START_SERVER_SPECIFIER ? VIRTUAL_ID : null;
    },
    load(id: string) {
      return id === VIRTUAL_ID ? STUB_SOURCE : null;
    },
  };
}
