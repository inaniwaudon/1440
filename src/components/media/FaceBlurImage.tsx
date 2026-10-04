import { useEffect, useRef, useState } from "react";
import { getFaceDetector } from "../../features/privacy/faceDetector";

type Props = {
  src: string;
  alt: string;
  className: string;
  fallbackBlurClassName: string;
  enabled: boolean;
};

export function FaceBlurImage({
  src,
  alt,
  className,
  fallbackBlurClassName,
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
    />
  );
}

function DetectedFaceBlurImage({
  src,
  alt,
  className,
  fallbackBlurClassName,
}: Omit<Props, "enabled">) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(false);
  const [hasFace, setHasFace] = useState<boolean | null>(null);
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
    if (!image || image.naturalWidth === 0) return;

    let cancelled = false;
    getFaceDetector()
      .then((detector) => {
        if (cancelled) return;
        const { detections } = detector.detect(image);
        if (cancelled) return;
        setHasFace(detections.length > 0);
      })
      .catch(() => {
        // Keep the full-image blur as the privacy-safe fallback.
      });

    return () => {
      cancelled = true;
    };
  }, [loaded, visible]);

  return (
    <img
      ref={imageRef}
      src={src}
      alt={alt}
      className={`${className} ${hasFace !== false ? fallbackBlurClassName : ""}`}
      onLoad={() => setLoaded(true)}
    />
  );
}
