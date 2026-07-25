import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  collectionQueries,
  normalizeCollectionListParams,
} from "@queries/product.queries";
import { useQuery } from "@tanstack/react-query";
import type { Dispatch } from "react";
import type { DraftAction, ProductDraft } from "./use-product-draft";

const NO_COLLECTION = "__none__";

export const StepOrganize = ({
  draft,
  dispatch,
}: {
  draft: ProductDraft;
  dispatch: Dispatch<DraftAction>;
}) => {
  const { data: result, isPending } = useQuery(
    collectionQueries.list({
      ...normalizeCollectionListParams({}),
      limit: 100,
    }),
  );
  const collections = result?.success ? (result.data?.collections ?? []) : [];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-10">
      <h2 className="text-lg font-medium text-foreground">Organize</h2>

      <div className="space-y-2">
        <Label htmlFor="product-collection">
          Collection <span className="text-muted-foreground">(Optional)</span>
        </Label>
        {isPending ? (
          <Spinner />
        ) : (
          <Select
            value={draft.collectionId || NO_COLLECTION}
            onValueChange={(value) =>
              dispatch({
                type: "setField",
                field: "collectionId",
                value: value === NO_COLLECTION ? "" : value,
              })
            }
          >
            <SelectTrigger id="product-collection">
              <SelectValue placeholder="Select a collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_COLLECTION}>No collection</SelectItem>
              {collections.map((collection) => (
                <SelectItem key={collection.id} value={collection.id}>
                  {collection.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <p className="text-sm text-muted-foreground">
          Type, categories, tags, shipping profiles and sales channels are not
          part of the catalogue yet.
        </p>
      </div>
    </div>
  );
};
