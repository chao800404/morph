/**
 * What a Theme author writes for a `type: "link"` field, rendered by real
 * React from a stored value.
 *
 * `rel` is read off the value rather than assembled in the component, so an
 * unprotected new tab is never one forgotten attribute away. The value reaches
 * the component through the same content resolution the Live Preview snapshot
 * and the published site share, which is where the link is resolved.
 */
import { describe, expect, it } from "vitest";
import type { JsonValue } from "@/db/json";
import {
  livePreviewPlatformFiles,
  renderLivePreviewRoute,
} from "@/lib/test-utils/live-preview-render";

const HERO_SOURCE = `export const contentFields = {
  action: { type: "link", label: "Action" },
} as const;

export default function Hero({ action = {}, actionLabel = "Shop" }) {
  return (
    <a
      href={action.href}
      target={action.target}
      rel={action.rel}
      title={action.title}
      download={action.download}
    >
      {actionLabel}
    </a>
  );
}`;

const ROUTE_SOURCE = `import { createFileRoute } from "@tanstack/react-router";
import { content } from "../morph/content";
import Hero from "../components/Hero";
export const Route = createFileRoute("/")({ component: HomeRoute });
function HomeRoute() {
  return <main><Hero {...content("hero")} /></main>;
}`;

/** The Hero's anchor, rendered from a stored `action` value. */
async function renderAction(action: JsonValue): Promise<string> {
  const { html } = await renderLivePreviewRoute({
    files: [
      ...livePreviewPlatformFiles(),
      { path: "src/components/Hero.tsx", content: HERO_SOURCE },
      { path: "src/routes/index.tsx", content: ROUTE_SOURCE },
    ],
    documents: {
      index: {
        version: 1,
        sections: [
          { id: "hero", type: "hero", enabled: true, props: { action } },
        ],
      },
    },
  });
  const anchor = /<a\b[^>]*>Shop<\/a>/.exec(html)?.[0];
  if (!anchor) throw new Error(`no Hero anchor in ${html}`);
  return anchor;
}

describe("a link content field reaching a component, in real React", () => {
  it("renders an in-store destination with nothing extra", async () => {
    const anchor = await renderAction({ href: "/collections/all" });
    expect(anchor).toContain('href="/collections/all"');
    expect(anchor).not.toContain("target=");
    expect(anchor).not.toContain("rel=");
  });

  it("protects a cross-origin new tab without the author asking", async () => {
    const anchor = await renderAction({
      href: "https://example.com",
      target: "_blank",
    });
    expect(anchor).toContain('target="_blank"');
    expect(anchor).toContain('rel="noopener noreferrer"');
  });

  it("carries nofollow alongside that protection", async () => {
    expect(
      await renderAction({
        href: "https://example.com",
        target: "_blank",
        nofollow: true,
      }),
    ).toContain('rel="noopener noreferrer nofollow"');
  });

  it("renders the advisory title", async () => {
    expect(await renderAction({ href: "/a", title: "Our lookbook" })).toContain(
      'title="Our lookbook"',
    );
  });

  it("marks an in-store file as a download", async () => {
    expect(
      await renderAction({ href: "/lookbook.pdf", download: true }),
    ).toContain("download");
  });

  it("drops download for another origin, which browsers ignore anyway", async () => {
    expect(
      await renderAction({ href: "https://example.com/a.pdf", download: true }),
    ).not.toContain("download");
  });

  it("leaves an inert anchor for a script destination", async () => {
    const anchor = await renderAction({ href: "javascript:alert(1)" });
    expect(anchor).not.toContain("javascript:");
    expect(anchor).not.toContain("href=");
  });

  it("leaves a bare string unresolved, because a link is told apart by shape", async () => {
    // Slot values carry no field types, so a link is recognised by its shape.
    // A string stored before the field became a link stays a string, and the
    // component reads no `href` off it.
    expect(await renderAction("/about")).not.toContain('href="/about"');
  });
});
