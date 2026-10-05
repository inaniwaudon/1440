import { MdCheckCircle, MdShare, MdSwapHoriz } from "react-icons/md";
import type { ExportedFile } from "../../features/transfer/exportArchive";
import type { ImportArchiveResult } from "../../features/transfer/importArchive";
import styles from "./ImportProgress.module.css";
import { Modal, modalStyles } from "./Modal";

export type TransferPhase =
  | {
      kind: "exporting";
      step: number;
      totalSteps: number;
      label: string;
      current: number;
      total: number;
    }
  | {
      kind: "importing";
      label: string;
      current: number;
      total: number;
      phase: "scan" | "write";
    }
  | {
      kind: "export-done";
      files: Array<{ file: ExportedFile }>;
    }
  | { kind: "import-done"; result: ImportArchiveResult };

type Props = {
  phase: TransferPhase | null;
  onClose: () => void;
};

const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

const sharePhaseFile = async (file: File) => {
  const canShare =
    typeof navigator.share === "function" &&
    (navigator.canShare?.({ files: [file] }) ?? true);
  if (!canShare) {
    downloadFile(file);
    return;
  }
  try {
    await navigator.share({ files: [file], title: file.name });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return;
    }
    // PWA standalone 等で share が失敗するケースのフォールバック
    downloadFile(file);
  }
};

export const TransferProgressOverlay = ({ phase, onClose }: Props) => {
  if (!phase) {
    return null;
  }

  const isDone = phase.kind === "export-done" || phase.kind === "import-done";
  const title = (() => {
    switch (phase.kind) {
      case "exporting": {
        return `エクスポート中（${phase.step}/${phase.totalSteps} ${phase.label}）`;
      }
      case "importing":
        return phase.phase === "scan"
          ? `読み取り中 ${phase.label}`
          : `インポート中 ${phase.label}`;
      case "export-done":
        return "エクスポート完了";
      case "import-done":
        return "インポート完了";
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

      {phase.kind === "export-done" && (
        <>
          {phase.files.map(({ file }) => {
            const shareFile =
              file.shareFile ??
              new File([file.blob], file.name, { type: "application/zip" });
            const label = file.kind === "video" ? "動画" : "写真";
            return (
              <div key={file.name} style={{ marginTop: 12 }}>
                <p style={{ margin: "0 4px 6px", fontSize: 12, opacity: 0.8 }}>
                  {label}: {file.name}
                </p>
                <button
                  type="button"
                  className={modalStyles.primaryButton}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                  }}
                  onClick={() => sharePhaseFile(shareFile)}
                >
                  <MdShare aria-hidden="true" />
                  共有・保存
                </button>
              </div>
            );
          })}
          <p className={styles.exportNote}>
            データを引き継ぐにはすべての zip
            ファイルをダウンロードして、新しい端末にインポートする必要があります
          </p>
          <button
            type="button"
            className={modalStyles.secondaryButton}
            onClick={onClose}
          >
            閉じる
          </button>
        </>
      )}

      {phase.kind === "import-done" && (
        <>
          <p className={styles.counter}>
            インポート: {phase.result.imported}
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
};
