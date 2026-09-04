import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import {
  getComponentFilePath,
  getThemeDocumentLayoutFilePath,
} from "@/lib/storefront/ast/theme-ast-transformer";
import { memo, type CSSProperties, type ReactNode } from "react";
import { renderSafeThemeComponent } from "./safe-theme-component-renderer";
import { renderSafeThemeRoute } from "./safe-theme-route-renderer";
import { StorefrontDocumentRenderer } from "./storefront-document-renderer";

type StorefrontPreviewProps = {
  context: StorefrontThemeEditorDTO;
  templateId: string;
  routePath?: string;
  viewportHeight: number;
  document?: StorefrontPageDocument;
  themeFiles?: Array<{ path: string; content: string }>;
};

type StorefrontPreviewStyle = CSSProperties & {
  "--storefront-preview-viewport-height": string;
};

export const StorefrontPreview = memo(function StorefrontPreview({
  context,
  templateId,
  routePath,
  viewportHeight,
  document,
  themeFiles,
}: StorefrontPreviewProps) {
  const template = context.templates.find(
    (candidate) => candidate.id === templateId,
  );

  if (!template) {
    return (
      <PreviewMessage
        title="Template unavailable"
        description="The selected template does not belong to this storefront theme."
      />
    );
  }

  const previewStyle: StorefrontPreviewStyle = {
    "--storefront-preview-viewport-height": `${viewportHeight}px`,
    // Keep the preview at least as tall as the selected browser viewport
    // (`h-lvh` semantics) while allowing longer page content to determine the
    // final measured height.
    minHeight: `${viewportHeight}px`,
  };

  // The editor must not make a CMS document look like a configured Theme.
  // Until the workspace has an actual source module, keep the live preview's
  // canvas present for sizing but leave its content empty.
  if (!hasThemeSourceCode(themeFiles)) {
    return (
      <div
        data-storefront-preview-root
        className="bg-stone-50 text-neutral-950"
        style={previewStyle}
      />
    );
  }

  const pageDocument = document ?? template.document;
  const storedDocument = (
    <StorefrontDocumentRenderer
      document={pageDocument}
      themeFiles={themeFiles}
    />
  );
  const storedRoute = renderStoredRoute({
    themeFiles,
    pathname: routePath ?? "/",
    document: pageDocument,
    storeName: context.storefront.name,
  });
  const storedLayout = renderStoredDocumentLayout({
    themeFiles,
    storeName: context.storefront.name,
    document: storedDocument,
  });

  // The editor sizes the iframe from this root's measured content. A
  // viewport-sized minimum here leaves a false trailing section visible after
  // a real section is deleted, so the root must remain content-sized.
  return (
    <div
      data-storefront-preview-root
      className="bg-stone-50 text-neutral-950"
      style={previewStyle}
    >
      {storedRoute ?? storedLayout ?? (
        <>
          {renderStoredLayoutSlot({
            themeFiles,
            type: "header",
            componentRef: "layout.header",
            props: { storeName: context.storefront.name },
          }) ?? <LegacyPreviewHeader storeName={context.storefront.name} />}
          {storedDocument}
          {renderStoredLayoutSlot({
            themeFiles,
            type: "footer",
            componentRef: "layout.footer",
            props: {
              storeName: context.storefront.name,
              copyrightText: `© ${new Date().getFullYear()} ${context.storefront.name}`,
            },
          }) ?? <LegacyPreviewFooter storeName={context.storefront.name} />}
        </>
      )}
    </div>
  );
});

function hasThemeSourceCode(
  themeFiles?: Array<{ path: string; content: string }>,
) {
  return Boolean(
    themeFiles?.some((file) => {
      const path = file.path.toLowerCase();
      if (path.startsWith("node_modules/")) return false;
      return [
        ".cjs",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".mts",
        ".ts",
        ".tsx",
      ].some((extension) => path.endsWith(extension));
    }),
  );
}

function usesThemeRouteRuntime(
  themeFiles?: Array<{ path: string; content: string }>,
): boolean {
  const manifest = themeFiles?.find((file) => file.path === "morph.theme.json");
  if (!manifest) return false;
  try {
    const parsed: unknown = JSON.parse(manifest.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return false;
    }
    const router = (parsed as Record<string, unknown>).router;
    return (
      Boolean(router) &&
      typeof router === "object" &&
      !Array.isArray(router) &&
      (router as Record<string, unknown>).framework === "tanstack-start"
    );
  } catch {
    return false;
  }
}

function renderStoredRoute({
  themeFiles,
  pathname,
  document,
  storeName,
}: {
  themeFiles?: Array<{ path: string; content: string }>;
  pathname: string;
  document: StorefrontPageDocument;
  storeName: string;
}): ReactNode | null {
  if (!themeFiles || !usesThemeRouteRuntime(themeFiles)) return null;
  const rendered = renderSafeThemeRoute({
    files: themeFiles,
    pathname,
    document,
    runtimeProps: {
      storeName,
      copyrightText: `© ${new Date().getFullYear()} ${storeName}`,
    },
  });
  return rendered.success ? (
    rendered.node
  ) : (
    <ThemeRouteDiagnostic diagnostic={rendered.diagnostics[0]} />
  );
}

