import { useEffect, useState } from "react";
import { MdIosShare } from "react-icons/md";
import styles from "./InstallPrompt.module.css";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "installPromptDismissed";

const isIosSafari = () => {
  const ua = window.navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
};

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  // iOS Safari 向けの判定
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") {
      setDismissed(true);
      return;
    }
    if (isIosSafari()) {
      setShowIosHint(true);
    }
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  if (dismissed) return null;

  if (deferredPrompt) {
    const handleInstall = async () => {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted" || outcome === "dismissed") {
        setDeferredPrompt(null);
        if (outcome === "accepted") {
          localStorage.setItem(DISMISS_KEY, "1");
        }
      }
    };

    return (
      <div className={styles.banner}>
        <span className={styles.text}>このアプリをホーム画面に追加</span>
        <button
          type="button"
          className={styles.installBtn}
          onClick={handleInstall}
        >
          追加
        </button>
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={dismiss}
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className={styles.banner}>
        <span className={styles.text}>
          共有ボタン
          <MdIosShare className={styles.shareIcon} aria-hidden />
          から「ホーム画面に追加」することで、アプリケーションとして使用できます
        </span>
        <button
          type="button"
          className={styles.dismissBtn}
          onClick={dismiss}
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    );
  }

  return null;
}
