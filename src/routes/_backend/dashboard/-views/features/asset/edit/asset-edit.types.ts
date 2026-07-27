export type AssetEditItem =
  | {
      id: string;
      type: "folder";
      name: string;
      description?: string;
      locationId: string | null;
    }
  | {
      id: string;
      type: "asset";
      name: string;
      fileType: string;
      extension?: string;
      src?: string;
      alt?: string;
      caption?: string;
      tags?: string;
      size?: number;
      locationId: string | null;
    };
