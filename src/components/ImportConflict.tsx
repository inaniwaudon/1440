import { useEffect, useRef } from "react";
import type { ImportConflict } from "../features/import/importPhotos";
import { formatMinuteOfDay } from "../utils/time";
import styles from "./ImportConflict.module.css";

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
  if (!conflict) return null;

  const { existing, incoming, minuteOfDay } = conflict;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <section className={styles.card}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{formatMinuteOfDay(minuteOfDay)} に重複があります</p>
          <h2 className={styles.title} id="conflict-title">どちらを残しますか？</h2>
        </header>

        <div className={styles.comparison}>
          <article className={styles.option}>
            <span className={styles.badge}>現在</span>
            <div className={styles.preview}>
              <BlobPreview
                blob={existing.thumbnailBlob}
                alt="現在保存されているメディア"
              />
            </div>
            <p className={styles.fileName} title={displayName(existing.originalFileName)}>
              {displayName(existing.originalFileName)}
            </p>
            <button className={styles.keepButton} onClick={() => onResolve(false)} autoFocus>
              現在を残す
            </button>
          </article>

          <div className={styles.divider} aria-hidden="true">VS</div>

          <article className={`${styles.option} ${styles.newOption}`}>
            <span className={`${styles.badge} ${styles.newBadge}`}>新規</span>
            <div className={styles.preview}>
              <BlobPreview blob={incoming.thumbnailBlob} alt="新しく読み込むメディア" />
            </div>
            <p className={styles.fileName} title={incoming.fileName}>{incoming.fileName}</p>
            <button className={styles.replaceButton} onClick={() => onResolve(true)}>
              新規に置換
            </button>
          </article>
        </div>
      </section>
    </div>
  );
}
