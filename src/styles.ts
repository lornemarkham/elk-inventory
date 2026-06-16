// Garage notebook — readable from a few feet away
export const C = {
  // Backgrounds
  bg:       "#1c1a17",
  bgCard:   "#242118",
  bgInset:  "#181614",
  bgInput:  "#141210",

  // Borders
  border:   "#3a3528",
  borderLo: "#282420",

  // Text — high contrast, no tiny grey on black
  text:     "#e8e2d8",   // off-white, main body
  textMid:  "#b0a898",   // secondary labels
  textDim:  "#7a7068",   // truly dim, used sparingly

  // Accents
  red:      "#c04020",   // toolbox red / prime
  amber:    "#c48c28",   // warm amber / ordered / selected
  green:    "#5a8c42",   // available / garden
  blue:     "#4278a0",   // ELK Labs / in-use
  purple:   "#7a52a0",   // project
  brown:    "#8a5828",   // warm brown / storage

  // Item class
  tool:             "#c04020",
  material:         "#5a8c42",
  equipment:        "#4278a0",
  projectAsset:     "#c48c28",
  installedAsset:   "#7a52a0",
  surplus:          "#6a4820",
} as const;

export const CLASS_COLORS: Record<string, string> = {
  tool:             C.tool,
  material:         C.material,
  equipment:        C.equipment,
  "project-asset":  C.projectAsset,
  "installed-asset":C.installedAsset,
  surplus:          C.surplus,
};

export const CLASS_LABELS: Record<string, string> = {
  tool:             "Tool",
  material:         "Material",
  equipment:        "Equipment",
  "project-asset":  "Project Asset",
  "installed-asset":"Installed Asset",
  surplus:          "Surplus",
};

export const STATE_COLORS: Record<string, string> = {
  available:        C.green,
  "in-use":         C.blue,
  reserved:         C.amber,
  ordered:          C.amber,
  "needs-repair":   C.red,
  retired:          C.textDim,
  deprecated:       C.textDim,
  consumed:         C.textDim,
  lost:             "#8a2020",
  "sort-required":  C.amber,
  "incorrect-part": "#8a2020",
  surplus:          C.brown,
};

export const ZONE_COLORS: Record<string, string> = {
  "elk-labs":      C.blue,
  "mechanic-bay":  C.red,
  "center-island": C.amber,
  "strength-zone": "#7a3a98",
  "elk-lounge":    "#3a7868",
  "pool-shed":     C.brown,
  "truck-kit":          C.amber,
  garden:               C.green,
  "storage-room-pantry":"#7a8c42",
  unknown:              C.textDim,
};

export const PRIORITY_COLORS: Record<string, string> = {
  prime:     C.red,
  secondary: C.amber,
  storage:   C.textDim,
  installed: C.green,
};

export const PRIORITY_LABELS: Record<string, string> = {
  prime:     "Prime Zone",
  secondary: "Secondary",
  storage:   "Storage",
  installed: "Installed",
};
