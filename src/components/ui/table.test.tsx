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
