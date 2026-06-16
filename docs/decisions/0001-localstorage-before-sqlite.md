# ADR-0001: localStorage Before SQLite

**Status:** Accepted  
**Date:** 2026-06-12  
**Deciders:** Lorne Markham

---

## Context

ELK Inventory is a local-first personal inventory tool built with Vite + React + TypeScript.

In Milestone 1, the app used hardcoded React state initialized from `src/data/inventory.ts` seed data. Any items added during a session were lost on page refresh. This was acceptable for an initial proof-of-concept but became a blocker for real usage.

The decision was: what persistence mechanism to add first?

Options considered:
1. `localStorage` — browser built-in key-value store, JSON serializable
2. SQLite via better-sqlite3 — embedded relational database, requires Node.js process
3. IndexedDB — browser-native structured storage, complex API
4. JSON file on disk — requires backend process (Node/Electron) to write
5. PocketBase or similar embedded backend — introduces a server dependency

---

## Decision

Use `localStorage` as the first persistence layer.

Implementation:
- Key: `"elk-inventory-items"`
- On app load: read from localStorage, parse JSON, fall back to seed data if missing or invalid
- On every item change: write full items array to localStorage as JSON
- Reset button: clear localStorage key, restore seed data

---

## Rationale

### 1. Zero infrastructure required
localStorage works in any browser without any additional tooling, server process, or configuration. Adding SQLite requires an Electron wrapper or a Node server — a significant scope increase for a feature (persistence) that should be simple.

### 2. Keeps the momentum going
The primary risk at Milestone 2 was scope creep. SQLite is the right long-term answer, but adding it means choosing an app container (Electron vs. Tauri vs. web server), setting up IPC or a local API, writing schema migrations, and restructuring the data layer. That is a multi-day effort.

localStorage is an afternoon.

### 3. Good enough for the current scale
ELK Inventory currently tracks ~50 items. Even at 10× growth (500 items), localStorage performs fine. The typical inventory record (with all fields) is well under 2KB. 500 items × 2KB = 1MB — localStorage's 5MB limit is not a concern for years.

### 4. Data portability is preserved
The existing Export JSON button serializes the localStorage state to a downloadable file. This ensures data is never trapped. If localStorage ever needs to be migrated to SQLite, the export → import path already exists.

### 5. Consistent with the "local-first, no overbuilding" mandate
The explicit project constraint is: local-first, no backend, no database yet. localStorage is the most local-first option available without introducing a native app wrapper.

---

## Trade-offs and Acknowledged Limitations

| Limitation | Severity | Mitigation |
|---|---|---|
| Data is tied to a single browser on a single machine | Medium | Export JSON serves as backup |
| 5MB localStorage limit | Low | Unlikely to hit at current or near-term scale |
| Not queryable — full JSON parse on every load | Low | Acceptable for ~500 items, revisit at scale |
| No relational integrity (zone IDs could drift) | Low | Validation at form level; seed data is authoritative |
| Lost if browser data is cleared | Medium | Export JSON before clearing; future: Electron will use file-based SQLite |
| No multi-device sync | Medium | Not a current requirement; future Electron + local API solves this |

---

## Migration Path to SQLite

When the time comes to move to SQLite, the path is clear:

1. User clicks "Export JSON" — downloads `elk-inventory-items.json`
2. Electron wrapper is introduced with better-sqlite3
3. Schema is created from the `InventoryItem` TypeScript interface
4. Import script reads the exported JSON and inserts into SQLite
5. React frontend is updated to call Electron IPC (or local REST) instead of localStorage
6. localStorage key is deprecated and eventually removed

This migration is low-risk because:
- The data shape is already defined as TypeScript types
- The export format is already implemented
- SQLite schema maps 1:1 to the existing fields
- The UI does not need to change — only the data layer

---

## When to Revisit

This decision should be revisited when any of these conditions are met:

- Item count exceeds 500 and load times are noticeable
- Multi-device access is needed (phone + desktop)
- Data loss from browser-clear occurs and is disruptive
- The team wants to build the ELK Inventory Service API (requires a queryable store)
- Pantry domain is introduced (expiry querying requires SQL)

---

## Related Decisions

- ADR-0002 (forthcoming): Electron vs. Tauri for native app wrapper
- ADR-0003 (forthcoming): SQLite schema design for multi-domain inventory
