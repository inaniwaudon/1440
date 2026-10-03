import { useEffect, useState } from "react";
import styles from "./InstallPrompt.module.css";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted" || outcome === "dismissed") {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className={styles.banner}>
      <span className={styles.text}>Add this app to your Home Screen</span>
      <button
        type="button"
        className={styles.installBtn}
        onClick={handleInstall}
      >
        Add
      </button>
      <button
        type="button"
        className={styles.dismissBtn}
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  );
}
