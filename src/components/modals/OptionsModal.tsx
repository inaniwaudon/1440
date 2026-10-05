import { MdSettings } from "react-icons/md";
import { Modal, modalStyles } from "./Modal";
import styles from "./OptionsModal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  showOnlyWithImages: boolean;
  onShowOnlyWithImagesChange: (enabled: boolean) => void;
  blurImages: boolean;
  onBlurImagesChange: (enabled: boolean) => void;
  exportError: string | null;
  onExportImage: () => void;
  imageExportProgress: { current: number; total: number } | null;
  onExportData: () => void;
  onImportData: () => void;
  transferBusy: boolean;
  onDeleteAllData: () => void;
  deleteBusy: boolean;
  storagePersistence: "unsupported" | "checking" | "temporary" | "persistent";
  storageUsage: string | null;
  onRequestStoragePersistence: () => void;
};

export function OptionsModal({
  open,
  onClose,
  showOnlyWithImages,
  onShowOnlyWithImagesChange,
  blurImages,
  onBlurImagesChange,
  exportError,
  onExportImage,
  imageExportProgress,
  onExportData,
  onImportData,
  transferBusy,
  onDeleteAllData,
  deleteBusy,
  storagePersistence,
  storageUsage,
  onRequestStoragePersistence,
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
        <span>写真・動画が記録された時刻だけを表示</span>
        <input
          className={styles.switchInput}
          type="checkbox"
          checked={showOnlyWithImages}
          onChange={(event) => onShowOnlyWithImagesChange(event.target.checked)}
        />
        <span className={styles.switch} aria-hidden="true" />
      </label>
      <label className={styles.optionRow}>
        <div>
          <span className={styles.storageTitle}>データの自動削除を防ぐ</span>
          <span className={styles.storageDetail}>
            {storagePersistence === "persistent"
              ? `保護中${storageUsage ? ` · 使用量 ${storageUsage}` : ""}`
              : storagePersistence === "temporary"
                ? `未保護${storageUsage ? ` · 使用量 ${storageUsage}` : ""}`
                : storagePersistence === "checking"
                  ? "確認中…"
                  : "このブラウザでは利用できません"}
          </span>
        </div>
        <input
          className={styles.switchInput}
          type="checkbox"
          checked={storagePersistence === "persistent"}
          disabled={storagePersistence !== "temporary"}
          onChange={(event) => {
            if (event.target.checked) {
              onRequestStoragePersistence();
            }
          }}
        />
        <span className={styles.switch} aria-hidden="true" />
      </label>
      <label className={styles.optionRow}>
        <span>顔を検出してぼかす</span>
        <input
          className={styles.switchInput}
          type="checkbox"
          checked={blurImages}
          onChange={(event) => onBlurImagesChange(event.target.checked)}
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
          ? `画像一覧を書き出し中（${imageExportProgress.current}/${imageExportProgress.total}）`
          : "画像一覧の書き出し"}
      </button>
      {exportError && <p className={styles.error}>{exportError}</p>}
      <button
        type="button"
        className={`${modalStyles.secondaryButton} ${styles.actionButton}`}
        disabled={transferBusy}
        onClick={onExportData}
      >
        データをエクスポート
      </button>
      <button
        type="button"
        className={`${modalStyles.secondaryButton} ${styles.actionButton}`}
        disabled={transferBusy}
        onClick={onImportData}
      >
        データをインポート
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
