/**
 * A Theme file tree with no router: one component, no `src/routes`.
 *
 * The editor shell takes a selection or an edit from a preview frame that
 * never named a page only once it has read the Theme's files and found no
 * router there, so the frame can show only the one document the editor
 * sends it. Shell tests whose subject is something else, and whose frame
 * names no page, seed the file tree query with this so the editor knows that
 * much; with no tree read at all, it takes nothing from the frame.
 */
export function noRouterThemeTree() {
  const path = "src/components/Hero.tsx";
  return {
    files: [
      {
        id: "file-no-router-hero",
        storefrontId: "storefront-1",
        themeId: "theme-1",
        path,
        content:
          'export default function Hero({ heading = "Welcome" }) {\n  return <section><h1>{heading}</h1></section>;\n}\n',
        mimeType: "text/typescript",
        isEntry: false,
        version: 1,
        createdAt: "2026-10-17T00:00:00.000Z",
        updatedAt: "2026-10-17T00:00:00.000Z",
      },
    ],
    tree: [
      {
        name: "src",
        path: "src",
        isDirectory: true,
        children: [
          {
            name: "components",
            path: "src/components",
            isDirectory: true,
            children: [{ name: "Hero.tsx", path, isDirectory: false }],
          },
        ],
      },
    ],
    sourceGeneration: 1,
    latestPublishedRevision: null,
  };
}
