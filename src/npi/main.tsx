// ── /npi-list entry — TEMPORARY NPI demo, fully separate from the Inventory app ──
// /npi-list/referral-demo and /npi-list/opportunity are the separate synthetic
// referral-workflow POC (plus /npi-list/fax-settings); they load lazily and never touch the finder's state.
// /npi-list/pms is the fake-PMS wrapper; /npi-list/embed/provider-intelligence is the
// iframe page its SDK (public/npi-sdk/provider-intelligence.js) opens.
// /npi-list/experiment is the observable / falsifiable experiment report (src/npi/experiment/*).
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import NpiApp from "./NpiApp";
import "./npi.css";

const ReferralDemo = lazy(() => import("./demo/ReferralDemo"));
const Opportunity = lazy(() => import("./demo/Opportunity"));
const FaxSettings = lazy(() => import("./demo/FaxSettings"));
const PmsApp = lazy(() => import("./pms/PmsApp"));
const EmbedPI = lazy(() => import("./pms/EmbedPI"));
const Experiment = lazy(() => import("./experiment/Experiment"));

const root = document.getElementById("root");
if (!root) throw new Error("No root element");

const path = location.pathname.replace(/\/+$/, "");
const PAGES: Record<string, [() => React.ReactNode, string]> = {
  "/npi-list/referral-demo": [() => <ReferralDemo />, "AI Referral Workflow — Synthetic POC"],
  "/npi-list/opportunity": [() => <Opportunity />, "AI Referral Workflow — Synthetic POC"],
  "/npi-list/fax-settings": [() => <FaxSettings />, "AI Referral Workflow — Synthetic POC"],
  "/npi-list/pms": [() => <PmsApp />, "ClinicDesk (fictional PMS) — Synthetic demo"],
  "/npi-list/embed/provider-intelligence": [() => <EmbedPI />, "Provider Intelligence"],
  "/npi-list/experiment": [() => <Experiment />, "Provider Intelligence — engineering experiment"],
};
const match = PAGES[path];
const page = match ? match[0]() : <NpiApp />;
if (match) document.title = match[1];

createRoot(root).render(
  <StrictMode>
    <Suspense fallback={null}>{page}</Suspense>
  </StrictMode>
);
