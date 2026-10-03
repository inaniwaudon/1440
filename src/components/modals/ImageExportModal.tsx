import { useEffect } from "react";
import { modalStyles } from "./Modal";
import styles from "./ImageExportModal.module.css";

type Props = {
  url: string | null;
  onClose: () => void;
};

export function ImageExportModal({ url, onClose }: Props) {
  useEffect(() => {
    if (!url) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.closeRow}>
        <button
          type="button"
          className={modalStyles.secondaryButton}
          style={{ width: "auto", padding: "8px 16px", fontWeight: 600 }}
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
      <div className={styles.imageWrap}>
        <img className={styles.image} src={url} alt="書き出した画像" />
      </div>
      <p className={styles.hint}>画像を長押しして保存できます</p>
    </div>
  );
}
