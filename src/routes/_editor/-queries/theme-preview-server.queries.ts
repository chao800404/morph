import { queryOptions } from "@tanstack/react-query";
import { startThemePreviewServer } from "@/server/storefront/storefront-theme-preview-server.serverFn";

/**
 * Says how long each stage of starting a preview took.
 *
 * Both transports measure this — `workspaceMs`, `workspaceMaterializeMs`,
 * `viteReadyMs` and the rest — and the sandbox server's own comment says why:
 * "returned stage timings make local and deployed latency measurable". The
 * server function has always returned them beside `readyMs`. Nothing read them,
 * so a preview that takes eight seconds in a container was one number with no
 * breakdown, and the only way to ask which stage was slow was to add logging to
 * find out — every time.
 *
 * Logged rather than surfaced in the UI because the audience is whoever is
 * looking at a slow start: in development that is a terminal, in a deployed
 * editor it is the browser console, and for the end-to-end suite it is
 * `page.on("console")`, which reads it without coupling to how the reply was
 * encoded. That coupling is not hypothetical — TanStack Start serialises server
 * function replies with seroval, so reading `timings` off the response body is
 * not property access, and a test that tried returned nothing at all.
 *
 * Once per editor and Theme, because the query is asked once and never
 * refetched. Entries are iterated rather than named so a new stage appears here
 * the moment it is measured.
 */
function reportPreviewServerTimings(
  result: Awaited<ReturnType<typeof startThemePreviewServer>>,
): void {
  if (!result.success) return;
  const { readyMs, timings } = result.data;
  // `Ms` decides the unit. The same object carries counts — `mkdirCalls`,
  // `writeCalls`, `readCalls` — and a first version suffixed every number with
  // `ms`, which reported 45 filesystem writes as 45 milliseconds. A log that
  // labels its own numbers wrongly is worse than one that omits them.
  const stages = Object.entries(timings ?? {})
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([name, value]) => `${name}=${value}${name.endsWith("Ms") ? "ms" : ""}`)
    .join(" ");
  console.log(
    `[preview-server] ready in ${readyMs}ms${stages ? ` | ${stages}` : ""}`,
  );
}

/**
 * The dev server a Theme's Live Preview is served from.
 *
 * Always asked, because the answer is the server's to give. It resolves the
 * preview host before touching a container, so a deployment that has not
 * configured one refuses immediately and costs nothing — and the editor is
 * not left holding a second switch that has to agree with the first. Two of
 * them is how this came to look enabled while showing the old preview.
 *
 * Asked once per editor and Theme, and never retried on its own: starting one
 * runs a container, so a failing start that retried in the background would
 * keep doing that while the author works in a preview already showing them
 * something. It stays fresh indefinitely for the same reason — the container
 * is reattached by id, so asking again would only re-answer a question whose
 * answer has not changed.
 */
export const themePreviewServerQueries = {
  all: () => ["theme-preview-server"] as const,
  forTheme: (storefrontId: string, themeId: string) =>
    queryOptions({
      queryKey: [...themePreviewServerQueries.all(), storefrontId, themeId],
      queryFn: async () => {
        const result = await startThemePreviewServer({
          data: { storefrontId, themeId },
        });
        reportPreviewServerTimings(result);
        return result;
      },
      retry: false,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),
};
