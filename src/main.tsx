import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import AuthGate from "./components/AuthGate";
import App from "./App";
import OfflinePlan from "./components/OfflinePlan";

const root = document.getElementById("root");
if (!root) throw new Error("No root element");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Outside the sign-in gate on purpose: it must open with no network. */}
        <Route path="/prepared/offline" element={<OfflinePlan />} />
        <Route path="*" element={<AuthGate><App /></AuthGate>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);

// Lets /prepared/offline load with no connection (network first, so an online
// visit is never served stale). Registered in production builds only.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("/prepared-sw.js").catch(() => {}); });
}
