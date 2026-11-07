import { expect, type Browser } from "@playwright/test";
import { EDITOR_PATH } from "./helpers";
import { signedInPage } from "./native-acceptance";
import {
  removeThemeFiles,
  themeScopeFromEditorPath,
  type ThemeScope,
} from "./native-compat";

/**
 * The routes, markers and Theme files the navigation matrix (M1 §11.2 item 5)
 * writes, shared by its two specs: navigation-matrix.spec.ts (the preview
 * cells, on every transport) and navigation-matrix-public.spec.ts (the public
 * storefront cells, container transport only).
 */

export const scope: ThemeScope | null = EDITOR_PATH
  ? themeScopeFromEditorPath(EDITOR_PATH)
  : null;

export const HOME_ROUTE = "/e2e-nav-matrix-home";
export const DETAIL_ROUTE = "/e2e-nav-matrix-detail";

export const PUBLISHED_MARKER_TEXT = "Published Revision 1";
export const DRAFT_MARKER_TEXT = "Draft Revision 2";

export const NAV_FILES_PUBLISHED = [
  {
    path: "src/routes/e2e-nav-matrix-home.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${HOME_ROUTE}")({
  component: NavMatrixHome,
});

function NavMatrixHome() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-home-title" className="text-2xl font-bold mb-4">Nav Matrix Home</h1>
      <p data-e2e="nav-matrix-home-desc" className="mb-4">Home content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <Link to="${DETAIL_ROUTE}" data-e2e="nav-matrix-link-to-detail" className="text-blue-600 underline">
        Go to Detail
      </Link>
    </main>
  );
}
`,
  },
  {
    path: "src/routes/e2e-nav-matrix-detail.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${DETAIL_ROUTE}")({
  component: NavMatrixDetail,
});

function NavMatrixDetail() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-detail-title" className="text-2xl font-bold mb-4">Nav Matrix Detail</h1>
      <p data-e2e="nav-matrix-detail-desc" className="mb-4">Detail content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <Link to="${HOME_ROUTE}" data-e2e="nav-matrix-link-to-home" className="text-blue-600 underline">
        Back to Home
      </Link>
    </main>
  );
}
`,
  },
];

export const NAV_FILES_DRAFT = [
  {
    path: "src/routes/e2e-nav-matrix-home.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${HOME_ROUTE}")({
  component: NavMatrixHome,
});

function NavMatrixHome() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-home-title" className="text-2xl font-bold mb-4">Nav Matrix Home</h1>
      <p data-e2e="nav-matrix-home-desc" className="mb-4">Home content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <span data-e2e="nav-matrix-draft-marker" className="block text-amber-600 font-bold mb-4">
        ${DRAFT_MARKER_TEXT}
      </span>
      <Link to="${DETAIL_ROUTE}" data-e2e="nav-matrix-link-to-detail" className="text-blue-600 underline">
        Go to Detail
      </Link>
    </main>
  );
}
`,
  },
  {
    path: "src/routes/e2e-nav-matrix-detail.tsx",
    content: `import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("${DETAIL_ROUTE}")({
  component: NavMatrixDetail,
});

function NavMatrixDetail() {
  return (
    <main className="p-8 max-w-xl mx-auto text-center">
      <h1 data-e2e="nav-matrix-detail-title" className="text-2xl font-bold mb-4">Nav Matrix Detail</h1>
      <p data-e2e="nav-matrix-detail-desc" className="mb-4">Detail content for navigation matrix.</p>
      <span data-e2e="nav-matrix-published-marker" className="block text-green-600 font-semibold mb-4">
        ${PUBLISHED_MARKER_TEXT}
      </span>
      <span data-e2e="nav-matrix-draft-marker" className="block text-amber-600 font-bold mb-4">
        ${DRAFT_MARKER_TEXT}
      </span>
      <Link to="${HOME_ROUTE}" data-e2e="nav-matrix-link-to-home" className="text-blue-600 underline">
        Back to Home
      </Link>
    </main>
  );
}
`,
  },
];

/** Removes the route files either spec wrote; run from each spec's afterAll. */
export async function removeNavMatrixFiles(browser: Browser) {
  if (!scope) return;
  const page = await signedInPage(browser);
  try {
    await page.goto(EDITOR_PATH!, { waitUntil: "domcontentloaded" });
    const removed = await removeThemeFiles(
      page,
      scope,
      NAV_FILES_PUBLISHED.map((file) => file.path),
    );
    expect(removed.success, JSON.stringify(removed)).toBe(true);
  } finally {
    await page.context().close();
  }
}
