import { ActionState } from "@/components/dialog/dialog-create-wrapper";
import { getSession } from "@/server/auth/getSession";

export type ProfileCardComponentProps = {
  slug: string;
  label: string;
  description: string;
  session: Awaited<ReturnType<typeof getSession>>;
};

export interface EditCardState extends ActionState {
  data?: any;
  serverError?: string;
  validationErrors?: Record<string, any> | null;
}
