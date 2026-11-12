#!/usr/bin/env node
/* Read-only check of a CaterDesk backup for labour expenses affected by the v4.0.1 event-edit bug.
   Editing an event in 3.3.0–4.0.1 dropped its menu, orders and labour sheet. The labour sheet's
   expenses stayed but lost their link (`labour.expIds`), and entering the sheet again created a
   second expense for the same work. This tool only reads the file and prints what it finds; it
   never changes the backup or the app. Menus and orders that were dropped leave no trace in the
   data, so they can only be recovered from a backup taken before the edit.

   Usage:  node tools/audit-labour.cjs <backup.json> [--summary]
           --summary prints counts and amounts only (no event or item names). */
const fs = require('node:fs');

const SHEET_NOTE = /^Labour sheet:/;   // notes written on every expense the labour sheet saves
const money = n => Math.round((Number(n) || 0) * 100) / 100;

function auditLabour(backup) {
  if (!backup || !Array.isArray(backup.events) || !Array.isArray(backup.expenses)) throw new Error('Not a CaterDesk backup (events/expenses missing)');
  const events = new Map(backup.events.map(e => [e.id, e]));
  const expenses = backup.expenses.filter(x => !x.draft);
  const byId = new Map(expenses.map(x => [x.id, x]));
  const linked = new Set(), brokenLinks = [];
  for (const e of backup.events)
    for (const [key, id] of Object.entries(e.labour?.expIds || {})) {
      if (byId.has(id)) linked.add(id); else brokenLinks.push({ eventId: e.id, key, expenseId: id });
    }
  const sheetMade = expenses.filter(x => SHEET_NOTE.test(x.notes || ''));
  // Orphaned: written by a labour sheet, but no event's sheet points to it any more
  const orphaned = sheetMade.filter(x => !linked.has(x.id)).map(x => ({ expenseId: x.id, eventId: x.evId, cat: x.cat, head: x.head, amt: money(x.amt), date: x.date, sheetOnEvent: !!events.get(x.evId)?.labour?.rows?.length }));
  // Possible duplicates: same event and item, two or more sheet-written expenses (the bug's re-entry pattern)
  const groups = new Map();
  for (const x of sheetMade) { const k = `${x.evId}|${x.cat}|${x.head}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const duplicates = [...groups.values()].filter(g => g.length > 1).map(g => ({ eventId: g[0].evId, cat: g[0].cat, head: g[0].head,
    expenses: g.map(x => ({ expenseId: x.id, amt: money(x.amt), date: x.date, linked: linked.has(x.id) })), possibleExtra: money(g.reduce((s, x) => s + (Number(x.amt) || 0), 0) - Math.max(...g.map(x => Number(x.amt) || 0))) }));
  // Events whose sheet disappeared: sheet-written expenses exist but the event has no sheet now
  const lostSheets = [...new Set(orphaned.filter(o => !o.sheetOnEvent).map(o => o.eventId))].filter(id => events.has(id));
  return {
    events: backup.events.length, expenses: expenses.length, sheetExpenses: sheetMade.length, linkedSheetExpenses: linked.size,
    orphaned, orphanedTotal: money(orphaned.reduce((s, o) => s + o.amt, 0)), duplicates,
    possibleDuplicateAmount: money(duplicates.reduce((s, d) => s + d.possibleExtra, 0)), lostSheets, brokenLinks
  };
}

function print(report, backup, summary) {
  const name = id => summary ? '(event)' : (backup.events.find(e => e.id === id)?.name || id);
  const L = [];
  L.push(`Events: ${report.events} · expenses: ${report.expenses} · written by labour sheets: ${report.sheetExpenses} (still linked: ${report.linkedSheetExpenses})`);
  L.push(`Orphaned labour-sheet expenses: ${report.orphaned.length} · total ₹${report.orphanedTotal}`);
  L.push(`Events whose labour sheet disappeared: ${report.lostSheets.length}`);
  L.push(`Possible duplicate groups: ${report.duplicates.length} · possible extra amount ₹${report.possibleDuplicateAmount}`);
  L.push(`Broken sheet links (pointing to a deleted expense): ${report.brokenLinks.length}`);
  if (!summary) {
    for (const d of report.duplicates) L.push(`  DUPLICATE? ${name(d.eventId)} · ${d.head}: ${d.expenses.map(x => `₹${x.amt} on ${x.date}${x.linked ? ' (linked)' : ' (unlinked)'}`).join(' + ')}`);
    for (const o of report.orphaned) L.push(`  ORPHANED  ${name(o.eventId)} · ${o.head}: ₹${o.amt} on ${o.date}${o.sheetOnEvent ? '' : ' (event has no labour sheet now)'}`);
  }
  L.push('Nothing was changed. Review each item in the app before deleting or editing any expense.');
  return L.join('\n');
}

module.exports = { auditLabour, print };

if (require.main === module) {
  const file = process.argv[2]; const summary = process.argv.includes('--summary');
  if (!file) { console.error('Usage: node tools/audit-labour.cjs <backup.json> [--summary]'); process.exit(2); }
  const stat = fs.statSync(file); if (stat.size > 200 * 1024 * 1024) { console.error('Backup larger than 200 MB; refusing to read.'); process.exit(2); }
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(print(auditLabour(backup), backup, summary));
}
