import { SessionsCard } from "@/app/(backend)/dashboard/_components/card/sessions-card/sessions-card";
import { ProfileCardComponentProps } from "../_config/profile-card.types";

export const ProfileSessionsCard = ({ slug, label, description }: ProfileCardComponentProps) => {
    return (
        <div id={slug}>
            <SessionsCard label={label} description={description} />
        </div>
    );
};
