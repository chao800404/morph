import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BarsArrowDownIcon } from "@/components/ui/icons/bars-arrow-down-icon";
import { useDataTableSort } from "../data-table-card/data-table-sort";
import { ASSET_SORT_OPTIONS } from "./asset-sort-options";

/**
 * Single-column sort menu for the Assets toolbar.
 *
 * Unlike the table headings, this control deliberately replaces any existing
 * multi-column criteria with one field and one direction.
 */
export const AssetTableSort = () => {
  const { sortBy, sortOrder, applySort } = useDataTableSort();

  const handleFieldChange = (value: string) => {
    const option = ASSET_SORT_OPTIONS.find(
      (candidate) => candidate.value === value,
    );
    if (option) applySort(option.value, sortOrder);
  };

  const handleDirectionChange = (value: string) => {
    if (value === "asc" || value === "desc") {
      applySort(sortBy, value);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="cardHeader"
          size="xs"
          aria-label="Sort assets"
        >
          <BarsArrowDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={sortBy}
          onValueChange={handleFieldChange}
        >
          {ASSET_SORT_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup
          value={sortOrder}
          onValueChange={handleDirectionChange}
        >
          <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
