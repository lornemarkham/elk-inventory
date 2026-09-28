// ── /npi-list entry — TEMPORARY NPI demo, fully separate from the Inventory app ──
// /npi-list/referral-demo and /npi-list/opportunity are the separate synthetic
// referral-workflow POC (plus /npi-list/fax-settings); they load lazily and never touch the finder's state.
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import NpiApp from "./NpiApp";
import "./npi.css";

const ReferralDemo = lazy(() => import("./demo/ReferralDemo"));
const Opportunity = lazy(() => import("./demo/Opportunity"));
const FaxSettings = lazy(() => import("./demo/FaxSettings"));

const root = document.getElementById("root");
if (!root) throw new Error("No root element");

const path = location.pathname.replace(/\/+$/, "");
const page = path === "/npi-list/referral-demo" ? <ReferralDemo /> : path === "/npi-list/opportunity" ? <Opportunity /> : path === "/npi-list/fax-settings" ? <FaxSettings /> : <NpiApp />;
if (path === "/npi-list/referral-demo" || path === "/npi-list/opportunity" || path === "/npi-list/fax-settings") document.title = "AI Referral Workflow — Synthetic POC";

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={null}>{page}</Suspense>
  </StrictMode>
);
