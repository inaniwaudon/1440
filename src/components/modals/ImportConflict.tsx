import { useEffect, useRef } from "react";
import { MdCompareArrows } from "react-icons/md";
import type { ImportConflict } from "../../features/import/importPhotos";
import { formatMinuteOfDay } from "../../utils/time";
import styles from "./ImportConflict.module.css";
import { Modal, modalStyles } from "./Modal";

type Props = {
  conflict: ImportConflict | null;
  onResolve: (replace: boolean) => void;
};

function BlobPreview({ blob, alt }: { blob: Blob; alt: string }) {
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const nextUrl = URL.createObjectURL(blob);
    if (imageRef.current) imageRef.current.src = nextUrl;
    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);

  return <img ref={imageRef} className={styles.image} alt={alt} />;
}

function displayName(name?: string) {
  return name || "名前のないメディア";
}

export function ImportConflictOverlay({ conflict, onResolve }: Props) {
  const open = !!conflict;

  return (
    <Modal
      open={open}
      title={
        conflict
          ? `${formatMinuteOfDay(conflict.minuteOfDay)} に重複があります`
          : ""
      }
      icon={<MdCompareArrows aria-hidden="true" />}
      labelledBy="conflict-title"
      wide
      dismissOnOverlayClick={false}
      dismissOnEscape={false}
    >
      {conflict && (
        <div className={styles.comparison}>
          <article className={styles.option}>
            <div className={styles.badge}>現在</div>
            <div className={styles.preview}>
              <BlobPreview
                blob={conflict.existing.thumbnailBlob}
                alt="現在保存されているメディア"
              />
            </div>
            <p
              className={styles.fileName}
              title={displayName(conflict.existing.originalFileName)}
            >
              {displayName(conflict.existing.originalFileName)}
            </p>
            <button
              type="button"
              className={modalStyles.secondaryButton}
              onClick={() => onResolve(false)}
            >
              現在を残す
            </button>
          </article>
          <article className={styles.option}>
            <div className={`${styles.badge} ${styles.newBadge}`}>新規</div>
            <div className={styles.preview}>
              <BlobPreview
                blob={conflict.incoming.thumbnailBlob}
                alt="新しくインポートするメディア"
              />
            </div>
            <p className={styles.fileName} title={conflict.incoming.fileName}>
              {conflict.incoming.fileName}
            </p>
            <button
              type="button"
              className={modalStyles.primaryButton}
              onClick={() => onResolve(true)}
            >
              新規に置換
            </button>
          </article>
        </div>
      )}
    </Modal>
  );
}
