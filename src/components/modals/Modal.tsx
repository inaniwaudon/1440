import { useEffect, type ReactNode } from "react";
import styles from "./Modal.module.css";

type Props = {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  icon?: ReactNode;
  wide?: boolean;
  dismissOnOverlayClick?: boolean;
  dismissOnEscape?: boolean;
  labelledBy?: string;
  children: ReactNode;
};

export function Modal({
  open,
  onClose,
  title,
  icon,
  wide,
  dismissOnOverlayClick = true,
  dismissOnEscape = true,
  labelledBy = "modal-title",
  children,
}: Props) {
  useEffect(() => {
    if (!open || !dismissOnEscape || !onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, dismissOnEscape, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={(event) => {
        if (!dismissOnOverlayClick || !onClose) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={`${styles.modal} ${wide ? styles.wide : ""}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <header className={styles.header}>
          <h2 id={labelledBy} className={styles.title}>
            {icon}
            {title}
          </h2>
        </header>
        <div className={styles.content}>{children}</div>
      </section>
    </div>
  );
}

export { styles as modalStyles };
