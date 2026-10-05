import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// 新しい Service Worker が有効化され次第 PWA を自動リロードし、
// 再デプロイ後に iOS がホーム画面キャッシュの古い JS を実行し続けないようにする
registerSW({
  immediate: true,
  onRegisteredSW: (_url, registration) => {
    if (!registration) {
      return;
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) {
        return;
      }
      installing.addEventListener("statechange", () => {
        if (installing.state === "activated") {
          location.reload();
        }
      });
    });
  },
});

// biome-ignore lint/style/noNonNullAssertion: #root is defined in index.html
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
