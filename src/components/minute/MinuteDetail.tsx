import { useLiveQuery } from "dexie-react-hooks";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { MdBlurOn, MdDeleteOutline } from "react-icons/md";
import { db } from "../../db/db";
import type { PhotoRecord } from "../../db/types";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import { formatCapturedDate, formatMinuteOfDay } from "../../utils/time";
import { FaceBlurImage } from "../media/FaceBlurImage";
import styles from "./MinuteDetail.module.css";

type Props = {
  minuteOfDay: number | null;
  onClose: () => void;
  onNavigate: (minuteOfDay: number) => void;
  blurImages: boolean;
};

const SWIPE_MIN_DISTANCE = 48;
const SWIPE_DIRECTION_RATIO = 1.2;
const SLIDE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const RETURN_EASING = "cubic-bezier(0.34, 1.3, 0.64, 1)";
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;

function extensionFor(mimeType: string | undefined): string {
  if (!mimeType) return "jpg";
  const subtype = mimeType.split("/")[1]?.split(";")[0];
  if (!subtype) return "jpg";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "quicktime") return "mov";
  return subtype;
}

async function sharePhoto(photo: PhotoRecord) {
  const isVideo = photo.mimeType?.startsWith("video/") && !!photo.videoBlob;
  const blob = isVideo
    ? // biome-ignore lint/style/noNonNullAssertion: isVideo guards videoBlob
      photo.videoBlob!
    : (photo.previewBlob ?? photo.thumbnailBlob);
  const mime = blob.type || photo.mimeType || "image/jpeg";
  const ext = extensionFor(mime);
  const base =
    photo.originalFileName?.replace(/\.[^.]+$/, "") ||
    `photo-${photo.minuteOfDay}`;
  const fileName = `${base}.${ext}`;
  const file = new File([blob], fileName, { type: mime });

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PhotoPreview({
  photo,
  active,
  blurImages,
}: {
  photo: PhotoRecord;
  active: boolean;
  blurImages: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = photo.mimeType?.startsWith("video/") && !!photo.videoBlob;
  const shouldBlur = photo.blurOverride ?? photo.hasDetectedFace === true;
  const mediaBlob = isVideo
    ? // biome-ignore lint/style/noNonNullAssertion: isVideo guards videoBlob
      photo.videoBlob!
    : (photo.previewBlob ?? photo.thumbnailBlob);
  const mediaBlobRef = useRef(mediaBlob);
  mediaBlobRef.current = mediaBlob;
  const mediaKey = `${photo.id}:${isVideo ? "video" : "image"}`;

  useEffect(() => {
    // Metadata updates can rematerialize the same IndexedDB Blob as a new
    // object. Keep its URL stable unless the actual media identity changes.
    if (!mediaKey) return;
    const u = URL.createObjectURL(mediaBlobRef.current);
    setUrl(u);
    setAspectRatio(null);
    return () => URL.revokeObjectURL(u);
  }, [mediaKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isVideo || !video) return;
    if (active) {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [active, isVideo]);

  if (!url) return null;
  const capturedDate = formatCapturedDate(photo.capturedAt);
  const frameStyle = aspectRatio
    ? ({
        aspectRatio: String(aspectRatio),
        "--ar": String(aspectRatio),
      } as CSSProperties)
    : undefined;

  return (
    <div className={styles.mediaFrame} style={frameStyle}>
      {isVideo ? (
        <video
          ref={videoRef}
          src={url}
          autoPlay={active}
          loop
          muted
          playsInline
          preload="auto"
          className={`${styles.previewImg} ${blurImages && shouldBlur ? styles.blurred : ""}`}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) {
              setAspectRatio(v.videoWidth / v.videoHeight);
            }
          }}
        />
      ) : (
        <FaceBlurImage
          src={url}
          alt="Saved"
          className={styles.previewImg}
          fallbackBlurClassName={styles.blurred}
          enabled={blurImages}
          photo={photo}
          onNaturalSize={(w, h) => {
            if (w && h) setAspectRatio(w / h);
          }}
        />
      )}
      {capturedDate && (
        <time
          className={styles.capturedDate}
          dateTime={photo.capturedAt ?? undefined}
        >
          {capturedDate}
        </time>
      )}
    </div>
  );
}

