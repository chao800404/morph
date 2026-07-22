import { ASSETS_CARD_CONFIG } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.config";
import type { AssetsCardData } from "@/routes/_backend/dashboard/-views/global/contents/assets/config/assets-card.types";
import { AssetsDataProvider } from "./assets-data-provider";

interface AssetsCardProps {
  data: AssetsCardData;
  folderId: string | null;
  query?: string;
  uploadConfig: {
    maxFileSize: number;
    minFiles: number;
    maxFiles: number;
    allowedTypes: string[];
    allowedExtensions: string[];
  };
}

const AssetsCard = ({
  data,
  folderId,
  query,
  uploadConfig,
}: AssetsCardProps) => {
  return (
    <AssetsDataProvider data={data} folderId={folderId}>
      {ASSETS_CARD_CONFIG?.sections?.map((section) => {
        const SectionComponent = section.component;
        return (
          <SectionComponent
            key={section.slug}
            slug={section.slug}
            label={section.label}
            description={section.description}
            data={data}
            query={query}
            uploadConfig={uploadConfig}
          />
        );
      })}
    </AssetsDataProvider>
  );
};

export default AssetsCard;
