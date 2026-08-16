import type { StorefrontThemeEditorDTO } from "@/lib/storefront/dto/storefront-theme.dto";
import type { StorefrontPageDocument } from "@/db/storefront.schema";
import type { CSSProperties } from "react";
import { StorefrontDocumentRenderer } from "./storefront-document-renderer";

type StorefrontPreviewProps = {
  context: StorefrontThemeEditorDTO;
  templateId: string;
  viewportHeight: number;
  document?: StorefrontPageDocument;
  themeFiles?: Array<{ path: string; content: string }>;
};

type StorefrontPreviewStyle = CSSProperties & {
  "--storefront-preview-viewport-height": string;
};

export function StorefrontPreview({
  context,
  templateId,
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
  };

  return (
    <div
      data-storefront-preview-root
      className="min-h-[var(--storefront-preview-viewport-height,100svh)] bg-stone-50 text-neutral-950"
      style={previewStyle}
    >
      <header className="flex h-16 items-center justify-between border-b border-neutral-200 bg-stone-50 px-5 sm:px-8">
        <span className="font-serif text-lg font-semibold tracking-tight">
          {context.storefront.name}
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
      <StorefrontDocumentRenderer
        document={document ?? template.document}
        themeFiles={themeFiles}
      />
      <footer className="grid gap-12 bg-stone-950 px-[clamp(1.75rem,6vw,6rem)] py-16 text-stone-300 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.75fr_0.75fr]">
        <div>
          <p className="font-serif text-3xl text-stone-100">
            {context.storefront.name}
          </p>
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
          © {new Date().getFullYear()} {context.storefront.name}
        </div>
      </footer>
    </div>
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
