export type ZoneId =
  | "elk-labs"
  | "mechanic-bay"
  | "center-island"
  | "strength-zone"
  | "elk-lounge"
  | "pool-shed"
  | "truck-kit"
  | "garden"
  | "storage-room-pantry"
  | "unknown";

export type ZonePriority = "prime" | "secondary" | "storage" | "installed";

export interface Zone {
  id: ZoneId;
  name: string;
  purpose: string;
  notes: string;
  photoPath: string;
  priority: ZonePriority;
}

export type ItemClass =
  | "tool"
  | "material"
  | "equipment"
  | "project-asset"
  | "installed-asset"
  | "surplus";

export type LifecycleState =
  | "available"
  | "in-use"
  | "reserved"
  | "ordered"
  | "needs-repair"
  | "retired"
  | "deprecated"
  | "consumed"
  | "lost"
  | "sort-required"
  | "incorrect-part"
  | "surplus";

export const ALL_TAGS = [
  "automation",
  "automotive",
  "barbell",
  "bodyweight",
  "camera",
  "carburetor",
  "connector",
  "connectors",
  "diagnostic",
  "dumbbells",
  "electronics",
  "elk-garden",
  "elk-wrench",
  "enclosure",
  "engine",
  "engine-part",
  "esp32",
  "fabrication",
  "fasteners",
  "fitness",
  "fuel",
  "garage-gym",
  "hardware",
  "home-renovation",
  "ignition",
  "jump-starter",
  "learning",
  "measurement",
  "mechanic",
  "mobility",
  "mounting",
  "motorcycle",
  "obd",
  "organization",
  "pool",
  "power",
  "raspberry-pi",
  "recovery",
  "sensor",
  "shop-equipment",
  "small-engine",
  "solar",
  "sort-required",
  "strength",
  "temperature",
  "weatherproofing",
  "wiring",
  "woodworking",
  "wrong-part",
  "yard",
] as const;

export type Tag = (typeof ALL_TAGS)[number];

export interface Collection {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface Container {
  id: string;
  name: string;
  description: string;
  zoneId: ZoneId;
  color: string;
}

// ── Extended metadata fields ───────────────────────────────────────────────────

export type PhotoType = "inventory" | "group" | "zone";

export type PowerType =
  | "battery"
  | "corded"
  | "gas"
  | "manual"
  | "battery+corded";

export type BatteryPlatform =
  | "ryobi-one+"
  | "milwaukee-m18"
  | "milwaukee-m12"
  | "dewalt-20v"
  | "makita-18v"
  | "other";

// Top-level inventory domain — sits above class/zone/collection
export type InventoryDomain =
  | "workshop"
  | "electronics"
  | "fitness"
  | "food-storage"
  | "kitchen-preserving"
  | "garden"
  | "pool"
  | "vehicle"
  | "household"
  | "project"
  | "unknown";

export interface InventoryItem {
  id: string;
  name: string;
  itemClass: ItemClass;
  lifecycleState: LifecycleState;
  currentZone: ZoneId;
  recommendedZone: ZoneId;
  locationDetail: string;
  collectionId: string | null;
  containerId: string | null;
  project: string | null;
  tags: string[];
  quantity: number;
  photoPath: string;
  notes: string;

  // Top-level domain (optional — enables multi-domain life inventory)
  domain?: InventoryDomain;

  // Flexible per-domain attributes (e.g. expiryDate, jarSize, unit, calories…)
  attributes?: Record<string, string | number | boolean>;

  // Extended metadata (optional — populated as known)
  brand?: string;
  category?: string;
  subcategory?: string;
  powerType?: PowerType;
  batteryPlatform?: BatteryPlatform;
  photoType?: PhotoType;

  // Timestamps (ISO 8601 strings — absent on legacy seed items)
  createdAt?: string;
  updatedAt?: string;

  // Provenance — set when this item was approved from a Purchase Intake draft.
  // See docs/purchase-intake-v1-spec.md and src/types/purchase.ts.
  sourceDraftId?: string;
}
