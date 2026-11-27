# CaterDesk product roadmap

**Status:** live version 5.5.0. In review: 5.6.0 (event closing report, pending work on Home, quick events, Hinglish, cooking assignments per service, wider expense items, 5.5.0 phone fixes). Updates ship in batches of 3–4 (owner, 27 Nov). Next: v6 voice and typed entry (see below), after the owner's review of 5.6.0. Each release also adds one plain-language line to the in-app "What's new" (`WHATS_NEW` in app.js). Development resumed on 26 Nov 2026 under the owner's final development directive. Engineering rules: [AGENTS.md](../AGENTS.md).

## Objective
Make CaterDesk a compact, reliable catering operations and money app that cuts paperwork, admin time, repeated entry and forgotten transactions for independent Indian caterers (operators aged 40–70, coming from paper, Excel and WhatsApp).

**Capture once. Reuse information. Verify before saving.**

A feature is a priority only if it:
- makes recording faster or easier;
- prevents wrong or duplicate entries; or
- finds missing records before they distort the reports.

## What already exists (improve it, don't rebuild it)
- **Events and menus:** events, venues, meal-wise guests and menus; client-approved menu versions.
- **Quotes:** quotations with options, revisions, discounts, extras, acceptance and GST.
- **Menu library:** packages; the owner's 47-section dish card is in the library.
- **Orders:** counter orders per meal and counter (prepared, opened, sent, confirmed, delivered); purchases; WhatsApp messages with no client data; reminders.
- **Vendors:** vendors with categories and specialities, one-time vendors, ledgers, bills to pay, payments and credit notes.
- **Labour:** sheets by worker type and shift, a contractor per line, rates that arrive later with the bill, a Pay button per contractor.
- **Expenses:**
  - quick add on Home;
  - **Snap a bill** creates a bill-photo draft to fill later;
  - shared bills split across events, plus common stock;
  - one bill can cover several orders.
- **Client money:** receipts, advances and payment plans (milestones).
- **Event closing:** guest-count changes with evidence and approval, settlement, reconciliation with history, the books check, cost per plate and learning from past events.
- **Safety:** works offline, encrypted backup and restore, recovery key.

## Lessons from the owner's planning spreadsheet
The owner's spreadsheet was checked read-only, outside this repository, in Nov 2026. No figures or names from it are recorded here. It shows patterns CaterDesk must handle:
1. **English and Marathi copies of an event disagree on critical numbers,** such as a meal's guest count.
   - These may be revisions rather than mistakes.
   - So: one confirmed number per meal, with every language text generated from it or flagged when it differs.
2. **Final amounts are hand-adjusted inside formulas.**
   - Extra guests are added into a meal line; extras are summed by hand.
   - A tax line is typed as a figure rather than calculated.
   - Advances are summed by hand.
   - So: quoted, extra, negotiated and final amounts stay separate and recorded, and a payment plan is never treated as money received.
3. **The production sheet** carries:
   - per-meal guest counts;
   - who supplies each item, with counter quantities below the guest count;
   - shorthand quantities (for example `5+2`, `1 1/2 ladi`, `500pcs`);
   - equipment and buffet notes.
   So: free-text quantities and units are kept exactly as written, and orders are drafts until sent or confirmed.
4. **The cost sheet compares several events side by side,** and some costs never reach the event totals:
   - one is typed straight into the total column, against no event;
   - another is entered per event but sits outside the event-total formula's range.
   - So: every cost must appear in the business total; unallocated and common costs are shown, never dropped; a shared bill is counted once.
5. **Several events often fall on the same date**, with common suppliers and contractors.

## Roadmap (version numbers are directional)

