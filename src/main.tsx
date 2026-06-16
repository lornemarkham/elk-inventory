import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AuthGate from "./components/AuthGate";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("No root element");

createRoot(root).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>
);
