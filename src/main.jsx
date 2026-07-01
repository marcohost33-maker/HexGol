import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// Hinweis: KEIN StrictMode — der App nutzt eine requestAnimationFrame-Sim-Loop;
// StrictMode-Doppel-Mount (nur Dev) wuerde die Loop doppelt starten. Prod-Build
// ist davon ohnehin unberuehrt. (Migration v19.1 -> v29L.2, 2026-06-01)
createRoot(document.getElementById("root")).render(<App />);

// PWA: register the app-shell service worker (public/sw.js) in Production only,
// base-URL-safe so it works on both Cloudflare root ("/") and the GH-Pages
// subpath ("/HexGol/"). Dev is intentionally skipped so Vite HMR is never
// shadowed by a cached shell. Errors are swallowed — SW is a progressive
// enhancement, never a hard dependency.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "/";
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {});
  });
}
