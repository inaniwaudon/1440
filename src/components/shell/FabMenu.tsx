import { useEffect, useRef, useState } from "react";
import { MdFolderOpen, MdPhotoCamera, MdSettings } from "react-icons/md";
import styles from "./FabMenu.module.css";

type Item = "photo" | "import" | "option";
type Props = {
  onCamera: (file: File) => void;
  onImport: (files: File[]) => void;
  onOption?: () => void;
};

const MIN_DIST = 20;

export function FabMenu({ onCamera, onImport, onOption }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Item | null>(null);
  const [pending, setPending] = useState<"photo" | "import" | null>(null);
  const gestureRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  const activeRef = useRef<Item | null>(null);
  const originRef = useRef({ x: 0, y: 0 });

  function getItem(x: number, y: number): Item | null {
    const dx = x - originRef.current.x;
    const dy = y - originRef.current.y;
    const distance = Math.hypot(dx, dy);
    if (distance < MIN_DIST) return null;

    const fab = gestureRef.current?.getBoundingClientRect();
    if (!fab) return null;

    const centerX = fab.left + fab.width / 2;
    const centerY = fab.top + fab.height / 2;
    const radialDistance = 92;
    const diagonalOffset = radialDistance * Math.SQRT1_2;
    const candidates: Array<{ item: Item; x: number; y: number }> = [
      { item: "option", x: centerX - radialDistance, y: centerY },
      { item: "import", x: centerX - diagonalOffset, y: centerY - diagonalOffset },
      { item: "photo", x: centerX, y: centerY - radialDistance },
    ];
    const closest = candidates.reduce((best, candidate) => {
      const candidateDistance = Math.hypot(x - candidate.x, y - candidate.y);
      const bestDistance = Math.hypot(x - best.x, y - best.y);
      return candidateDistance < bestDistance ? candidate : best;
    });

    // The menu only occupies the upper-left side of the FAB.
    if (x > centerX + MIN_DIST && y > centerY + MIN_DIST) return null;
    return closest.item;
  }

  function selectItem(item: Item | null) {
    activeRef.current = item;
    setActive(item);
  }

  const close = () => {
    openRef.current = false;
    activeRef.current = null;
    setOpen(false);
    setActive(null);
    setPending(null);
  };

  useEffect(() => {
    const el = gestureRef.current!;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      originRef.current = { x: t.clientX, y: t.clientY };
      selectItem(null);
      openRef.current = true;
      setOpen(true);
    }

    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (!openRef.current) return;
      selectItem(getItem(t.clientX, t.clientY));
    }

    function onTouchEnd(e: TouchEvent) {
      if (!openRef.current) return;

      // touchmove is not guaranteed to fire at the finger's final position.
      // Re-evaluate from touchend so quick slide-and-release gestures work.
      const t = e.changedTouches[0];
      if (t) selectItem(getItem(t.clientX, t.clientY));

      const selected = activeRef.current;
      openRef.current = false;
      activeRef.current = null;
      setOpen(false);
      setActive(null);
      if (selected === "photo" || selected === "import") {
        setPending(selected);
      } else {
        setPending(null);
        if (selected === "option") onOption?.();
      }
    }

    function onTouchCancel() {
      close();
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [onOption]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files[0]) onCamera(files[0]);
  };

  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) onImport(files);
  };

  const confirmPending = () => {
    if (pending === "photo") cameraInputRef.current?.click();
    if (pending === "import") importInputRef.current?.click();
    setPending(null);
  };

  return (
    <>
      {(open || pending) && <div className={styles.backdrop} onClick={close} />}

      <div className={styles.root}>
        {open && (
          <>
            <div
              className={`${styles.item} ${styles.itemLeft} ${active === "option" ? styles.itemActive : ""}`}
              aria-label="Option"
            >
              <MdSettings className={styles.itemIcon} aria-hidden="true" />
            </div>
            <div
              className={`${styles.item} ${styles.itemDiagonal} ${active === "import" ? styles.itemActive : ""}`}
              aria-label="Import"
            >
              <MdFolderOpen className={styles.itemIcon} aria-hidden="true" />
            </div>
            <div
              className={`${styles.item} ${styles.itemTop} ${active === "photo" ? styles.itemActive : ""}`}
              aria-label="Photo"
            >
              <MdPhotoCamera className={styles.itemIcon} aria-hidden="true" />
            </div>
          </>
        )}

        {pending && (
          <button type="button" className={styles.confirmButton} onClick={confirmPending}>
            {pending === "photo" ? (
              <><MdPhotoCamera aria-hidden="true" />Open Camera</>
            ) : (
              <><MdFolderOpen aria-hidden="true" />Choose Media</>
            )}
          </button>
        )}

        <div
          ref={gestureRef}
          className={`${styles.fab} ${open ? styles.fabOpen : ""}`}
        >
          <span className={`${styles.fabIcon} ${open ? styles.fabIconOpen : ""}`}>＋</span>
        </div>
        <input
          ref={cameraInputRef}
          className={styles.hiddenInput}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraChange}
        />
        <input
          ref={importInputRef}
          className={styles.hiddenInput}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={handleImportChange}
        />
      </div>
    </>
  );
}
