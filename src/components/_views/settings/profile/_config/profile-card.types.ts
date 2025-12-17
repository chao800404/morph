import type { SessionData } from "@/types/auth";

export interface ProfileCardComponentProps {
    slug: string;
    label: string;
    description?: string;
    session: SessionData;
}
