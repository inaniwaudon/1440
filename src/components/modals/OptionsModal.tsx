import { useEffect } from "react";
import { MdSettings } from "react-icons/md";
import styles from "./OptionsModal.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  showOnlyWithImages: boolean;
  onShowOnlyWithImagesChange: (enabled: boolean) => void;
  exportError: string | null;
  onExportImage: () => void;
  imageExportProgress: { current: number; total: number } | null;
};

export function OptionsModal({
  open,
  onClose,
  showOnlyWithImages,
  onShowOnlyWithImagesChange,
  exportError,
  onExportImage,
  imageExportProgress,
}: Props) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="options-title"
      >
        <header className={styles.header}>
          <h2 id="options-title" className={styles.title}>
            <MdSettings aria-hidden="true" />
            Options
          </h2>
        </header>
        <div className={styles.content}>
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
            className={styles.exportButton}
            disabled={imageExportProgress !== null}
            onClick={onExportImage}
          >
            {imageExportProgress
              ? `画像を書き出しています ${imageExportProgress.current}/${imageExportProgress.total}`
              : "画像書き出し"}
          </button>
          {exportError && <p className={styles.error}>{exportError}</p>}
        </div>
      </section>
    </div>
  );
}
