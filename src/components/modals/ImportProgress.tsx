import { MdCheckCircle, MdCloudUpload } from "react-icons/md";
import type {
  ImportProgress,
  ImportResult,
} from "../../features/import/importPhotos";
import styles from "./ImportProgress.module.css";
import { Modal, modalStyles } from "./Modal";

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
    <Modal
      open
      onClose={isDone ? onClose : undefined}
      title={isDone ? "インポート完了" : "インポート中"}
      icon={
        isDone ? (
          <MdCheckCircle aria-hidden="true" />
        ) : (
          <MdCloudUpload aria-hidden="true" />
        )
      }
      labelledBy="import-progress-title"
      dismissOnOverlayClick={isDone}
      dismissOnEscape={isDone}
    >
      {!isDone ? (
        <>
          <p className={styles.counter}>
            {progress?.current} / {progress?.total}
          </p>
          <div className={styles.barBg}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
          {progress?.currentFile && (
            <p className={styles.fileName}>{progress?.currentFile}</p>
          )}
        </>
      ) : (
        <>
          <p className={styles.counter}>
            {result.succeeded} 枚を取り込み
            {(result.skipped > 0 || result.failed > 0) && (
              <>
                <br />
                （
                {[
                  result.skipped > 0 && `スキップ ${result.skipped} 枚`,
                  result.failed > 0 && `エラー ${result.failed} 枚`,
                ]
                  .filter(Boolean)
                  .join("、")}
                ）
              </>
            )}
          </p>
          {result.errors.length > 0 && (
            <ul className={styles.errorList}>
              {result.errors.map((e) => (
                <li key={`${e.file}:${e.error}`}>
                  <span className={styles.errorFile}>{e.file}</span>
                  <span className={styles.errorMessage}>{e.error}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className={modalStyles.primaryButton}
            style={{ marginTop: 8 }}
            onClick={onClose}
          >
            閉じる
          </button>
        </>
      )}
    </Modal>
  );
}
