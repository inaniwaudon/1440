import { useEffect, useRef, useState } from "react";
import { getFaceDetector } from "../../features/privacy/faceDetector";

type Props = {
  src: string;
  alt: string;
  className: string;
  fallbackBlurClassName: string;
  blurPx: number;
  enabled: boolean;
};

const FACE_PADDING = 0.35;

export function FaceBlurImage({
  src,
  alt,
  className,
  fallbackBlurClassName,
  blurPx,
  enabled,
}: Props) {
  if (!enabled) return <img src={src} alt={alt} className={className} />;

  return (
    <DetectedFaceBlurImage
      key={src}
      src={src}
      alt={alt}
      className={className}
      fallbackBlurClassName={fallbackBlurClassName}
      blurPx={blurPx}
    />
  );
}

function DetectedFaceBlurImage({
  src,
  alt,
  className,
  fallbackBlurClassName,
  blurPx,
}: Omit<Props, "enabled">) {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: "160px" },
    );
    observer.observe(image);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !loaded) return;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || image.naturalWidth === 0) return;

    let cancelled = false;
    getFaceDetector()
      .then((detector) => {
        if (cancelled) return;
        const { detections } = detector.detect(image);
        if (cancelled) return;

        const width = image.naturalWidth;
        const height = image.naturalHeight;
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(image, 0, 0, width, height);

        if (detections.length > 0) {
          const blurred = document.createElement("canvas");
          blurred.width = width;
          blurred.height = height;
          const blurredContext = blurred.getContext("2d");
          if (!blurredContext) return;
          const renderedWidth = Math.max(
            image.getBoundingClientRect().width,
            1,
          );
          blurredContext.filter = `blur(${Math.min(64, blurPx * (width / renderedWidth))}px)`;
          blurredContext.drawImage(image, 0, 0, width, height);

          for (const detection of detections) {
            const box = detection.boundingBox;
            if (!box) continue;
            const paddingX = box.width * FACE_PADDING;
            const paddingY = box.height * FACE_PADDING;
            const x = Math.max(0, box.originX - paddingX);
            const y = Math.max(0, box.originY - paddingY);
            const boxWidth = Math.min(width - x, box.width + paddingX * 2);
            const boxHeight = Math.min(height - y, box.height + paddingY * 2);
            const radius = Math.min(boxWidth, boxHeight) * 0.22;

            context.save();
            context.beginPath();
            context.roundRect(x, y, boxWidth, boxHeight, radius);
            context.clip();
            context.drawImage(blurred, 0, 0);
            context.restore();
          }
        }

        setReady(true);
      })
      .catch(() => {
        // Keep the full-image blur as the privacy-safe fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [blurPx, loaded, visible]);

  return (
    <>
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className={`${className} ${!ready ? fallbackBlurClassName : ""}`}
        style={ready ? { visibility: "hidden" } : undefined}
        onLoad={() => setLoaded(true)}
      />
      <canvas
        ref={canvasRef}
        className={className}
        style={ready ? undefined : { visibility: "hidden" }}
      />
    </>
  );
}
