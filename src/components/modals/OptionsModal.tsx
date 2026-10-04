import { MdSettings } from "react-icons/md";
import { Modal, modalStyles } from "./Modal";
import styles from "./OptionsModal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  showOnlyWithImages: boolean;
  onShowOnlyWithImagesChange: (enabled: boolean) => void;
  exportError: string | null;
  onExportImage: () => void;
  imageExportProgress: { current: number; total: number } | null;
  onExportData: () => void;
  onImportData: () => void;
  transferBusy: boolean;
  onDeleteAllData: () => void;
  deleteBusy: boolean;
};

export function OptionsModal({
  open,
  onClose,
  showOnlyWithImages,
  onShowOnlyWithImagesChange,
  exportError,
  onExportImage,
  imageExportProgress,
  onExportData,
  onImportData,
  transferBusy,
  onDeleteAllData,
  deleteBusy,
}: Props) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="オプション"
      icon={<MdSettings aria-hidden="true" />}
      labelledBy="options-title"
    >
      <label className={styles.optionRow}>
        <span>画像が追加されている時刻だけを表示</span>
        <input
          className={styles.switchInput}
          type="checkbox"
          checked={showOnlyWithImages}
          onChange={(event) => onShowOnlyWithImagesChange(event.target.checked)}
        />
        <span className={styles.switch} aria-hidden="true" />
      </label>
      <button
        type="button"
        className={`${modalStyles.secondaryButton} ${styles.actionButton}`}
        disabled={imageExportProgress !== null}
        onClick={onExportImage}
      >
        {imageExportProgress
          ? `一覧画像を書き出し中（${imageExportProgress.current}/${imageExportProgress.total}）`
          : "一覧画像の書き出し"}
      </button>
      {exportError && <p className={styles.error}>{exportError}</p>}
      <button
        type="button"
        className={`${modalStyles.secondaryButton} ${styles.actionButton}`}
        disabled={transferBusy}
        onClick={onExportData}
      >
        データを書き出し
      </button>
      <button
        type="button"
        className={`${modalStyles.secondaryButton} ${styles.actionButton}`}
        disabled={transferBusy}
        onClick={onImportData}
      >
        データを読み込み
      </button>
      <button
        type="button"
        className={`${modalStyles.primaryButton} ${styles.actionButton} ${styles.dangerButton}`}
        disabled={transferBusy || deleteBusy}
        onClick={onDeleteAllData}
      >
        {deleteBusy ? "削除しています…" : "全データを削除"}
      </button>
    </Modal>
  );
}