export function MinuteDetail({
  minuteOfDay,
  onClose,
  onNavigate,
  blurImages,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    currentX: number;
    isHorizontal: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const pendingNavigateRef = useRef<number | null>(null);
  const pressStartRef = useRef<{ time: number; moved: boolean } | null>(null);

  const occupiedMinutes = useLiveQuery<number[], number[]>(
    async () => {
      const slots = await db.slots.orderBy("minuteOfDay").toArray();
      return slots.map((entry) => entry.minuteOfDay);
    },
    [],
    [],
  );

  const activeMinute = minuteOfDay ?? -1;
  const currentIndex = occupiedMinutes.indexOf(activeMinute);
  const windowMinutes =
    currentIndex >= 0
      ? occupiedMinutes.slice(Math.max(0, currentIndex - 2), currentIndex + 3)
      : [];
  const windowKey = windowMinutes.join(",");
  const photos = useLiveQuery<PhotoRecord[], PhotoRecord[]>(
    async () => {
      const records = await Promise.all(
        windowMinutes.map(async (minute) => {
          const entry = await db.slots.get(minute);
          return entry ? db.photos.get(entry.photoId) : undefined;
        }),
      );
      return records.filter(
        (record): record is PhotoRecord => record !== undefined,
      );
    },
    [windowKey],
    [],
  );
  const previousMinute =
    currentIndex > 0 ? occupiedMinutes[currentIndex - 1] : undefined;
  const nextMinute =
    currentIndex >= 0 && currentIndex < occupiedMinutes.length - 1
      ? occupiedMinutes[currentIndex + 1]
      : undefined;
  const previousPhoto = photos.find(
    (entry) => entry.minuteOfDay === previousMinute,
  );
  const photo = photos.find((entry) => entry.minuteOfDay === activeMinute);
  const nextPhoto = photos.find((entry) => entry.minuteOfDay === nextMinute);
  const hasPhoto = photo !== undefined;

  const isOpen = minuteOfDay !== null;
  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const overlay = overlayRef.current;
    const blockWheel = (event: WheelEvent) => event.preventDefault();
    overlay?.addEventListener("wheel", blockWheel, { passive: false });
    return () => {
      overlay?.removeEventListener("wheel", blockWheel);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && previousMinute !== undefined) {
        event.preventDefault();
        onNavigate(previousMinute);
      } else if (event.key === "ArrowRight" && nextMinute !== undefined) {
        event.preventDefault();
        onNavigate(nextMinute);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, previousMinute, nextMinute, onClose, onNavigate]);

  if (minuteOfDay === null) return null;

  const handleClose = () => {
    onClose();
  };

  const handleDeletePhoto = async () => {
    if (!window.confirm("この写真を削除しますか？")) {
      return;
    }

    await db.transaction("rw", db.photos, db.slots, async () => {
      if (photo) {
        await db.photos.delete(photo.id);
      }
      if (photo) {
        await db.slots.delete(minuteOfDay);
      }
    });
    onClose();
  };

  const handleBlurToggle = async () => {
    if (!photo) return;
    const currentlyBlurred =
      photo.blurOverride ?? photo.hasDetectedFace === true;
    await db.photos.update(photo.id, { blurOverride: !currentlyBlurred });
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: overlay click dismisses modal
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled elsewhere
    <div
      className={styles.overlay}
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div className={styles.sheet}>
        <div className={styles.content}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: swipe gestures only */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: delete button provides keyboard access */}
          <div
            className={styles.previewWrap}
            style={{ viewTransitionName: `minute-photo-${minuteOfDay}` }}
            onPointerDown={(event) => {
              if (!event.isPrimary) return;
              const pending = pendingNavigateRef.current;
              if (pending !== null) {
                pendingNavigateRef.current = null;
                flushSync(() => onNavigate(pending));
              }
              trackRef.current?.getAnimations().forEach((animation) => {
                animation.cancel();
              });
              if (trackRef.current) trackRef.current.style.transform = "";
              swipeRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                currentX: event.clientX,
                isHorizontal: false,
              };
              pressStartRef.current = { time: Date.now(), moved: false };
            }}
            onPointerMove={(event) => {
              const swipe = swipeRef.current;
              if (!swipe || swipe.pointerId !== event.pointerId) return;

              swipe.currentX = event.clientX;
              const deltaX = event.clientX - swipe.startX;
              const deltaY = event.clientY - swipe.startY;
              if (
                pressStartRef.current &&
                !pressStartRef.current.moved &&
                Math.hypot(deltaX, deltaY) > LONG_PRESS_MOVE_TOLERANCE
              ) {
                pressStartRef.current.moved = true;
              }
              if (!swipe.isHorizontal) {
                if (Math.abs(deltaX) < 8) return;
                if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
                swipe.isHorizontal = true;
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // ignore
                }
              }

              const canNavigate =
                deltaX < 0
                  ? nextMinute !== undefined
                  : previousMinute !== undefined;
              const displayedDelta = canNavigate ? deltaX : deltaX * 0.22;
              if (trackRef.current) {
                trackRef.current.style.transform = `translate3d(calc(-100% + ${displayedDelta}px), 0, 0)`;
              }
              suppressClickUntilRef.current = Date.now() + 350;
            }}
            onPointerUp={(event) => {
              const press = pressStartRef.current;
              pressStartRef.current = null;
              const swipe = swipeRef.current;
              swipeRef.current = null;
              if (
                press &&
                !press.moved &&
                Date.now() - press.time >= LONG_PRESS_MS &&
                photo
              ) {
                suppressClickUntilRef.current = Date.now() + 500;
                void sharePhoto(photo);
                return;
              }
              if (!swipe || swipe.pointerId !== event.pointerId) return;

              const deltaX = swipe.currentX - swipe.startX;
              const deltaY = event.clientY - swipe.startY;
              const preview = event.currentTarget;
              const track = trackRef.current;
              if (!track) return;
              const threshold = Math.max(
                SWIPE_MIN_DISTANCE,
                preview.clientWidth * 0.12,
              );
              const destination = deltaX < 0 ? nextMinute : previousMinute;
              const shouldReturn =
                !swipe.isHorizontal ||
                Math.abs(deltaX) < threshold ||
                Math.abs(deltaX) < Math.abs(deltaY) * SWIPE_DIRECTION_RATIO;

              if (shouldReturn || destination === undefined) {
                const animation = track.animate(
                  [
                    {
                      transform:
                        track.style.transform || "translate3d(-100%, 0, 0)",
                    },
                    { transform: "translate3d(-100%, 0, 0)" },
                  ],
                  { duration: 280, easing: RETURN_EASING },
                );
                track.style.transform = "";
                animation.finished.catch(() => undefined);
                return;
              }

              suppressClickUntilRef.current = Date.now() + 350;
              const direction = deltaX < 0 ? -1 : 1;
              const reducedMotion = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              if (reducedMotion) {
                track.style.transform = "";
                onNavigate(destination);
                return;
              }

              const exitAnimation = track.animate(
                [
                  {
                    transform:
                      track.style.transform ||
                      `translate3d(calc(-100% + ${deltaX}px), 0, 0)`,
                  },
                  {
                    transform:
                      direction < 0
                        ? "translate3d(-200%, 0, 0)"
                        : "translate3d(0, 0, 0)",
                  },
                ],
                { duration: 260, easing: SLIDE_EASING },
              );
              track.style.transform = "";
              pendingNavigateRef.current = destination;
              const commit = () => {
                if (pendingNavigateRef.current !== destination) return;
                pendingNavigateRef.current = null;
                flushSync(() => onNavigate(destination));
                track.style.transform = "";
              };
              exitAnimation.addEventListener("finish", commit);
              exitAnimation.addEventListener("cancel", commit);
            }}
            onPointerCancel={() => {
              pressStartRef.current = null;
              swipeRef.current = null;
              trackRef.current?.style.removeProperty("transform");
            }}
            onDragStart={(event) => event.preventDefault()}
            onClick={(e) => {
              if (Date.now() < suppressClickUntilRef.current) return;
              const image = trackRef.current?.children[1]?.querySelector("img");
              if (!image) {
                handleClose();
                return;
              }

              const frame = image.getBoundingClientRect();
              const imageRatio = image.naturalWidth / image.naturalHeight;
              const frameRatio = frame.width / frame.height;
              const width =
                imageRatio > frameRatio
                  ? frame.width
                  : frame.height * imageRatio;
              const height =
                imageRatio > frameRatio
                  ? frame.width / imageRatio
                  : frame.height;
              const left = frame.left + (frame.width - width) / 2;
              const top = frame.top + (frame.height - height) / 2;
              const isOnImage =
                e.clientX >= left &&
                e.clientX <= left + width &&
                e.clientY >= top &&
                e.clientY <= top + height;
              if (!isOnImage) handleClose();
            }}
          >
            <div ref={trackRef} className={styles.slideTrack}>
              {[previousPhoto, photo, nextPhoto].map((entry, index) => (
                <div
                  className={styles.slidePanel}
                  key={entry?.id ?? `empty-${index}`}
                >
                  {entry ? (
                    <PhotoPreview
                      photo={entry}
                      active={index === 1}
                      blurImages={blurImages}
                    />
                  ) : index === 1 ? (
                    <p className={styles.missingPhoto}>Loading media…</p>
                  ) : null}
                  {entry && (
                    <span className={styles.photoTime}>
                      {formatMinuteOfDay(entry.minuteOfDay)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {hasPhoto && blurImages && (
            <button
              type="button"
              className={`${styles.blurBtn} ${(photo.blurOverride ?? photo.hasDetectedFace === true) ? styles.blurBtnActive : ""}`}
              onClick={handleBlurToggle}
              aria-label="ぼかしを切り替える"
              aria-pressed={
                photo.blurOverride ?? photo.hasDetectedFace === true
              }
            >
              <MdBlurOn aria-hidden="true" />
            </button>
          )}
          {hasPhoto && (
            <button
              type="button"
              className={styles.deleteBtn}
              onClick={handleDeletePhoto}
              aria-label="Delete media"
            >
              <MdDeleteOutline aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