function ThemeRouteDiagnostic({ diagnostic }: { diagnostic?: string }) {
  return (
    <main className="flex min-h-[70svh] items-center justify-center bg-amber-50 p-6 text-center text-amber-950">
      <div className="max-w-lg">
        <h1 className="font-serif text-2xl">Theme route preview unavailable</h1>
        <p className="mt-2 text-sm leading-6">
          {diagnostic ?? "The stored route could not be rendered safely."}
        </p>
      </div>
    </main>
  );
}

function renderStoredDocumentLayout({
  themeFiles,
  storeName,
  document,
}: {
  themeFiles?: Array<{ path: string; content: string }>;
  storeName: string;
  document: ReactNode;
}): ReactNode | null {
  const sourcePath = getThemeDocumentLayoutFilePath(themeFiles);
  if (!sourcePath || !themeFiles) return null;
  const rendered = renderSafeThemeComponent({
    files: themeFiles,
    sourcePath,
    props: {
      storeName,
      copyrightText: `© ${new Date().getFullYear()} ${storeName}`,
      children: document,
    },
  });
  return rendered.success ? (
    rendered.node
  ) : (
    <ThemeLayoutDiagnostic
      sourcePath={sourcePath}
      diagnostic={rendered.diagnostics[0]}
    />
  );
}

function renderStoredLayoutSlot({
  themeFiles,
  type,
  componentRef,
  props,
}: {
  themeFiles?: Array<{ path: string; content: string }>;
  type: "header" | "footer";
  componentRef: "layout.header" | "layout.footer";
  props: Record<string, unknown>;
}): ReactNode | null {
  const sourcePath = getComponentFilePath(type, themeFiles, componentRef);
  if (!sourcePath || !themeFiles) return null;
  const rendered = renderSafeThemeComponent({
    files: themeFiles,
    sourcePath,
    props,
  });
  return rendered.success ? (
    rendered.node
  ) : (
    <ThemeLayoutDiagnostic
      sourcePath={sourcePath}
      diagnostic={rendered.diagnostics[0]}
    />
  );
}

function ThemeLayoutDiagnostic({
  sourcePath,
  diagnostic,
}: {
  sourcePath: string;
  diagnostic?: string;
}) {
  return (
    <main className="flex min-h-[70svh] items-center justify-center bg-amber-50 p-6 text-center text-amber-950">
      <div className="max-w-lg">
        <h1 className="font-serif text-2xl">
          Theme layout preview unavailable
        </h1>
        <p className="mt-2 text-sm leading-6">
          {diagnostic ??
            `The stored layout in ${sourcePath} could not be rendered.`}
        </p>
      </div>
    </main>
  );
}

function LegacyPreviewHeader({ storeName }: { storeName: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8">
      <span className="font-serif text-lg font-semibold tracking-tight">
        {storeName}
      </span>
      <nav
        className="hidden items-center gap-7 text-xs text-neutral-600 sm:flex"
        aria-label="Storefront navigation"
      >
        <a href="/collections/all">Shop</a>
        <a href="/pages/about">About</a>
        <a href="/blogs/journal">Journal</a>
      </nav>
      <a href="/cart" className="text-xs text-neutral-600">
        Cart (0)
      </a>
    </header>
  );
}

function LegacyPreviewFooter({ storeName }: { storeName: string }) {
  return (
    <footer className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]">
      <div>
        <p className="font-serif text-3xl text-stone-100">{storeName}</p>
        <p className="mt-4 max-w-xs text-sm leading-6 text-stone-500">
          Objects with lasting character for thoughtful, everyday living.
        </p>
      </div>
      <div className="text-sm leading-8">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">
          Explore
        </p>
        <a className="block" href="/collections/all">
          Shop all
        </a>
        <a className="block" href="/pages/about">
          Our story
        </a>
        <a className="block" href="/blogs/journal">
          Journal
        </a>
      </div>
      <div className="text-sm leading-8">
        <p className="mb-2 text-xs uppercase tracking-[0.18em] text-stone-600">
          Help
        </p>
        <a className="block" href="/pages/contact">
          Contact
        </a>
        <a className="block" href="/pages/shipping">
          Shipping
        </a>
        <a className="block" href="/pages/returns">
          Returns
        </a>
      </div>
      <div className="border-t border-stone-800 pt-6 text-xs text-stone-600 sm:col-span-2 lg:col-span-3">
        © {new Date().getFullYear()} {storeName}
      </div>
    </footer>
  );
}

function PreviewMessage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-stone-50 p-6 text-center text-neutral-950">
      <div className="max-w-sm">
        <h1 className="font-serif text-2xl">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{description}</p>
      </div>
    </main>
  );
}
