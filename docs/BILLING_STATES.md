# Event bill states (4.28.2)

An event's `billing` is the agreed total bill, before GST.

| State | Stored as | Meaning |
|---|---|---|
| **Set** | `billing` ≥ ₹1 | The bill is agreed. Contribution, margin, pending and settlement use it. |
| **Not set** | `billing: 0` | The bill isn't known yet; meals, guests or rates are still being decided. |
| **Complimentary** *(not built)* | — | A deliberately free event. This needs the owner's approval before it is added. |

## Why 0 means "not set" today

- Before 4.28.2 the bill was compulsory and had to be at least ₹1, so no older record holds a real ₹0 bill.
- From 4.28.2 the event form refuses a typed **0** ("Leave it empty if the bill is not known yet"). An empty box is saved as 0 = not set.
- So `billing: 0` is never a confirmed ₹0 bill. The single test is `billSet(ev)` in `public/utils.js`: `billing > 0`.

## How an unset bill is treated

**On the event page**
- The bill shows *Not set*, and Pending, Contribution and Margin show *—*.
- There's no final settlement and no "received more than the bill" warning.
- Payment plans and reconciliation wait until the bill is set.

**On Home and in Reports** (`billingSplit` in `public/utils.js`)
- **Contribution and margin** cover events with a bill only: their bills, minus every expense except those on events without a bill. Expenses on no event (common stock, overheads) count as before.
- **Costs awaiting billing:** expenses of events without a bill are still recorded and included in total Expenses. They're shown separately and left out of contribution until the bill is set.
- **Received** includes every payment, including advances on events without a bill.
- **Pending** is what events with a bill still owe. An advance on an event without a bill never reduces another event's pending, and no pending amount is made up for an event whose bill isn't known.
- In **Reports**, events without a bill appear in *Contribution by event* as *no bill yet* with no amount. They're left out of *Biggest events*, the per-plate benchmarks and the menu bill averages.

**Payment receipts** for these events say "Total bill: to be confirmed" and treat the payment as an advance. They never say "Fully paid".

## Adding complimentary events later, without breaking anything

A free event must not reuse `billing: 0` by itself. If the owner approves the feature, it should add an explicit marker, for example `complimentary: true` alongside `billing: 0`, together with:

- validation in `db.js`
- a change to `billSet` so that `billSet(ev) || ev.complimentary` counts as a known bill (₹0 revenue, with its costs counted in contribution)
- a clear label wherever the bill is shown

Every existing `billing: 0` record (no marker) stays "not set", so nothing has to be migrated or guessed. No data-model decision made in 4.28.2 prevents this.