| Version | Priority | Notes |
|---|---|---|
| **5.2.0** | Faster recording: quick add, shorter expense entry, photo-first capture | Small steps, each shipped on its own. **Shipped:** one-tap "Usual items" in the expense form (5.2.0) |
| 5.2.x | Meals, menus and sourcing as caterers actually work (owner's additional requirements, 26 Nov) | In order, each step its own small PR (details below). **Shipped:** meal headings (5.2.1), Ice and Milk & Dairy (5.2.2), dish sourcing never guessed from the name (5.3.1) |
| 5.2.x | Category-wise multi-item supplier orders (grocery, vegetables, dairy…) | Item, quantity and free unit (kg, litre, packet, box, dozen, ladi); one WhatsApp message per order; prepared → sent → confirmed → delivered/cancelled; revisions, shortages, an estimated then actual bill; one invoice may cover several orders or events. Keep counter orders as they are. No recipe costing |
| **5.3.0** | Home = today's work | **Shipped (5.3.0, 5.6.0):** 5.6.0 adds Pending work (cooks and orders to confirm, labour without a rate, events to reconcile). **First step (5.3.0):** a Today card (today's and tomorrow's events with orders to confirm, no labour list, balance to collect), then the quick actions and to-do cards; the money overview moved below. Later steps: Today's and tomorrow's events, orders to confirm, deliveries, unfinished photos, expected costs not recorded, labour to complete, collections due, payments due, events to reconcile, backup reminder. Built from real records only |
| **5.4.0** | Suppliers and labour contractors easier to use | **Shipped first step (5.4.0):** Suppliers \| Contractors lists with their own totals, contractors grouped by worker type, the owner's labour types added. **5.4.1:** cooking labour (Chinese, sweets, starters, roti, cooks) by order: people, labour for the job and transport, no shifts; Rojiya, Ghati, Boys stay by shift. | Tell vendors and contractors apart; worker types with usual rates; requested vs actual attendance; extras and transport; searchable ledgers. Keep the current contractor accounting. No payroll or HR |
| **5.6.0** | Event Financial Closure Report (done in 5.6.0: per event, provisional until reconciled) and consolidated reports | Printable report built on the existing calculations: final bill, receipts, costs by category and supplier, labour by contractor, payables, shared and unallocated costs, estimated vs actual, cost per plate, contribution (not company profit), reconciliation status |
| **6.0.0** | Voice and typed natural-language entry | Speak or type → interpret → review → confirm → save. See the rules below |
| 6.x | Compact event workspace, Simple/Full view, multi-event coordination | Simple and Full show the same records |
| Later | Excel export (and later import), optional AI document reading, sync and multi-user, commercial setup | |

### 5.2.x: meals, menus and sourcing (owner's additional requirements, 26 Nov 2026)
Principle: CaterDesk must follow how a caterer works, not make the caterer follow the software's assumptions. Keep historical records readable and editable, keep the financial engine, keep the interface compact.
1. **Meal headings (done in 5.2.1).**
   - English, Hindi and Marathi headings with short forms, guest counts, times and descriptors are recognised.
   - A heading that can't be read is flagged, and its dishes are never silently added to the meal above.
2. **Ice and Milk & Dairy as separate expense items (done in 5.2.2)** (Milk & Dairy: milk, paneer, curd, cream, cheese, butter, mawa, khoya, basundi, buttermilk; Ice: blocks, cubes, crushed, ladi).
   - Old "Ice + Milk" records stay as they are: readable, editable, reportable. Their amounts are never split by guessing.
   - The combined item leaves new-entry suggestions.
   - Drinking water, water tankers and oil/ghee stay separate.
3. **Sourcing is never decided by the dish name alone (first step done in 5.3.1:** no keyword guessing; confirmed choices of every kind remembered; Specialist Cook labour type).
   - A starter is a menu course, not automatically a live counter.
   - Each dish supports:
     - our kitchen;
     - our staff cooking at the venue;
     - bought ready-made;
     - bought semi-prepared or frozen and finished by us;
     - part bought, part ours;
     - an outsourced counter or service.
   - Remember confirmed choices and suggest them later; a suggestion stays editable.
   - With no reliable preference, don't assume "outsourced" from a keyword. Review `DISH_WORDS`, `dishCounter()`, `learnedDishes()` and the supplier suggestions.
   - Money follows what actually happened:
     - starter ingredients are raw material;
     - frozen or semi-prepared starters are purchased food;
     - a specialist starter cook is labour (Starter cook);
     - Live Counter only when genuinely outsourced.
   - Keep existing Starter-counter records and supplier links.
4. **All five meals equal:** breakfast, lunch, high tea, dinner and late night each support:
   - guests, date and time;
   - a menu, plus adding and removing dishes;
   - every sourcing method and specialist labour;
   - vendor orders, delivery status and amendment history.
   Reuse the existing meal-service model; one workflow for every meal.
5. **(Done in 5.5.0: preview marked, then straight on to kitchen and orders.) Menu selection:** make the difference between previewing a library menu and the event's saved dishes obvious, and let the user confirm and go straight to kitchen and orders in few taps. Never create supplier commitments from an unconfirmed menu.
6. **(Done in 5.5.0.) Meal-wise kitchen and function sheet:** for each meal, show:
   - time and guests;
   - our kitchen, cooking at the venue, specialist cooks;
   - ready-made purchases, frozen or semi-prepared to finish;
   - outsourced counters, supplier orders and delivery status.
   No automatic labour costs, no production or recipe database.
7. **(Search by everyday names done in 5.5.0.) Expense items:** keep 6 primary categories, with aliases, search and progressive disclosure for wider coverage. Keep expense heads, supplier specialities, labour roles, menu courses and procurement items distinct. No ingredient-level money categories.
8. **Optional, editable menu templates** (**breakfast and high tea done in 5.3.2** from the owner's rate card; late night, Punjabi and fasting added in 5.5.0 without a price; Maharashtrian and South Indian were already there), with no fixed prices or compulsory rules.
9. **(Several items in one supplier order done in 5.5.0.) Connect to the multi-item supplier orders** (one frozen-food supplier, several starter items, one order) and to v6 voice.

**An order is not an expense, and an assigned cook is not a confirmed labour cost.** Raw ingredients, purchased prepared food, specialist labour, outsourced services, orders, bills and settlements stay distinct.

**Known maintenance issue:** the Expenses tab's **To pay** list draws every unpaid bill at once. A stress audit measured about 15 s at 5,000 expenses; the slowdown grows with the number of **unpaid** bills. It is deferred because the owner's real volume is far below that. Fix it with a page-by-page list (totals still from all data) if real volume grows.

## v6 voice and typed entry: agreed rules
- **The foundation is a Quick entry text box** (typing or the keyboard's 🎤). A microphone button appears where the browser supports speech.
- **Voice is online-first;** offline speech is a fallback only. Phone tests in Nov 2026:
  - Chrome and Brave both recognise English, Hindi and Marathi online;
  - offline, only English works with the page microphone;
  - Hindi and Marathi offline work through the keyboard 🎤, in English letters.
- **Every result goes to review,** and the existing forms save it.
  - Never auto-save or auto-send.
  - **Speech never decides the payment status on its own.**
    - A clear word such as उधार or "credit" may pre-select it.
    - A possibly misheard word such as उधर, or no word at all, leaves paid/credit unanswered and asks.
    - The user always confirms before saving.
  - An advance is a client payment, never the bill.
  - "N waiters…" opens the labour sheet.
  - **"paid X to <vendor>" can mean two things,** and the app must tell them apart by context and confirmation:
    - settling an existing unpaid bill;
    - a new expense paid on the spot.
    If the vendor has unpaid bills, propose the settlement and offer "new expense" as one tap. If not, propose a new paid expense. Always confirm.
  - Two events on one date, or two vendors with the same name, are always asked about.
- **Amounts may arrive as** digits, words, "साडेआठ हजार", "dedh hazaar" or "8:30 hajar" (= ₹8,500).
- **No paid speech or AI service without the owner's approval.** Tell the user once that online speech goes to the browser's speech service.
- **The live site blocks the microphone** (`Permissions-Policy: microphone=()` in `vercel.json`). Change it to `microphone=(self)` in its own reviewed PR, then test inside the installed app.

## Building towards AI (owner, 26 Nov 2026)
Every release should lay a little of the foundation for later intelligence, without adding complexity now:
reusable business rules, personal sourcing and supplier preferences learned from confirmed choices, one set of
English / Hindi / Marathi terms, and checks that catch a wrong or incomplete entry before it is saved. A later
"CaterDesk Intelligence" stage (v7+) is proposed, not planned.

**Owner request (26 Nov 2026), done in 5.3.3:** an event must not look finished or profitable while its costs are
incomplete. Reconciling should warn when the usual costs (from `costChecklist`) or the labour cost are missing, and the
event and its contribution should say "costs incomplete", not only "provisional".

## Explicitly deferred
Recipe-level costing; compulsory inventory; automatic procurement; payroll and HR; CRM pipelines; universal spreadsheet import; automatic WhatsApp sending; cloud and multi-user before there is demand; large visual redesigns; AI features without a clear recording benefit.

## Decisions on earlier conflicts (settled by the owner, 26 Nov 2026)
1. **Offline audio recordings: deferred** until structured voice entry is working. CaterDesk keeps no audio until then.
2. **Home = today's work: approved for 5.3.0.**
3. **The Google AI Studio prototype:**
   - reuse its UX and voice-processing ideas;
   - do not reuse its accounting engine, its "reconciled profit" rule, its labour save or its database.
