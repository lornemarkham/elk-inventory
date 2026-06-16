# Future Market and Pricing Tiers

**Status:** Early thinking — not a current priority  
**Last updated:** 2026-06-12

---

## Important Framing

This document exists to capture lightweight market thinking so it doesn't get lost. It is not a business plan. It is not a roadmap. It is not a priority.

**The current priority is building something genuinely useful for Lorne.**

When the product is excellent for personal use — when it creates real calm, saves real time, and answers real questions — then the market and pricing conversation becomes worth having.

Do not build toward a business model prematurely. A product built for a customer segment instead of for real personal need produces a worse product than one built to solve a real problem the founder has. The founder's problem comes first.

---

## The Current User: Lorne

Right now, the product has one user: Lorne.

The design decisions, feature priorities, and scope are all filtered through one question: **does this help Lorne reduce friction, track what he owns, and know what he's capable of?**

Everything in the product should pass that test first. When a feature or domain is genuinely useful for Lorne — proven through daily use — it probably solves a real problem for others like him.

---

## Who Else Has This Problem

The problem ELK Inventory solves is not unique to Lorne. It is shared by a specific type of person:

**The organized, capable, self-reliant person who manages more than most people and wants systems to match.**

Characteristics of this person:
- Owns real estate, tools, equipment, and a workshop or garage
- Active DIYer, hobbyist, or maker — not just a casual user
- Has multiple ongoing projects, responsibilities, and domains of life
- Cares about competence and self-reliance, not dependence on services
- Values time and hates wasted effort
- Would rather invest in organization than pay someone else to organize
- Probably has a garden, a pool, a vehicle they maintain, or some combination
- Interested in practical skills: mechanics, electronics, building, food prep
- Family-oriented — wants to be capable for their household, not just themselves

This market is not niche. It is underserved by software.

Existing tools are either:
- Too consumer-simple (home inventory apps for insurance purposes — minimal feature set)
- Too enterprise-complex (CMMS tools, asset management software for businesses — wrong audience, wrong price)
- Domain-specific only (pantry apps, tool checkout apps) — fragmented, no unified model

ELK Inventory's advantage: a unified model across domains, built by someone who genuinely uses it.

---

## Future Market Segments

In rough priority order, if the product ever expands beyond personal use:

### Segment 1: Workshop / Garage Makers
- Hobbyists, tinkerers, weekend warriors
- Have $5,000–$50,000 of tools and equipment
- Spend real time in the garage, on projects, on repairs
- Buy parts and tools regularly
- Know the pain of missing parts and misplaced tools
- Current market: no good tool-first inventory product exists for this segment

### Segment 2: Homesteaders and Rural Property Owners
- Own acreage, buildings, equipment
- Manage more complexity than urban homeowners
- Often grow food, raise animals, maintain equipment
- Have seasonal needs across multiple domains simultaneously
- Value self-reliance philosophically and practically
- Current market: farm management software is too agricultural/commercial; no personal homestead tool exists

### Segment 3: Self-Reliant Urban / Suburban Households
- Don't live on acreage, but manage more than average
- Active in the garden, pool, garage, pantry
- Care about preparedness without being preppers
- Family-oriented, organized, practical
- Current market: pantry apps, home inventory apps, tool tracking apps — all fragmented

### Segment 4: Preparedness-Minded Families
- Interested in being ready for disruptions (power outages, storms, supply interruptions)
- Not fear-driven — competence-driven
- Overlap significantly with homesteaders and self-reliant households
- Want to know: food buffer, water storage, power backup, first aid status
- Current market: prepper apps exist but are niche, fear-branded, and not well-designed

### Segment 5: Small Workshop / Maker Business
- Small fabrication shop, custom builder, repair service
- Need tool tracking, consumable management, project asset tracking
- Not a full CMMS, but more than personal inventory
- Current market: CMMS is expensive and complex; spreadsheets are the alternative

---

## Possible Future Pricing Tiers

*These are early-stage sketches. Not decisions. Not commitments. Not current architecture.*

### Free — Local Inventory
- Core inventory: items, zones, photos, search, filters
- One domain (e.g., garage)
- localStorage persistence
- Export JSON
- No account required
- This is ELK Inventory today

### Personal Pro — The Full System
Monthly subscription or one-time purchase.
- All domains (garage, pantry, pool, garden, etc.)
- Fuzzy search, duplicate detection
- Capability goals and gap reports
- Purchase intake (draft queue, receipt parsing)
- Multiple photos per item
- SQLite persistence (local app via Electron)
- AI-assisted decision support
- Smart purchase classification

### Household / Family
- Shared inventory across multiple users on a local network
- Roles: admin, contributor, view-only
- Mobile app for quick capture from anywhere in the house
- Shared pantry tracking with per-person preferences
- Household capability goals (not just one person's goals)

### Homestead / Property
- Extended domains: livestock, crops, harvest tracking, water systems, property assets
- Integration with weather and seasonal planning
- Garden-to-pantry tracking
- Property maintenance records
- Equipment service logs

### Workshop / Small Team
- Multi-user with check-in/check-out for tools
- Project-based asset assignment
- Low-stock alerts for consumables
- Order management integration

---

## What to Avoid in Future Market Thinking

**Don't build for the market before the personal use case is solved.** A product built for an imagined customer is always worse than a product built for a real problem you have. Lorne is the real problem.

**Don't tier-lock features that should be universal.** If fuzzy search or duplicate detection is genuinely useful, it should be in the free tier. Reserve paid tiers for features that require infrastructure (sync, AI API costs, multi-user) or deliver exceptional additional value.

**Don't brand this as a prepper product.** The preparedness market exists and overlaps with this product, but the brand should be about competence and capability, not fear or crisis. The tone that works for a wide audience: organized, practical, self-reliant, calm.

**Don't rush monetization.** A product that works for one person and delivers real value is worth more than a product that sort-of works for many people. Get the one-user experience right first.

---

## When to Revisit This Document

Revisit when:
- Lorne has been using the app daily for 3+ months and it's genuinely solving real problems
- At least 3 other people have used it and found it useful
- The core feature set (fuzzy search, capability goals, purchase intake, SQLite) is complete
- There's a clear, compelling story: "I built this because I had this problem, and here's how it solved it"

Until then: build for real use. Let the market story develop from real experience.
