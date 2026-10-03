import { MdSwapHoriz } from "react-icons/md";
import type {
  ArchiveSummary,
  ImportMode,
} from "../../features/transfer/importArchive";
import { Modal, modalStyles } from "./Modal";
import styles from "./TransferModal.module.css";

type Props = {
  summary: ArchiveSummary | null;
  existingPhotoCount: number;
  onCancel: () => void;
  onConfirm: (mode: ImportMode) => void;
};

export function TransferModal({
  summary,
  existingPhotoCount,
  onCancel,
  onConfirm,
}: Props) {
  if (!summary) return null;
  const exportedAt = new Date(summary.manifest.exportedAt);
  const exportedLabel = Number.isNaN(exportedAt.getTime())
    ? summary.manifest.exportedAt
    : exportedAt.toLocaleString();

  return (
    <Modal
      open
      onClose={onCancel}
      title="データを読み込み"
      icon={<MdSwapHoriz aria-hidden="true" />}
      labelledBy="transfer-import-title"
    >
      <p className={styles.summary}>
        書き出し日時: {exportedLabel}
        <br />
        含まれる写真: {summary.manifest.photoCount} 枚
      </p>
      {existingPhotoCount > 0 ? (
        <>
          <p className={styles.note}>
            現在 {existingPhotoCount}{" "}
            枚のデータがあります。どのように読み込みますか？
          </p>
          <button
            type="button"
            className={modalStyles.primaryButton}
            onClick={() => onConfirm("merge-keep")}
          >
            統合（既存を優先）
          </button>
          <button
            type="button"
            className={modalStyles.primaryButton}
            style={{ marginTop: 8 }}
            onClick={() => onConfirm("merge-overwrite")}
          >
            統合（アーカイブを優先）
          </button>
          <button
            type="button"
            className={modalStyles.secondaryButton}
            style={{ marginTop: 8 }}
            onClick={() => onConfirm("replace")}
          >
            全て置き換え
          </button>
        </>
      ) : (
        <button
          type="button"
          className={modalStyles.primaryButton}
          onClick={() => onConfirm("replace")}
        >
          読み込む
        </button>
      )}
      <button
        type="button"
        className={modalStyles.secondaryButton}
        style={{ marginTop: 8 }}
        onClick={onCancel}
      >
        キャンセル
      </button>
    </Modal>
  );
}
