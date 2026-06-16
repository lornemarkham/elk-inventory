import type { Collection } from "../types/inventory";

export const COLLECTIONS: Collection[] = [
  {
    id: "ryobi-tools",
    name: "Ryobi Tool Collection",
    description: "Ryobi 18V ONE+ cordless and corded power tools. High-use tools stay in garage; bulky or low-use tools move to Pool Shed.",
    tags: ["power", "woodworking", "mechanic"],
  },
  {
    id: "mechanic-tools",
    name: "Mechanic Tools",
    description: "Hand tools and diagnostic equipment for mechanical work. Motorcycle maintenance, small engine repair, and vehicle diagnostics.",
    tags: ["mechanic", "diagnostic", "automotive"],
  },
  {
    id: "electronics-components",
    name: "Electronics Components",
    description: "Microcontrollers, sensors, modules, and wiring materials for ELK Garden, automation, and electronics projects.",
    tags: ["electronics", "elk-garden", "sensor", "esp32", "raspberry-pi"],
  },
  {
    id: "solar-materials",
    name: "Solar Materials",
    description: "Connectors, cables, and hardware for solar installations. Primarily for ELK Garden solar work.",
    tags: ["solar", "elk-garden", "wiring"],
  },
  {
    id: "small-engine-kit",
    name: "Small Engine Learning Kit",
    description: "Engine, carburetor, and associated parts kept for small engine repair learning and practice.",
    tags: ["small-engine", "mechanic", "learning"],
  },
  {
    id: "vehicle-kit",
    name: "Vehicle Kit",
    description: "Emergency gear and tools that live in the vehicle.",
    tags: ["automotive", "power", "vehicle"],
  },
  {
    id: "shop-equipment",
    name: "Shop Equipment",
    description: "Standalone shop gear: vacuums, lifts, fuel cans, work lights.",
    tags: ["shop-equipment", "mechanic"],
  },
];
