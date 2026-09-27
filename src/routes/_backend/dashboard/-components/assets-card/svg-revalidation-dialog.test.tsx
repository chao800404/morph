import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  restoreLibrarySvgsServerFn,
  scanLibrarySvgsServerFn,
} from "@/server/asset/svg-revalidation.serverFn";
import { SvgRevalidationDialog } from "./svg-revalidation-dialog";

vi.mock("@/server/asset/svg-revalidation.serverFn", () => ({
  scanLibrarySvgsServerFn: vi.fn(),
  restoreLibrarySvgsServerFn: vi.fn(),
}));

const entry = (
  assetId: string,
  status: "passes" | "current" | "refused" | "missing",
  extra: Record<string, unknown> = {},
) => ({
  assetId,
  name: `${assetId}.svg`,
  etag: status === "missing" ? null : `etag-${assetId}`,
  status,
  recorded: "legacy",
  ...extra,
});

function renderDialog() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <SvgRevalidationDialog open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

async function scanned() {
  fireEvent.click(screen.getByRole("button", { name: "Start check" }));
  await waitFor(() =>
    expect(document.querySelector("[data-svg-scan-summary]")).not.toBeNull(),
  );
}

describe("SvgRevalidationDialog", () => {
  beforeEach(() => {
    vi.mocked(scanLibrarySvgsServerFn).mockReset();
    vi.mocked(restoreLibrarySvgsServerFn).mockReset();
    vi.mocked(scanLibrarySvgsServerFn)
      .mockResolvedValueOnce({
        success: true,
        data: {
          entries: [
            entry("a", "passes"),
            entry("b", "refused", {
              reason: "doctype",
              detail: "<!DOCTYPE svg …>",
              line: 1,
            }),
          ],
          next: "b",
        },
      } as never)
      .mockResolvedValueOnce({
        success: true,
        data: {
          entries: [
            entry("c", "passes"),
            entry("d", "current"),
            entry("e", "missing"),
          ],
          next: null,
        },
      } as never);
  });

  it("reports every page of the read-only check, with why a file is refused", async () => {
    renderDialog();
    await scanned();

    expect(scanLibrarySvgsServerFn).toHaveBeenCalledTimes(2);
    expect(vi.mocked(scanLibrarySvgsServerFn).mock.calls[1]![0]).toEqual({
      data: { after: "b" },
    });
    expect(
      document.querySelector("[data-svg-scan-summary]")?.textContent,
    ).toMatch(/2Pass1Already current1Refused1File missing/);
    expect(
      document.querySelector('[data-svg-refused="b"]')?.textContent,
    ).toContain("doctype (line 1)");
    expect(restoreLibrarySvgsServerFn).not.toHaveBeenCalled();
  });

  it("says the change is immediate and needs an acknowledgement before it is asked for", async () => {
    renderDialog();
    await scanned();

    expect(
      document.querySelector("[data-svg-restore-notice]")?.textContent,
    ).toContain("without a Theme publish");
    const restore = screen.getByRole("button", {
      name: "Restore 2 files",
    }) as HTMLButtonElement;
    expect(restore.disabled).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I understand these files change how they are served now",
      }),
    );
    expect(restore.disabled).toBe(false);
  });

  it("names only the files that passed, by id and ETag, and shows what happened to each", async () => {
    vi.mocked(restoreLibrarySvgsServerFn).mockResolvedValueOnce({
      success: true,
      data: [
        { assetId: "a", status: "restored" },
        { assetId: "c", status: "write-failed", detail: "R2 unavailable" },
      ],
    } as never);
    renderDialog();
    await scanned();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Restore 2 files" }));

    await waitFor(() =>
      expect(
        document.querySelector("[data-svg-restore-results]"),
      ).not.toBeNull(),
    );
    expect(vi.mocked(restoreLibrarySvgsServerFn).mock.calls[0]![0]).toEqual({
      data: {
        items: [
          { assetId: "a", etag: "etag-a" },
          { assetId: "c", etag: "etag-c" },
        ],
      },
    });
    expect(
      document.querySelector('[data-svg-restore-outcome="write-failed"]')
        ?.textContent,
    ).toContain("R2 unavailable");

    // Only the failed write is tried again, with the ETag its check saw.
    vi.mocked(restoreLibrarySvgsServerFn).mockResolvedValueOnce({
      success: true,
      data: [{ assetId: "c", status: "restored" }],
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Retry 1 failed" }));
    await waitFor(() =>
      expect(restoreLibrarySvgsServerFn).toHaveBeenCalledTimes(2),
    );
    expect(vi.mocked(restoreLibrarySvgsServerFn).mock.calls[1]![0]).toEqual({
      data: { items: [{ assetId: "c", etag: "etag-c" }] },
    });
  });

  it("never counts a batch the server did not answer as restored", async () => {
    vi.mocked(restoreLibrarySvgsServerFn).mockResolvedValueOnce({
      success: false,
      message: "Administrator access is required",
    } as never);
    renderDialog();
    await scanned();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Restore 2 files" }));

    await waitFor(() =>
      expect(
        document.querySelectorAll('[data-svg-restore-outcome="write-failed"]'),
      ).toHaveLength(2),
    );
    expect(
      document.querySelector('[data-svg-restore-outcome="restored"]'),
    ).toBeNull();
  });
});
