import React from "react";
import {
  CropperBackgroundWrapper,
  CropperBackgroundImage,
  CropperBackgroundImageProps,
} from "react-advanced-cropper";

// The wrapper and the image each declare their own `DesiredCropperRef` and
// neither is a superset of the other, so require both sets of methods.
type WrapperCropper = React.ComponentProps<
  typeof CropperBackgroundWrapper
>["cropper"];
type BackgroundCropper = NonNullable<WrapperCropper> &
  NonNullable<CropperBackgroundImageProps["cropper"]>;

export type AdjustableCropperBackgroundProps = Omit<
  CropperBackgroundImageProps,
  "cropper"
> & {
  cropper: BackgroundCropper;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  hue?: number;
  blur?: number;
};

export const AdjustableCropperBackground = React.forwardRef<
  HTMLImageElement,
  AdjustableCropperBackgroundProps
>(
  (
    {
      cropper,
      crossOrigin,
      style,
      brightness = 0,
      contrast = 0,
      saturation = 0,
      hue = 0,
      blur = 0,
      ...props
    },
    ref,
  ) => {
    const filter = [
      brightness ? `brightness(${100 + brightness * 100}%)` : "",
      contrast ? `contrast(${100 + contrast * 100}%)` : "",
      saturation ? `saturate(${100 + saturation * 100}%)` : "",
      hue ? `hue-rotate(${hue * 360}deg)` : "",
      blur ? `blur(${blur}px)` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <CropperBackgroundWrapper cropper={cropper} style={style}>
        <CropperBackgroundImage
          ref={ref}
          cropper={cropper}
          crossOrigin={crossOrigin}
          style={{ filter }}
          {...props}
        />
      </CropperBackgroundWrapper>
    );
  },
);

AdjustableCropperBackground.displayName = "AdjustableCropperBackground";
