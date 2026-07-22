import { Button } from "@/components/ui/button";
import { CardWrapper } from "@/routes/_backend/dashboard/-components/card-wrapper";
import { useNavigate } from "@tanstack/react-router";
import { ProfileCardComponentProps } from "../config/profile-card.types";

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
            size="xs"
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
