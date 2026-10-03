import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MdDeleteOutline } from "react-icons/md";
import { db } from "../db/db";
import type { PhotoRecord } from "../db/types";
import { formatMinuteOfDay } from "../utils/time";
import styles from "./MinuteDetail.module.css";

type Props = {
  minuteOfDay: number | null;
  onClose: () => void;
};

function PhotoPreview({ photo }: { photo: PhotoRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  const isVideo = photo.mimeType?.startsWith("video/") && !!photo.videoBlob;

  useEffect(() => {
    const blob = isVideo ? photo.videoBlob! : (photo.previewBlob ?? photo.thumbnailBlob);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [isVideo, photo.videoBlob, photo.previewBlob, photo.thumbnailBlob]);

  if (!url) return null;
  return isVideo ? (
    <video
      src={url}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      className={styles.previewImg}
    />
  ) : (
    <img src={url} alt="Saved photo" className={styles.previewImg} />
  );
}

export function MinuteDetail({
  minuteOfDay,
  onClose,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const slot = useLiveQuery(
    () => (minuteOfDay !== null ? db.slots.get(minuteOfDay) : undefined),
    [minuteOfDay],
  );

  const photo = useLiveQuery(
    () => (slot?.photoId ? db.photos.get(slot.photoId) : undefined),
    [slot?.photoId],
  );

  if (minuteOfDay === null) return null;

  const label = formatMinuteOfDay(minuteOfDay);
  const hasPhoto = !!slot?.photoId;

  const handleClose = () => {
    onClose();
  };

  const handleDeletePhoto = async () => {
    if (!window.confirm("Delete this media?")) return;

    await db.transaction("rw", db.photos, db.slots, async () => {
      if (slot?.photoId) await db.photos.delete(slot.photoId);
      if (slot) {
        await db.slots.delete(minuteOfDay);
      }
    });
  };

  return (
    <div
      className={styles.overlay}
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div
        className={styles.sheet}
      >
        <div className={styles.content}>
          <div
            className={styles.previewWrap}
            style={{ viewTransitionName: `minute-photo-${minuteOfDay}` }}
            onClick={(e) => {
              const image = e.currentTarget.querySelector("img");
              if (!image) {
                handleClose();
                return;
              }

              const frame = image.getBoundingClientRect();
              const imageRatio = image.naturalWidth / image.naturalHeight;
              const frameRatio = frame.width / frame.height;
              const width = imageRatio > frameRatio
                ? frame.width
                : frame.height * imageRatio;
              const height = imageRatio > frameRatio
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
            {photo ? (
              <PhotoPreview photo={photo} />
            ) : (
              <p className={styles.missingPhoto}>
                {hasPhoto ? "Loading media…" : "No media"}
              </p>
            )}
            <span className={styles.photoTime}>{label}</span>
          </div>
          {hasPhoto && (
            <button
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
