import { createRoot } from "react-dom/client";
import App from "./App.tsx";

// Hinweis: KEIN StrictMode — der App nutzt eine requestAnimationFrame-Sim-Loop;
// StrictMode-Doppel-Mount (nur Dev) wuerde die Loop doppelt starten. Prod-Build
// ist davon ohnehin unberuehrt. (Migration v19.1 -> v29L.2, 2026-06-01)
createRoot(document.getElementById("root")).render(<App />);
