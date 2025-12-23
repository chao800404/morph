import { Button } from "@/components/ui/button";
import { useNavigate } from "@tanstack/react-router";
import { CardWrapper } from "../../../../card-wrapper";
import { ProfileCardComponentProps } from "../_config/profile-card.types";

export const ProfilePasswordCard = ({
  slug,
  label,
  description,
}: ProfileCardComponentProps) => {
  const navigate = useNavigate();
  return (
    <div id={slug}>
      <CardWrapper
        label={label}
        description={description}
        headerButton={
          <Button
            className="max-sm:w-full"
            variant="formDark"
            size="sm"
            onClick={() => navigate({ to: "/reset-password" })}
          >
            Reset
          </Button>
        }
        classNames={{ headerWrapper: "max-sm:flex-col max-sm:gap-4" }}
      />
    </div>
  );
};
