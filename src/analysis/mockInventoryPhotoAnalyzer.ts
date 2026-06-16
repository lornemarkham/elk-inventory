// Mock analyzer — generates realistic-looking draft items without any AI.
// Used for UI development, demos, and testing the review queue workflow.
//
// To replace with real AI: implement InventoryPhotoAnalyzer in a new file and
// swap the export in src/analysis/index.ts.

import type { InventoryPhotoAnalyzer, DraftSuggestion } from "./analyzerTypes";

// ── Catalog of realistic workshop/garage items ────────────────────────────────

interface CatalogEntry {
  name: string;
  itemClass: string;
  domain: string;
  zone: string;
  notes: string;
}

const CATALOG: CatalogEntry[] = [
  {
    name: "Digital Multimeter",
    itemClass: "tool", domain: "electronics", zone: "mechanic-bay",
    notes: "Measures voltage, current, and resistance. Likely stored in a case with leads.",
  },
  {
    name: "Heat Gun",
    itemClass: "tool", domain: "workshop", zone: "center-island",
    notes: "Used for heat-shrink tubing, paint stripping, and thawing pipes.",
  },
  {
    name: "Fuse Kit — Assorted",
    itemClass: "material", domain: "electronics", zone: "mechanic-bay",
    notes: "Assorted automotive blade fuses. Various amperage ratings — ATC and mini.",
  },
  {
    name: "Ring Terminal Kit",
    itemClass: "material", domain: "electronics", zone: "elk-labs",
    notes: "Crimp-style ring terminals. Assorted gauge sizes. Check bag labelling.",
  },
  {
    name: "Wire Crimper",
    itemClass: "tool", domain: "electronics", zone: "mechanic-bay",
    notes: "Ratcheting wire crimper. Handles terminals up to 6 AWG. Keep clean.",
  },
  {
    name: "Solar Charge Controller",
    itemClass: "equipment", domain: "electronics", zone: "elk-labs",
    notes: "MPPT solar charge controller. Check amp rating and programming presets.",
  },
  {
    name: "Battery Shunt",
    itemClass: "equipment", domain: "electronics", zone: "elk-labs",
    notes: "Current monitoring shunt for battery bank. Log serial number and rated amps.",
  },
  {
    name: "10 AWG Wire — Red",
    itemClass: "material", domain: "electronics", zone: "elk-labs",
    notes: "Positive run wire for 12V DC. Check remaining spool length.",
  },
  {
    name: "Impact Driver",
    itemClass: "tool", domain: "workshop", zone: "mechanic-bay",
    notes: "Cordless impact driver. Check battery platform compatibility before use.",
  },
  {
    name: "Drill Bit Set — HSS",
    itemClass: "material", domain: "workshop", zone: "mechanic-bay",
    notes: "High-speed steel drill bits. Inspect for missing or broken bits before storing.",
  },
  {
    name: "Socket Set — Metric",
    itemClass: "tool", domain: "workshop", zone: "mechanic-bay",
    notes: "Metric socket set. Verify all sockets are accounted for in the tray.",
  },
  {
    name: "Cable Ties — Assorted",
    itemClass: "material", domain: "electronics", zone: "elk-labs",
    notes: "Black nylon zip ties. Multiple lengths and widths. UV-rated for outdoor use.",
  },
  {
    name: "Hex Key Set",
    itemClass: "tool", domain: "workshop", zone: "mechanic-bay",
    notes: "Metric hex/Allen key set. Folding style. Includes T-handle for torque.",
  },
  {
    name: "LED Work Light",
    itemClass: "equipment", domain: "workshop", zone: "center-island",
    notes: "Portable rechargeable LED work light. Check charging status before storing.",
  },
  {
    name: "Torque Wrench",
    itemClass: "tool", domain: "workshop", zone: "mechanic-bay",
    notes: "Click-type torque wrench. Store with setting at minimum to protect spring.",
  },
  {
    name: "Soldering Iron — Temp Controlled",
    itemClass: "tool", domain: "electronics", zone: "elk-labs",
    notes: "Temperature-controlled soldering iron. Check tip condition and replace if oxidised.",
  },
  {
    name: "MC4 Connector Kit",
    itemClass: "material", domain: "electronics", zone: "elk-labs",
    notes: "Solar panel MC4 connectors. Male + female pairs. Use correct crimping tool.",
  },
  {
    name: "Cable Lug Kit",
    itemClass: "material", domain: "electronics", zone: "elk-labs",
    notes: "Copper cable lugs for battery terminals. Crimp or solder style. Assorted gauges.",
  },
  {
    name: "Pry Bar Set",
    itemClass: "tool", domain: "workshop", zone: "mechanic-bay",
    notes: "Flat and angled pry bars. Useful for trim removal and engine bay work.",
  },
  {
    name: "Funnel Set",
    itemClass: "tool", domain: "workshop", zone: "mechanic-bay",
    notes: "Various size plastic funnels for fluid changes. Clean and dry before storing.",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Mock implementation ───────────────────────────────────────────────────────

export const mockInventoryPhotoAnalyzer: InventoryPhotoAnalyzer = {
  name: "Mock Analyzer (No AI)",
  isReal: false,

  async analyzeInventoryPhotos(files: File[]): Promise<DraftSuggestion[]> {
    // Simulate processing delay proportional to photo count
    await new Promise(r => setTimeout(r, 900 + files.length * 250));

    const used = new Set<string>();
    const results: DraftSuggestion[] = [];

    for (const file of files) {
      // Convert each file to a base64 data URL so it survives page refresh
      const dataUrl = await fileToDataUrl(file);

      // Generate 1–2 draft items per photo
      const count = Math.random() < 0.6 ? 1 : 2;

      for (let j = 0; j < count; j++) {
        // Prefer unused catalog entries to avoid duplicates
        const available = CATALOG.filter(c => !used.has(c.name));
        const pick = available.length > 0 ? pickRandom(available) : pickRandom(CATALOG);
        used.add(pick.name);

        const confidence = parseFloat((0.42 + Math.random() * 0.52).toFixed(2));

        results.push({
          sourcePhotoUrl: dataUrl,
          sourcePhotoName: file.name,
          suggestedName: pick.name,
          itemClass: pick.itemClass,
          domain: pick.domain,
          zone: pick.zone,
          container: null,
          quantity: 1,
          notes: pick.notes,
          confidence,
        });
      }
    }

    return results;
  },
};
