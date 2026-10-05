import type { ChangeEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  MdFolderOpen,
  MdPhotoCamera,
  MdQuestionMark,
  MdSettings,
} from "react-icons/md";
import styles from "./FabMenu.module.css";

type Item = "photo" | "help" | "option";
type Props = {
  onCamera: (file: File) => void;
  onImport: (files: File[]) => void;
  onHelp?: () => void;
  onOption?: () => void;
};

const MIN_DIST = 20;

export const FabMenu = ({ onCamera, onImport, onHelp, onOption }: Props) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Item | null>(null);
  const [showPhotoActions, setShowPhotoActions] = useState(false);
  const gestureRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef(false);
  const activeRef = useRef<Item | null>(null);
  const hadActiveRef = useRef(false);
  const originRef = useRef({ x: 0, y: 0 });

  const getItem = (x: number, y: number): Item | null => {
    const deltaX = x - originRef.current.x;
    const deltaY = y - originRef.current.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < MIN_DIST) {
      return null;
    }

    const fab = gestureRef.current?.getBoundingClientRect();
    if (!fab) {
      return null;
    }

    const centerX = fab.left + fab.width / 2;
    const centerY = fab.top + fab.height / 2;
    const radialDistance = 92;
    const diagonalOffset = radialDistance * Math.SQRT1_2;
    const candidates: Array<{ item: Item; x: number; y: number }> = [
      { item: "option", x: centerX - radialDistance, y: centerY },
      {
        item: "help",
        x: centerX - diagonalOffset,
        y: centerY - diagonalOffset,
      },
      { item: "photo", x: centerX, y: centerY - radialDistance },
    ];
    const closest = candidates.reduce((best, candidate) => {
      const candidateDistance = Math.hypot(x - candidate.x, y - candidate.y);
      const bestDistance = Math.hypot(x - best.x, y - best.y);
      return candidateDistance < bestDistance ? candidate : best;
    });

    // メニューは FAB の左上側のみに展開する
    if (x > centerX + MIN_DIST && y > centerY + MIN_DIST) {
      return null;
    }
    return closest.item;
  };

  const selectItem = (item: Item | null) => {
    activeRef.current = item;
    if (item !== null) {
      hadActiveRef.current = true;
    }
    setActive(item);
  };

  const close = () => {
    openRef.current = false;
    activeRef.current = null;
    hadActiveRef.current = false;
    setOpen(false);
    setActive(null);
    setShowPhotoActions(false);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read latest state via refs
  useEffect(() => {
    // biome-ignore lint/style/noNonNullAssertion: gestureRef is attached by this component
    const el = gestureRef.current!;

    const onPointerDown = (event: PointerEvent) => {
      originRef.current = { x: event.clientX, y: event.clientY };
      hadActiveRef.current = false;
      selectItem(null);
      openRef.current = true;
      setOpen(true);
      el.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!openRef.current) {
        return;
      }
      selectItem(getItem(event.clientX, event.clientY));
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!openRef.current) {
        return;
      }

      // pointermove が最終位置で発火する保証はない。
      // 素早くスライドして離すジェスチャに対応するため、pointerup の位置で再評価する。
      selectItem(getItem(event.clientX, event.clientY));

      const selected = activeRef.current;
      const hadActive = hadActiveRef.current;
      openRef.current = false;
      activeRef.current = null;
      hadActiveRef.current = false;
      setOpen(false);
      setActive(null);
      if (selected === "photo" || (selected === null && !hadActive)) {
        setShowPhotoActions(true);
      } else {
        setShowPhotoActions(false);
        if (selected === "help") {
          onHelp?.();
        }
        if (selected === "option") {
          onOption?.();
        }
      }
    };

    const onPointerCancel = () => {
      close();
    };

    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerCancel);
    // フォールバック：
    // PC での transform 中などでポインタキャプチャが失われた場合に備え、
    // window でもリスナを登録し、FAB の外で離した場合も処理できるようにする
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [onHelp, onOption]);

  const handleCameraChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files[0]) {
      onCamera(files[0]);
    }
  };

  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) {
      onImport(files);
    }
  };

  const openCamera = () => {
    cameraInputRef.current?.click();
    setShowPhotoActions(false);
  };

  const openPhotoPicker = () => {
    importInputRef.current?.click();
    setShowPhotoActions(false);
  };

  return (
    <>
      {(open || showPhotoActions) && (
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes menu
        // biome-ignore lint/a11y/useKeyWithClickEvents: menu is dismissed via FAB press
        <div className={styles.backdrop} onClick={close} />
      )}

      <div className={styles.root}>
        {open && (
          <>
            <div
              className={`${styles.item} ${styles.itemLeft} ${active === "option" ? styles.itemActive : ""}`}
              role="img"
              aria-label="Option"
            >
              <MdSettings className={styles.itemIcon} aria-hidden="true" />
            </div>
            <div
              className={`${styles.item} ${styles.itemDiagonal} ${active === "help" ? styles.itemActive : ""}`}
              role="img"
              aria-label="Help"
            >
              <MdQuestionMark className={styles.itemIcon} aria-hidden="true" />
            </div>
            <div
              className={`${styles.item} ${styles.itemTop} ${active === "photo" ? styles.itemActive : ""}`}
              role="img"
              aria-label="Photo"
            >
              <MdPhotoCamera className={styles.itemIcon} aria-hidden="true" />
            </div>
          </>
        )}

        {showPhotoActions && (
          <div className={styles.photoActions}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={openCamera}
            >
              <MdPhotoCamera
                aria-hidden="true"
                className={styles.actionButtonIcon}
              />
              写真を撮影
            </button>
            <button
              type="button"
              className={styles.actionButton}
              onClick={openPhotoPicker}
            >
              <MdFolderOpen
                aria-hidden="true"
                className={styles.actionButtonIcon}
              />
              写真を選択
            </button>
          </div>
        )}

        <div
          ref={gestureRef}
          className={`${styles.fab} ${open ? styles.fabOpen : ""}`}
        >
          <span
            className={`${styles.fabIcon} ${open ? styles.fabIconOpen : ""}`}
          >
            ＋
          </span>
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
};
