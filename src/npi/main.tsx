// ── /npi-list entry — TEMPORARY NPI demo, fully separate from the Inventory app ──
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import NpiApp from "./NpiApp";
import "./npi.css";

const root = document.getElementById("root");
if (!root) throw new Error("No root element");

createRoot(root).render(
  <StrictMode>
    <NpiApp />
  </StrictMode>
);
