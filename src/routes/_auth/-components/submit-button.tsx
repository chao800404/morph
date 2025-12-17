import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  canSubmit = true,
  name = "Submit",
  isLoading = false,
}: {
  canSubmit?: boolean;
  name?: string;
  isLoading?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      variant="form"
      disabled={pending || !canSubmit || isLoading}
      type="submit"
    >
      {pending || isLoading ? <Spinner variant="throbber" /> : name}
    </Button>
  );
}
