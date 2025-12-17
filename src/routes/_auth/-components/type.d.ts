import type { FormAction } from "@/types/form";
import type { SafeActionFn } from "next-safe-action";

type FormState = {
    message?: string;
    success?: boolean;
};

interface FormProps extends React.ComponentProps<any> {
    action?: FormAction | SafeActionFn<any, any, any, any, any>;
    appName?: string;
}
