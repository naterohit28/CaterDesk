# Menu sourcing and purchase orders — technical design (v4.27.1)

Status: proposed, for owner approval before implementation. Scope: menu sourcing and basic purchase-order preparation
only. No inventory, stock accounting, automatic supplier choice or quantity prediction.

## 1. What exists today

| Area | Today |
|---|---|
| Dish | `ev.dishes[]`: `name`, `meal`, `svc?`, `head`, `cat?`, `type?`, `diet?`. `head` is the only sourcing field: `''` = our kitchen, a Live Counter head (e.g. `Chaat – चाट`) = that counter. |
| Editors | Meal sheet: per-dish "made by" select (Our kitchen + counter heads). Text editor: dish names per meal; a dish keeps its head by name. |
| Vendor orders | `ev.orders[]`, one per counter **and** meal (`head`, `svc`, `venId`, `plates`, `messages[]`, `status`, `menuChanged`). Rows come from `counterRows()` (dishes grouped by `head`, kitchen excluded). |
| Change flags | `ordersHit()` flags a sent order when its dishes (name, meal, type, diet) change. Nothing is resent. |
| Approved menus | `menuApproved[]` snapshots keep `head` (internal). `menuDiff()` counts a **counter change** as a client change today. |
| Client documents | Show names, meals and diet marks only; never `head`, vendors or costs. |
| Expenses | An expense links to one order with `x.order = o.id`; the order is "billed" when one exists. Never created automatically. |

## 2. Data-model changes (all optional fields; nothing renamed or removed)

**Dish:** new optional `src`:

| Sourcing | Stored as | Old data |
|---|---|---|
| Our Kitchen | no `src`, `head: ''` | unchanged meaning |
| Vendor Counter | no `src`, `head: '<counter>'` | unchanged meaning |
| Buy Ready-Made | `src: 'buy'`, `head: ''` | new |
| Buy & Finish | `src: 'finish'`, `head: ''` | new |

A dish with `src` never has a counter `head`, so counter rows and vendor orders ignore it automatically. Absent `src`
keeps today's meaning: no old dish is reclassified.

**Event:** new optional `purchases[]`, kept apart from `orders[]` (counter service orders stay as they are):
`{ id, svc?, item, src, venId?, qty, unit, date, time?, notes?, estCost?, status, messages[], at, basis, changed? }`

- `unit`: pcs, kg, litre, packet, bottle, carton, tub, box.
- `status`: prepared → opened → sent → confirmed → delivered (or cancelled); `messages[]` reuses the order
  message-history helpers (`addOrderMessage` / `markOrderMessage`).
- `basis`: what the order was made for (`item`, `src`, `meal`), used to flag later changes.
- `estCost`: an estimate shown on the order only; never added to costs or profit.

**Expense:** new optional `purchase` (a purchase id), the same pattern as `order`. An expense links to an order **or**
a purchase, never both; a purchase links to at most one expense. Linking never creates or changes an amount.

## 3. Behaviour

- **Menu editor:** the dish's "made by" select gains *Buy ready-made* and *Buy & finish*. No supplier, quantity or
  unit is asked there. Category, food type and diet marks stay independent of sourcing.
- **Event page, Menu & orders:** a **To buy** list per meal (bought items), each with **Order**. The purchase sheet
  picks a supplier from the vendor directory (GSTIN shown when known), quantity, unit, delivery date/time (pre-filled
  from the meal), instructions and an optional estimated cost; then WhatsApp with the same message history, status
  steps and "Remind / Confirmed" pattern as vendor orders.
- **Bills:** a delivered purchase offers "Record / link its bill": pick an unlinked expense from that supplier or
  open a pre-filled expense. Nothing is recorded automatically; one bill per purchase, so no double counting.
- **Changes after sending:** if the item is removed, renamed, moved to another meal or its sourcing changes after a
  purchase was sent, the purchase is flagged *Menu changed · review*. Never resent automatically.
- **Approved menus and client documents:** sourcing is internal. Snapshots keep `src` with each dish (history), but
  sourcing and counter changes no longer count as changes needing client approval; the versions view lists them as
  "internal" separately. Client documents never show sourcing. Issued documents and old snapshots are untouched.
- **Function sheet:** bought items listed per meal with supplier, quantity and unit.

## 4. Backward compatibility

- Old events, dishes, orders, approved menus, sent documents, expenses and backups restore and display unchanged
  (no `src`, `purchases` or `purchase` fields are added unless the user uses the feature).
- Restore validation: `src` ∈ {buy, finish} and then `head` must be `''`; `purchases[]` fields checked (positive
  quantity, known unit, valid dates, amounts with two decimals); `x.purchase` must point to a purchase of the same
  event; an expense with both `order` and `purchase` is refused.
- Older app versions opening newer data: unknown fields are kept; a bought dish looks like a kitchen dish there.

## 5. Implementation sequence (one release, separate commits, each with tests)

1. Guest count first (already built on this branch).
2. Dish `src` in the data model, restore checks and both editors; client documents unchanged.
3. Approval diff: sourcing/counter changes become internal (not client changes).
4. Purchase orders: list, sheet, WhatsApp history, status, reminders, function sheet.
5. Bill linking for purchases, with the one-bill rule.
6. Change flags for sent purchases.
7. Tests for the ten scenarios in the brief, full suite, Codex review.

## 6. Decision needed

The owner asked for this in v4.27.1 together with the guest count. It is a feature-sized change, so it is numbered
**4.28.0** unless the owner prefers 4.27.1. The guest-count change could also ship first, on its own, as 4.27.1.
