import { create } from "zustand";

export type PostProcessItem = {
    id: string;
    name: string;
    src: string;
    fileType: string;
    extension?: string;
    size?: number;
};

export type ImageAdjustments = {
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
    blur: number;
};

export type CropData = {
    x: number;
    y: number;
    width: number;
    height: number;
    unit: "px" | "%";
};

interface AssetPostProcessState {
    open: boolean;
    activeItem: PostProcessItem | null;

    // Image sources - for non-destructive editing
    baseImageSrc: string | null; // The base image (original or after background removal)

    // Editor state
    adjustments: ImageAdjustments;
    crop: CropData | null;
    isProcessing: boolean;

    // Actions
    setOpen: (open: boolean) => void;
    setActiveItem: (item: PostProcessItem | null) => void;
    setBaseImageSrc: (src: string) => void; // Update base image (e.g., after bg removal)
    setAdjustments: (adjustments: Partial<ImageAdjustments>) => void;
    setCrop: (crop: CropData | null) => void;
    setIsProcessing: (isProcessing: boolean) => void;
    resetAdjustments: () => void;
    reset: () => void;
}

const defaultAdjustments: ImageAdjustments = {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    hue: 0,
    blur: 0,
};

export const useAssetPostProcessStore = create<AssetPostProcessState>(set => ({
    open: false,
    activeItem: null,
    baseImageSrc: null,
    adjustments: defaultAdjustments,
    crop: null,
    isProcessing: false,

    setOpen: open => set({ open }),
    setActiveItem: item =>
        set({
            activeItem: item,
            open: !!item,
            baseImageSrc: item?.src || null, // Initialize with original image
            adjustments: defaultAdjustments,
            crop: null,
        }),
    setBaseImageSrc: src => set({ baseImageSrc: src }), // Update base image
    setAdjustments: newAdjustments =>
        set(state => ({
            adjustments: { ...state.adjustments, ...newAdjustments },
        })),
    setCrop: crop => set({ crop }),
    setIsProcessing: isProcessing => set({ isProcessing }),
    resetAdjustments: () => set({ adjustments: defaultAdjustments, crop: null }),
    reset: () =>
        set({
            open: false,
            activeItem: null,
            baseImageSrc: null,
            adjustments: defaultAdjustments,
            crop: null,
            isProcessing: false,
        }),
}));
