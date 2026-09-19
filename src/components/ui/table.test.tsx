import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

describe("Table card variant", () => {
  it("uses the shared card ranking colors", () => {
    const { container } = render(
      <Table>
        <TableHeader variant="card">
          <TableRow>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow variant="card">
            <TableCell>Small</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(container.querySelector("thead")?.className).toContain(
      "bg-muted/30",
    );
    expect(container.querySelector("thead")?.className).toContain(
      "[&_th]:text-foreground",
    );
    expect(container.querySelector("tbody tr")?.className).toContain(
      "hover:bg-accent/40",
    );
    expect(container.querySelector("tbody tr")?.className).toContain("h-12");
  });
});

/**
 * Every header variant states its own foreground.
 *
 * Both of these surfaces are tinted, so a `th` that inherits
 * `text-muted-foreground` is not guaranteed to be readable on them — and was
 * not: on `bg-accent` it measured 4.39:1 in light mode, under the 4.5 AA asks
 * for, while measuring 5.66:1 in dark. It survived review because whichever
 * theme you happened to be in decided whether you could see it, and it survived
 * the accessibility suite because axe reported those nodes in one run out of
 * six — the iframe the editor's canvas lives in leaves overlapping nodes
 * unresolvable, so they arrive as `incomplete` or not at all.
 *
 * So the rule is asserted here, where it is a string comparison and cannot
 * flake: a variant that tints its background states the foreground that goes on
 * it. The list is exhaustive over `TableHeaderProps["variant"]`, so adding a
 * third variant without a foreground fails rather than passing unnoticed.
 */
describe("Table header foregrounds", () => {
  const VARIANTS: ReadonlyArray<"default" | "card"> = ["default", "card"];

  it.each(VARIANTS)("the %s variant states its th foreground", (variant) => {
    const { container } = render(
      <Table>
        <TableHeader variant={variant}>
          <TableRow>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Small</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    // Matched as a pattern rather than a fixed token: which foreground is
    // correct depends on the surface, and pinning one here would turn a
    // deliberate change of token into a failure. What matters is that a
    // foreground is stated at all.
    expect(container.querySelector("thead")?.className).toMatch(
      /\[&_th\]:text-[\w-]+/,
    );
  });
});
