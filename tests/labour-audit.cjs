// Read-only labour audit tool: finds orphaned and duplicated labour-sheet expenses in a backup
// without changing it. Synthetic data only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const { auditLabour, print } = require('../tools/audit-labour.cjs');

const sheet = 'Labour sheet: Evening 10 @ ₹600';
const backup = {
  version: 'ffv2', vendors: [], cPays: [], vPays: [], photos: [],
  events: [
    { id: 'ok', name: 'Healthy Event', labour: { rows: [{ id: 'r', role: 'Boys – बॉईज', rate: 600, counts: { e: 10 } }], expIds: { 'Labour|Boys – बॉईज': 'x-ok' } } },
    { id: 'lost', name: 'Edited Event' },   // sheet dropped by the edit bug, expense left behind
    { id: 'dup', name: 'Re-entered Event', labour: { rows: [{ id: 'r', role: 'Boys – बॉईज', rate: 600, counts: { e: 10 } }], expIds: { 'Labour|Boys – बॉईज': 'x-dup-new', 'Labour|Cook – स्वयंपाकी': 'x-gone' } } }
  ],
  expenses: [
    { id: 'x-ok', evId: 'ok', cat: 'Labour', head: 'Boys – बॉईज', amt: 6000, date: '2026-10-01', notes: sheet },
    { id: 'x-lost', evId: 'lost', cat: 'Labour', head: 'Boys – बॉईज', amt: 4200, date: '2026-10-02', notes: sheet },
    { id: 'x-dup-old', evId: 'dup', cat: 'Labour', head: 'Boys – बॉईज', amt: 6000, date: '2026-10-03', notes: sheet },
    { id: 'x-dup-new', evId: 'dup', cat: 'Labour', head: 'Boys – बॉईज', amt: 6000, date: '2026-10-03', notes: sheet },
    { id: 'x-manual', evId: 'dup', cat: 'Labour', head: 'Boys – बॉईज', amt: 500, date: '2026-10-03', notes: 'tips' }   // typed by hand: never flagged
  ]
};

const r = auditLabour(backup);
assert.equal(r.sheetExpenses, 4); assert.equal(r.linkedSheetExpenses, 2);
assert.deepEqual(r.orphaned.map(o => o.expenseId).sort(), ['x-dup-old', 'x-lost']);
assert.equal(r.orphanedTotal, 10200);
assert.deepEqual(r.lostSheets, ['lost']);
assert.equal(r.duplicates.length, 1); assert.equal(r.duplicates[0].eventId, 'dup'); assert.equal(r.possibleDuplicateAmount, 6000);
assert.deepEqual(r.brokenLinks, [{ eventId: 'dup', key: 'Labour|Cook – स्वयंपाकी', expenseId: 'x-gone' }]);
assert(!JSON.stringify(r).includes('x-manual'), 'hand-entered expenses are never flagged');
assert.equal(auditLabour({ ...backup, events: [backup.events[0]], expenses: [backup.expenses[0]] }).orphaned.length, 0, 'a clean backup reports nothing');
assert.match(print(r, backup, true), /^Events: 3/); assert(!print(r, backup, true).includes('Edited Event'), '--summary prints no names');
assert.throws(() => auditLabour({}), /Not a CaterDesk backup/);

// CLI: reads the file and leaves it byte-for-byte unchanged
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cd-audit-')), 'backup.json');
fs.writeFileSync(file, JSON.stringify(backup)); const before = fs.readFileSync(file);
const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'audit-labour.cjs'), file], { encoding: 'utf8' });
assert.match(out, /Orphaned labour-sheet expenses: 2 · total ₹10200/); assert.match(out, /DUPLICATE\? Re-entered Event/); assert.match(out, /Nothing was changed/);
assert(before.equals(fs.readFileSync(file)), 'backup file not modified');
fs.rmSync(path.dirname(file), { recursive: true, force: true });
console.log('labour audit tool (read-only, finds orphaned and duplicated sheet expenses) PASS');
