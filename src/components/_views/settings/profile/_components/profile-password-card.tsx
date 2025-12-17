import { RedirectCard } from "@/app/(backend)/dashboard/_components/card/redirect-card/redirect-card";
import { ProfileCardComponentProps } from "../_config/profile-card.types";

export const ProfilePasswordCard = ({ slug, label, description }: ProfileCardComponentProps) => {
    return (
        <div id={slug}>
            <RedirectCard title={label} description={description} href="/auth/reset-password" buttonText="Reset" />
        </div>
    );
};
