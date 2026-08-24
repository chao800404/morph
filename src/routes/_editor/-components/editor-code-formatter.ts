import type { Plugin } from "prettier";

type FormatterConfig = {
  parser: "typescript" | "babel" | "css" | "json-stringify" | "html";
  loadPlugins: () => Promise<Plugin[]>;
};

const pluginLoaders: Record<
  string,
  () => Promise<{ default?: Plugin } & Record<string, unknown>>
> = {
  babel: () => import("prettier/plugins/babel"),
  estree: () => import("prettier/plugins/estree"),
  html: () => import("prettier/plugins/html"),
  postcss: () => import("prettier/plugins/postcss"),
  typescript: () => import("prettier/plugins/typescript"),
};

let prettierPromise: Promise<typeof import("prettier/standalone")> | null = null;

const loadPrettier = () =>
  (prettierPromise ??= import("prettier/standalone"));

const plugin = async (name: string): Promise<Plugin> => {
  const module = await pluginLoaders[name]();
  return (module.default ?? module) as Plugin;
};

const formatterConfigs: Record<string, FormatterConfig> = {
  ts: {
    parser: "typescript",
    loadPlugins: async () =>
      Promise.all([plugin("typescript"), plugin("estree")]),
  },
  tsx: {
    parser: "typescript",
    loadPlugins: async () =>
      Promise.all([plugin("typescript"), plugin("estree")]),
  },
  js: {
    parser: "babel",
    loadPlugins: async () => [await plugin("babel"), await plugin("estree")],
  },
  jsx: {
    parser: "babel",
    loadPlugins: async () => [await plugin("babel"), await plugin("estree")],
  },
  css: {
    parser: "css",
    loadPlugins: async () => [await plugin("postcss")],
  },
  json: {
    parser: "json-stringify",
    loadPlugins: async () => [await plugin("babel"), await plugin("estree")],
  },
  html: {
    parser: "html",
    loadPlugins: async () => [await plugin("html")],
  },
};

function getFormatterConfig(filePath: string): FormatterConfig | null {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return extension ? (formatterConfigs[extension] ?? null) : null;
}

/** Format an editor buffer with standard Prettier defaults in the browser. */
export async function formatEditorCode(
  content: string,
  filePath: string,
): Promise<string> {
  const config = getFormatterConfig(filePath);
  if (!config) return content;

  const [prettier, plugins] = await Promise.all([
    loadPrettier(),
    config.loadPlugins(),
  ]);
  return prettier.format(content, {
    parser: config.parser,
    plugins,
  });
}
