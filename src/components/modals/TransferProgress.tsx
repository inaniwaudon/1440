import {
  MdCheckCircle,
  MdDownload,
  MdShare,
  MdSwapHoriz,
} from "react-icons/md";
import type { ExportedFile } from "../../features/transfer/exportArchive";
import type { ImportArchiveResult } from "../../features/transfer/importArchive";
import styles from "./ImportProgress.module.css";
import { Modal, modalStyles } from "./Modal";

export type ExportDownloadRef = { url: string; name: string };

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
      files: Array<{
        file: ExportedFile;
        download?: ExportDownloadRef;
      }>;
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

async function sharePhaseFiles(files: File[]) {
  if (files.length === 0) return;
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, title: `${files.length} archives` });
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
          {phase.files.length > 1 &&
            (() => {
              const shareFiles = phase.files
                .map((f) => f.file.shareFile)
                .filter((f): f is File => !!f);
              const canShareAll =
                shareFiles.length === phase.files.length &&
                !!navigator.canShare?.({ files: shareFiles });
              if (!canShareAll) return null;
              return (
                <button
                  type="button"
                  className={modalStyles.primaryButton}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                  onClick={() => sharePhaseFiles(shareFiles)}
                >
                  <MdShare aria-hidden="true" />
                  まとめて共有（{shareFiles.length} 件）
                </button>
              );
            })()}
          {phase.files.map(({ file, download }) => {
            const canShare = file.shareFile
              ? !!navigator.canShare?.({ files: [file.shareFile] })
              : false;
            const label = file.kind === "video" ? "動画" : "写真";
            return (
              <div key={file.name} style={{ marginTop: 12 }}>
                <p style={{ margin: "0 4px 6px", fontSize: 12, opacity: 0.8 }}>
                  {label}: {file.name}
                </p>
                {canShare && file.shareFile && (
                  <button
                    type="button"
                    className={modalStyles.primaryButton}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                    // biome-ignore lint/style/noNonNullAssertion: checked
                    onClick={() => sharePhaseFile(file.shareFile!)}
                  >
                    <MdShare aria-hidden="true" />
                    共有・保存
                  </button>
                )}
                {download && (
                  <a
                    className={modalStyles.primaryButton}
                    href={download.url}
                    download={download.name}
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
}
