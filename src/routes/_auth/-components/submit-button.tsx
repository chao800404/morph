import { Spinner } from "@/components/kibo-ui/spinner";
import { Button } from "@/components/ui/button";
import { useFormStatus } from "react-dom";

export function SubmitButton({
  canSubmit = true,
  name = "Submit",
  isLoading = false,
  type = "submit",
  ...props
}: React.ComponentProps<typeof Button> & {
  canSubmit?: boolean;
  name?: string;
  isLoading?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      {...props}
      variant="form"
      disabled={pending || !canSubmit || isLoading}
      type={type}
    >
      {pending || isLoading ? <Spinner variant="throbber" /> : name}
    </Button>
  );
}
