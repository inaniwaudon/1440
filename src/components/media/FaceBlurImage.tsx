import clsx from "clsx";
import type { PhotoRecord } from "../../db/types";

type FaceDetectionPhoto = Pick<PhotoRecord, "hasDetectedFace" | "blurOverride">;

type Props = {
  src: string;
  alt: string;
  className: string;
  fallbackBlurClassName: string;
  enabled: boolean;
  photo: FaceDetectionPhoto;
  onNaturalSize?: (width: number, height: number) => void;
};

export const FaceBlurImage = ({
  src,
  alt,
  className,
  fallbackBlurClassName,
  enabled,
  photo,
  onNaturalSize,
}: Props) => {
  const shouldBlur = photo.blurOverride ?? photo.hasDetectedFace === true;
  return (
    <img
      src={src}
      alt={alt}
      className={clsx(
        className,
        enabled && shouldBlur && fallbackBlurClassName,
      )}
      onLoad={(event) => {
        const image = event.currentTarget;
        onNaturalSize?.(image.naturalWidth, image.naturalHeight);
      }}
    />
  );
};
