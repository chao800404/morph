// src/components/ui/ObjectEffect.tsx

interface ObjectEffectProps {
    src: string; // 去背後的圖片 URL (Blob URL)
    alt?: string;
    hasOutline?: boolean; // 是否開啟白邊
    hasScan?: boolean; // 是否開啟掃描光效
}

export const ObjectEffect = ({ src, alt = "processed image", hasScan = true }: ObjectEffectProps) => {
    return (
        <div className="relative w-full h-full group">
            <img
                src={src}
                alt={alt}
                className="relative z-10 block w-full h-full object-contain drop-shadow-md drop-shadow-white"
            />
            {hasScan && (
                <div
                    className="absolute inset-0 z-20 pointer-events-none mix-blend-plus-lighter"
                    style={{
                        maskImage: `url(${src})`,
                        maskSize: "contain",
                        maskRepeat: "no-repeat",
                        maskPosition: "center",
                        WebkitMaskImage: `url(${src})`,
                        WebkitMaskSize: "contain",
                        WebkitMaskRepeat: "no-repeat",
                        WebkitMaskPosition: "center",
                    }}
                >
                    <div className="w-[50%] h-full bg-gradient-to-r from-transparent via-white/80 to-transparent absolute top-0 left-0 animate-shimmer-slide blur-sm"></div>
                </div>
            )}
        </div>
    );
};
