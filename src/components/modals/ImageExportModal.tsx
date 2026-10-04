import { useEffect } from "react";
import { MdClose } from "react-icons/md";
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
    // biome-ignore lint/a11y/noStaticElementInteractions: overlay click dismisses modal
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape handled by keydown listener
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.closeRow}>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="閉じる"
        >
          <MdClose aria-hidden="true" />
        </button>
      </div>
      <div className={styles.imageWrap}>
        <img className={styles.image} src={url} alt="書き出した画像" />
      </div>
      <p className={styles.hint}>画像を長押しして保存</p>
    </div>
  );
}
