import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { BreadcrumbCollapse } from "./breadcrumb-collapse";

vi.mock("@/components/router-link", () => ({
  RouterLink: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe("BreadcrumbCollapse", () => {
  it("renders only ancestor crumbs as links and marks the current page", () => {
    const { container } = render(
      <BreadcrumbCollapse
        breadcrumbs={[
          { label: "Products", href: "/dashboard/products" },
          { label: "Summer Shirt", href: "/dashboard/products/product-1" },
          {
            label: "Blue / Large",
            href: "/dashboard/products/product-1/variant/variant-1",
          },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Products" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Summer Shirt" })).toBeTruthy();
    const current = screen.getByText("Blue / Large");
    expect(current.closest("a")).toBeNull();
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("aria-disabled")).toBe("true");
    expect(
      container.querySelectorAll('[data-slot="breadcrumb-separator"]'),
    ).toHaveLength(2);
  });

  it("collapses deep trails behind an accessible control", () => {
    render(
      <BreadcrumbCollapse
        breadcrumbs={[
          { label: "Products", href: "/dashboard/products" },
          { label: "Parent", href: "/dashboard/products/parent" },
          { label: "Variants", href: "/dashboard/products/parent/variants" },
          { label: "Blue", href: "/dashboard/products/parent/variants/blue" },
        ]}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show hidden breadcrumb items" }),
    ).toBeTruthy();
    expect(screen.getByText("Blue").getAttribute("title")).toBe("Blue");
  });
});
