import {
  MdCheckCircle,
  MdDownload,
  MdShare,
  MdSwapHoriz,
} from "react-icons/md";
import type { ImportArchiveResult } from "../../features/transfer/importArchive";
import styles from "./ImportProgress.module.css";
import { Modal, modalStyles } from "./Modal";

export type TransferPhase =
  | { kind: "exporting"; current: number; total: number }
  | {
      kind: "importing";
      current: number;
      total: number;
      phase: "scan" | "write";
    }
  | {
      kind: "export-done";
      download?: { url: string; name: string };
      shareFile?: File;
    }
  | { kind: "import-done"; result: ImportArchiveResult };

type Props = {
  phase: TransferPhase | null;
  onClose: () => void;
};

async function sharePhaseFile(file: File) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      throw err;
    }
  }
}

export function TransferProgressOverlay({ phase, onClose }: Props) {
  if (!phase) return null;

  const isDone = phase.kind === "export-done" || phase.kind === "import-done";
  const title = (() => {
    switch (phase.kind) {
      case "exporting":
        return "書き出し中";
      case "importing":
        return phase.phase === "scan" ? "読み取り中" : "読み込み中";
      case "export-done":
        return "書き出し完了";
      case "import-done":
        return "読み込み完了";
    }
  })();

  const current =
    phase.kind === "exporting" || phase.kind === "importing"
      ? phase.current
      : 0;
  const total =
    phase.kind === "exporting" || phase.kind === "importing" ? phase.total : 0;
  const pct =
    total > 0 ? Math.round((current / total) * 100) : isDone ? 100 : 0;

  return (
    <Modal
      open
      onClose={isDone ? onClose : undefined}
      title={title}
      icon={
        isDone ? (
          <MdCheckCircle aria-hidden="true" />
        ) : (
          <MdSwapHoriz aria-hidden="true" />
        )
      }
      labelledBy="transfer-progress-title"
      dismissOnOverlayClick={isDone}
      dismissOnEscape={isDone}
    >
      {phase.kind === "exporting" || phase.kind === "importing" ? (
        <>
          <p className={styles.counter}>
            {current} / {total}
          </p>
          <div className={styles.barBg}>
            <div className={styles.barFill} style={{ width: `${pct}%` }} />
          </div>
        </>
      ) : null}

      {phase.kind === "export-done" &&
        (phase.download || phase.shareFile ? (
          <>
            <p className={styles.counter}>準備ができました</p>
            {phase.shareFile &&
              navigator.canShare?.({ files: [phase.shareFile] }) && (
                <button
                  type="button"
                  className={modalStyles.primaryButton}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    marginTop: 8,
                  }}
                  // biome-ignore lint/style/noNonNullAssertion: shareFile existence checked above
                  onClick={() => sharePhaseFile(phase.shareFile!)}
                >
                  <MdShare aria-hidden="true" />
                  共有・保存
                </button>
              )}
            {phase.download && (
              <a
                className={modalStyles.secondaryButton}
                href={phase.download.url}
                download={phase.download.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  textDecoration: "none",
                  marginTop: 8,
                }}
              >
                <MdDownload aria-hidden="true" />
                ダウンロード
              </a>
            )}
            <button
              type="button"
              className={modalStyles.secondaryButton}
              style={{ marginTop: 8 }}
              onClick={onClose}
            >
              閉じる
            </button>
          </>
        ) : (
          <>
            <p className={styles.counter}>保存しました</p>
            <button
              type="button"
              className={modalStyles.primaryButton}
              style={{ marginTop: 8 }}
              onClick={onClose}
            >
              閉じる
            </button>
          </>
        ))}

      {phase.kind === "import-done" && (
        <>
          <p className={styles.counter}>
            読み込み: {phase.result.imported}
            {phase.result.skipped > 0 && (
              <span>&nbsp; スキップ: {phase.result.skipped}</span>
            )}
            {phase.result.failed > 0 && (
              <span className={styles.failed}>
                &nbsp; 失敗: {phase.result.failed}
              </span>
            )}
          </p>
          {phase.result.errors.length > 0 && (
            <p className={styles.errorDetail}>
              {phase.result.errors[0].id}: {phase.result.errors[0].error}
            </p>
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
