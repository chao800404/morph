import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import viteTsConfigPaths from "vite-tsconfig-paths";

const config = defineConfig({
  plugins: [
    devtools(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    tanstackStart(),
    // Must come after tanstackStart: with vite-tsconfig-paths registered first,
    // Start's import protection cannot resolve aliased imports and silently
    // stops reporting violations (TanStack/router#6770).
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    viteReact(),
  ],
  server: {
    /**
     * Storefront routing is decided by hostname, so testing it locally requires
     * reaching the dev server on something other than `localhost`. Vite blocks
     * unknown hosts by default (DNS-rebinding protection), which rejects the
     * request before it can reach the Worker.
     *
     * `.localtest.me` resolves to 127.0.0.1 through public DNS, so a storefront
     * hostname needs no hosts-file entry. A leading dot allows subdomains.
     *
     * This applies to `vite dev` only — production hostname classification is
     * unaffected, and platform surface is still separated by
     * `collectPlatformHostnames`. Add more dev hostnames with
     * `MORPH_DEV_ALLOWED_HOSTS` (comma-separated) rather than disabling the
     * check entirely.
     */
    allowedHosts: [
      ".localtest.me",
      ...(process.env.MORPH_DEV_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    ],
  },
  optimizeDeps: {
    exclude: ["vinxi/http"],
  },
});

export default config;
