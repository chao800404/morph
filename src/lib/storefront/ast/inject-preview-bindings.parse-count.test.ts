// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const parseCalls = vi.hoisted(
  () => [] as { source: string; stack: string }[],
);
vi.mock("@babel/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@babel/parser")>();
  return {
    ...actual,
    parse: (source: string, options?: Parameters<typeof actual.parse>[1]) => {
      parseCalls.push({ source, stack: new Error().stack ?? "" });
      return actual.parse(source, options);
    },
  };
});

import { BAS_HERO_PATH, BAS_HERO_SOURCE } from "@/lib/test-utils/binding-acceptance-cases";
import { livePreviewPlatformFiles } from "@/lib/test-utils/live-preview-render";
import { injectPreviewBindings } from "./inject-preview-bindings";

const ROUTE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import BasHero from "../components/BasHero";
export const Route = createFileRoute("/cd")({ component: Home });
function Home() {
  const hero = content("hero");
  return <BasHero title={hero.title} />;
}`;

describe("AST parsing while proving a code default", () => {
  it("parses each source file once", () => {
    const files = [
      ...livePreviewPlatformFiles(),
      { path: BAS_HERO_PATH, content: BAS_HERO_SOURCE },
      { path: "src/routes/cd.tsx", content: ROUTE },
    ];
    parseCalls.length = 0;
    const output = injectPreviewBindings(files);
    expect(
      output.files.find((file) => file.path === BAS_HERO_PATH)!.content,
    ).toContain('"code-default"');

    const counts = new Map<string, number>();
    for (const { source } of parseCalls) {
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }

    if (process.env.MORPH_PARSE_DEBUG === "1") {
      const stacks = parseCalls.filter((call) => call.source === BAS_HERO_SOURCE);
      console.log(
        "PARSE_STACKS\n" +
          stacks
            .map(
              (call, index) =>
                `#${index + 1}\n` +
                call.stack
                  .split("\n")
                  .slice(1, 7)
                  .map((line) => line.trim())
                  .join("\n"),
            )
            .join("\n\n"),
      );
    }
    expect(counts.get(BAS_HERO_SOURCE), `component parsed ${counts.get(BAS_HERO_SOURCE)}x`).toBe(1);
    expect(counts.get(ROUTE)).toBe(1);
    expect(Math.max(...counts.values())).toBe(1);
  });
});
