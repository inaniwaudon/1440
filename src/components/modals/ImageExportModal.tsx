import { useEffect, useRef } from "react";
import { MdClose } from "react-icons/md";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import styles from "./ImageExportModal.module.css";

type Props = {
  url: string | null;
  onClose: () => void;
};

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;

async function shareImage(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const mime = blob.type || "image/png";
  const ext = mime.split("/")[1]?.split(";")[0] === "jpeg" ? "jpg" : (mime.split("/")[1]?.split(";")[0] ?? "png");
  const fileName = `1440-export.${ext}`;
  const file = new File([blob], fileName, { type: mime });

  const canShareFiles =
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if ((error as DOMException)?.name === "AbortError") return;
    }
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ImageExportModal({ url, onClose }: Props) {
  useBodyScrollLock(url !== null);
  const pressRef = useRef<{ time: number; x: number; y: number; moved: boolean } | null>(null);

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
        <img
          className={styles.image}
          src={url}
          alt="エクスポートした画像"
          onPointerDown={(event) => {
            if (!event.isPrimary) return;
            pressRef.current = {
              time: Date.now(),
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
          }}
          onPointerMove={(event) => {
            const press = pressRef.current;
            if (!press || press.moved) return;
            if (
              Math.hypot(event.clientX - press.x, event.clientY - press.y) >
              LONG_PRESS_MOVE_TOLERANCE
            ) {
              press.moved = true;
            }
          }}
          onPointerUp={() => {
            const press = pressRef.current;
            pressRef.current = null;
            if (press && !press.moved && Date.now() - press.time >= LONG_PRESS_MS) {
              void shareImage(url);
            }
          }}
          onPointerCancel={() => {
            pressRef.current = null;
          }}
        />
      </div>
      <p className={styles.hint}>画像を長押しして保存</p>
    </div>
  );
}
