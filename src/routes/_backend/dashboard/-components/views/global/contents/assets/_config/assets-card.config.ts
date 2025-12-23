import { AssetsExplorerCard } from "../_component/assets-explorer-card";

import type { AssetsCardConfig } from "./assets-card.types";

export const ASSETS_CARD_CONFIG: AssetsCardConfig = {
    sections: [
        {
            slug: "assets-folders",
            label: "Assets & Folders",
            description: "Manage your digital assets and folders",
            component: AssetsExplorerCard,
        },
    ],
};
