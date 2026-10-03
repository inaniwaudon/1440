import type { ImportProgress, ImportResult } from "../features/import/importPhotos";
import styles from "./ImportProgress.module.css";

type Props = {
  progress: ImportProgress | null;
  result: ImportResult | null;
  onClose: () => void;
};

export function ImportProgressOverlay({ progress, result, onClose }: Props) {
  if (!progress && !result) return null;

  const isDone = !!result;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : isDone
        ? 100
        : 0;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {!isDone ? (
          <>
            <p className={styles.title}>Importing media</p>
            <p className={styles.counter}>
              {progress!.current} / {progress!.total}
            </p>
            <div className={styles.barBg}>
              <div className={styles.barFill} style={{ width: `${pct}%` }} />
            </div>
            {progress!.currentFile && (
              <p className={styles.fileName}>{progress!.currentFile}</p>
            )}
          </>
        ) : (
          <>
            <p className={styles.title}>Done</p>
            <p className={styles.counter}>
              Imported: {result.succeeded}
              {result.skipped > 0 && (
                <span>&nbsp; Skipped: {result.skipped}</span>
              )}
              {result.failed > 0 && (
                <span className={styles.failed}>&nbsp; Failed: {result.failed}</span>
              )}
            </p>
            {result.errors.length > 0 && (
              <p className={styles.errorDetail}>
                {result.errors[0].file}: {String(result.errors[0].error)}
              </p>
            )}
            <button className={styles.closeBtn} onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}
