import type { Plugin } from "vite";

/**
 * Keep the existing static preview HTML/asset contract, but compile its
 * browser graph with Start too. Never build an extra server or prerender
 * Theme code for this artifact. The runtime build owns the real server.
 */
export function createThemeStartStaticPreviewPlugin(options: {
  indexHtml: string;
  outDir: string;
}): Plugin {
  return {
    name: "morph-start-static-preview",
    enforce: "post",
    config() {
      return {
        builder: {
          async buildApp(builder) {
            await builder.build(builder.environments.client!);
          },
        },
      };
    },
    configEnvironment(name) {
      if (name !== "client") return;
      return {
        build: {
          outDir: options.outDir,
          rollupOptions: { input: { index: options.indexHtml } },
        },
      };
    },
  };
}

/** Same platform plugin for a generated Sandbox config; no Theme input code. */
export function themeStartStaticPreviewPluginSource(options: {
  indexHtml: string;
  outDir: string;
}): string {
  return `(${createThemeStartStaticPreviewPlugin.toString()})(${JSON.stringify(options)})`;
}
