import { FolderBlock, FolderPropertyBlock } from "./folder-block";
import { ImageBlock, ImagePreviewBlock, ImagePropertyBlock, ImageSmBlock, ImageUploadBlock } from "./image-block";
import { VideoBlock, VideoPreviewBlock, VideoPropertyBlock, VideoSmBlock, VideoUploadBlock } from "./video-block";

type BaseProps = {
    variant?: "default" | "property" | "sm" | "preview" | "upload";
    name?: string;
    onRemove?: () => void;
    onMaximize?: () => void;
    className?: string;
};

type AssetBlockProps = BaseProps &
    (
        | {
              type: "folder";
          }
        | {
              type: "asset";
              fileType: "image";
              extension?: string;
              src: string;
              alt: string;
              duration?: never;
          }
        | {
              type: "asset";
              fileType: "video";
              extension?: string;
              src?: string;
              alt?: string;
              duration?: number;
          }
        | {
              type: "asset";
              fileType: string; // Catch-all for other file types
              extension?: string;
              src?: string;
              alt?: string;
              duration?: number;
          }
    );

/**
 * AssetBlockMap - 根據資產類型和變體渲染對應的組件
 *
 * @param props - 資產屬性，包含類型、變體和其他相關資訊
 * @returns 對應的資產區塊組件
 */
export const AssetBlockMap = (props: AssetBlockProps) => {
    const variant = props.variant || "default";

    // 處理資料夾類型
    if (props.type === "folder") {
        return variant === "property" ? (
            <FolderPropertyBlock className={props.className} />
        ) : (
            <FolderBlock className={props.className} category="folder" name={props.name} onRemove={props.onRemove} />
        );
    }

    // 處理資產類型
    if (props.type === "asset") {
        const commonProps = {
            name: props.name,
            onRemove: props.onRemove,
            category: props.extension || props.fileType,
        };

        // 圖片資產
        if (props.fileType === "image") {
            const src = props.src || "";
            const alt = props.alt || "";

            switch (variant) {
                case "property":
                    return (
                        <ImagePropertyBlock
                            className={props.className}
                            src={src}
                            alt={alt}
                            onMaximize={props.onMaximize}
                        />
                    );
                case "sm":
                    return <ImageSmBlock className={props.className} src={src} alt={alt} />;
                case "preview":
                    return <ImagePreviewBlock className={props.className} src={src} alt={alt} />;
                case "upload":
                    return <ImageUploadBlock className={props.className} src={src} alt={alt} {...commonProps} />;
                default:
                    return (
                        <ImageBlock
                            {...commonProps}
                            className="first:col-span-1 first:row-span-1"
                            src={src}
                            alt={alt}
                        />
                    );
            }
        }

        // 影片資產
        if (props.fileType === "video") {
            const src = props.src || "";
            const alt = props.alt || props.name || "";

            switch (variant) {
                case "property":
                    return (
                        <VideoPropertyBlock
                            extension={props.extension}
                            src={src}
                            duration={props.duration}
                            onMaximize={props.onMaximize}
                        />
                    );
                case "sm":
                    return <VideoSmBlock className={props.className} extension={props.extension} />;
                case "preview":
                    return <VideoPreviewBlock className={props.className} src={src} alt={alt} />;
                case "upload":
                    return <VideoUploadBlock className={props.className} src={src} alt={alt} {...commonProps} />;
                default:
                    return (
                        <VideoBlock
                            {...commonProps}
                            className="first:col-span-1 first:row-span-1"
                            src={src}
                            alt={alt}
                        />
                    );
            }
        }

        // 其他不支援的檔案類型
        return null;
    }

    return null;
};
