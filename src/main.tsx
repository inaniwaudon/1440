import { registerSW } from "virtual:pwa-register";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Auto-reload the PWA as soon as a new service worker activates so iOS doesn't
// keep running stale JS from the home-screen cache after a redeploy.
registerSW({
  immediate: true,
  onRegisteredSW: (_url, registration) => {
    if (!registration) return;
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      if (!installing) return;
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
