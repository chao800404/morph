import { CircleQuestionIcon } from "@/components/ui/icons/circle-question-icon";
import { Tooltip } from "react-tooltip";
import { CardWrapper } from "../card-wrapper";

/**
 * The Properties card with nothing selected.
 *
 * Split out because two places need it: the real card when there is no active
 * item, and the assets route's pending view. The pending view is imported
 * eagerly by the collection config, so it must not reach a server function —
 * which rules out reusing `AssetPropertyCard`, whose header imports the delete
 * and move server functions.
 */
export const AssetPropertyEmptyCard = () => (
  <CardWrapper id="card-property" label="Properties">
    <div className="text-sm text-muted-foreground px-6 py-4 flex items-center gap-2">
      <div
        data-tooltip-id="property-tooltip"
        data-tooltip-content="Select an item to view properties."
        className="flex items-center gap-2"
      >
        <CircleQuestionIcon className="size-4" />
      </div>
      <Tooltip
        style={{
          maxWidth: "120px",
          backgroundColor: "var(--primary)",
          color: "var(--background)",
          fontSize: "12px",
          boxShadow: "1px 1px 4px 0px rgba(0, 0, 0, 0.1)",
          borderRadius: "5px",
          padding: "4px 8px",
        }}
        id="property-tooltip"
        place="top"
        role="tooltip"
      />
      <p> No item selected</p>
    </div>
  </CardWrapper>
);
