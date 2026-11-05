// UI audit on a touch phone: symmetry (aligned edges, equal sizes and gaps), every tab, sheet,
// button and dropdown, scrolling, layout shift and pull-to-refresh, in light and dark themes.
const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const { chromium, devices } = require('playwright');
const fs = require('fs');
const REPORT_ONLY = process.env.UI_AUDIT_REPORT === '1';

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const DATA = {
  version: 'ffv2', photos: [],
  vendors: [
    { id: 'raj', name: 'Rajiv Chaat', cat: 'Live Counter', specialty: 'Chaat – चाट', phone: '9876543210' },
    { id: 'mur', name: 'Murugan Dosa', cat: 'Live Counter', specialty: 'Dosa – डोसा', phone: '9123456780' },
    { id: 'pat', name: 'New Patel Grocery', cat: 'Raw Material', specialty: 'Grocery – किराणा' },
    { id: 'muk', name: 'Sample Labour Contractor', cat: 'Labour', phone: '9000000001' },
    { id: 'unc', name: 'Uncle', kind: 'person' }
  ],
  events: [
    { id: 'e1', name: 'Sharma Wedding Reception', date: day(-12), venue: 'Royal Palms Banquet, SB Road', type: 'Wedding – लग्न', billing: 270000, guests: 300, menu: 'golden', mobile: '9822012345', meals: ['breakfast', 'lunch'], photoIds: [],
      dishes: [{ name: 'Pani Puri', head: 'Chaat – चाट' }, { name: 'Masala Dosa', head: 'Dosa – डोसा' }, { name: 'Dal Makhani', head: '' }],
      orders: [{ id: 'o1', head: 'Chaat – चाट', venId: 'raj', plates: 300, date: day(-12), time: '19:00', notes: '', status: 'confirmed', at: new Date().toISOString() }],
      labour: { rows: [{ id: 'l1', role: 'Boys – बॉईज', count: 13, shift: 'e', shifts: 1, rate: 700 }, { id: 'l2', kind: 'x', extra: 'travel', label: '', count: 1, rate: 1000 }], pay: 'credit', mode: '', venId: 'muk', expIds: {} } },
    { id: 'e2', name: 'Kulkarni Engagement', date: day(1), venue: 'Lawn', type: 'Engagement – साखरपुडा', billing: 120000, guests: 150, menu: 'silver', mobile: '9822054321', meals: ['hightea', 'dinner'], photoIds: [] },
    { id: 'e3', name: 'Small Birthday', date: day(20), venue: 'Flat', type: 'Birthday – वाढदिवस', billing: 50000, guests: 60, outsourced: true, outVenId: 'pat', photoIds: [] }
  ],
  expenses: [
    { id: 'x1', evId: 'e1', cat: 'Live Counter', head: 'Chaat – चाट', amt: 27000, date: day(-12), pay: 'credit', venId: 'raj', dueDate: day(-2) },
    { id: 'x2', evId: 'e1', cat: 'Raw Material', head: 'Grocery – किराणा', amt: 84000, date: day(-13), pay: 'paid', mode: 'UPI', venId: 'pat' },
    { id: 'x3', evId: 'e1', cat: 'Labour', head: 'Boys – बॉईज', amt: 9100, date: day(-12), pay: 'credit', venId: 'muk' },
    { id: 'x4', evId: 'e3', cat: 'Operations', head: 'Outsourced Event – आउटसोर्स कार्यक्रम', amt: 44000, date: day(20), pay: 'credit', venId: 'pat' },
    { id: 'x5', evId: 'e2', cat: 'Live Counter', head: 'Dosa – डोसा', amt: 9000, date: day(-1), pay: 'credit', venId: 'unc' }
  ],
  cPays: [{ id: 'c1', evId: 'e1', amt: 150000, date: day(-20), mode: 'UPI' }, { id: 'c2', evId: 'e2', amt: 20000, date: day(-5), mode: 'Cash – रोख' }],
  vPays: [{ id: 'v1', venId: 'pat', amt: 10000, date: day(-3), mode: 'UPI' }]
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  process.on('exit', () => browser.close().catch(() => {}));
  const findings = [];
  const note = (theme, where, what) => findings.push(`[${theme}] ${where}: ${what}`);
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 360, height: 780 }, colorScheme: theme, timezoneId: 'Asia/Kolkata' });
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(BASE_URL); await p.waitForSelector('#kpi .card');
    await p.evaluate(async d => { const db = await import('./db.js'); await db.importAllData(d); localStorage.setItem('ffv2_theme', JSON.stringify(document.documentElement.classList.contains('dark') ? 'dark' : 'light')); }, DATA);
    await p.reload(); await p.waitForSelector('#kpi .card');
    await p.evaluate(t => document.querySelector(`[data-theme-set="${t}"]`)?.click(), theme);
    await p.evaluate(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false }); });

    // Symmetry: equal left/right page margins, aligned card edges, equal-size siblings in rows and grids, centred labels
    const symmetry = where => p.evaluate(where => {
      const out = [], W = innerWidth;
      const root = document.querySelector('.modal-ov.active .sheet') || document.querySelector('.tab.active');
      const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      // 1. cards and section headers share the same left and right edges
      const blocks = [...root.querySelectorAll(':scope > .card, :scope > .sec, :scope > div > .card, :scope > div > .sec, :scope .card.list, :scope .card.pad')].filter(vis).filter(el => !el.closest('.qa-grid, .metric-tiles, .f2, [data-lab]'));
      if (!document.querySelector('.modal-ov.active')) {
        const lefts = new Set(blocks.map(b => Math.round(b.getBoundingClientRect().left))), rights = new Set(blocks.map(b => Math.round(b.getBoundingClientRect().right)));
        if (lefts.size > 1) out.push(`card/section left edges differ: ${[...lefts].join(', ')}`);
        if (rights.size > 1) out.push(`card/section right edges differ: ${[...rights].join(', ')}`);
        const r0 = blocks[0]?.getBoundingClientRect(); if (r0 && Math.abs(r0.left - (W - r0.right)) > 1) out.push(`page margins not equal: left ${Math.round(r0.left)} right ${Math.round(W - r0.right)}`);
      }
      // 2. siblings laid out in one row (grids, button rows, segments, metrics) have equal height; equal widths in grids/segments
      for (const box of root.querySelectorAll('.qa-grid, .metrics, .f2, .btn-row, .seg, .metric-tiles, [style*="grid-template-columns"]')) {
        if (!vis(box)) continue;
        const kids = [...box.children].filter(vis); if (kids.length < 2) continue;
        const rows = new Map(); for (const k of kids) { const t = Math.round(k.getBoundingClientRect().top); const key = [...rows.keys()].find(x => Math.abs(x - t) <= 2) ?? t; if (!rows.has(key)) rows.set(key, []); rows.get(key).push(k); }
        for (const row of rows.values()) {
          if (row.length < 2) continue;
          const hs = row.map(k => Math.round(k.getBoundingClientRect().height));
          const name = (box.id ? '#' + box.id : '.' + [...box.classList].join('.')) || box.tagName;
          const equalWidthExpected = box.matches('.seg, .metric-tiles, .qa-grid, .f2, .metrics') && !row.some(k => k.matches('.del-btn, .amt-md'));
          if (box.matches('.seg, .qa-grid, .metric-tiles, .btn-row') && Math.max(...hs) - Math.min(...hs) > 2) out.push(`${name}: unequal heights ${hs.join('/')}`);
          if (equalWidthExpected) { const ws = row.map(k => Math.round(k.getBoundingClientRect().width)); if (Math.max(...ws) - Math.min(...ws) > 2) out.push(`${name}: unequal widths ${ws.join('/')}`); }
          const gaps = row.slice(1).map((k, i) => Math.round(k.getBoundingClientRect().left - row[i].getBoundingClientRect().right));
          if (new Set(gaps).size > 1 && Math.max(...gaps) - Math.min(...gaps) > 2) out.push(`${name}: uneven gaps ${gaps.join('/')}`);
        }
      }
      // 3. buttons and chips: label vertically centred (equal top/bottom space)
      for (const b of root.querySelectorAll('button, .btn, .chip, .f-chip')) {
        if (!vis(b) || b.matches('.del-btn, .icon-btn, .row, [role=button]')) continue;
        const range = document.createRange(); range.selectNodeContents(b); const t = range.getBoundingClientRect(), r = b.getBoundingClientRect();
        if (!t.height || t.height > r.height) continue;
        const top = t.top - r.top, bottom = r.bottom - t.bottom;
        if (Math.abs(top - bottom) > 3) out.push(`label off-centre (${Math.round(top)} vs ${Math.round(bottom)}): "${b.textContent.trim().slice(0, 24)}"`);
      }
      // 4. icons in a list column line up
      const ics = [...root.querySelectorAll('.card.list > .row > .row-ic, .card.list > .row > .avatar')].filter(vis);
      const icL = new Set(ics.map(i => Math.round(i.getBoundingClientRect().left))); if (icL.size > 1) out.push(`row icons not in one column: ${[...icL].join(', ')}`);
      const amts = [...root.querySelectorAll('.card.list > .row > .row-end, .card.list > .row > .amt-sm')].filter(vis);
      const amR = new Set(amts.filter(a => !a.nextElementSibling).map(a => Math.round(a.getBoundingClientRect().right))); if (amR.size > 1) out.push(`row amounts not right-aligned together: ${[...amR].join(', ')}`);
      // 5. overflow
      if (document.documentElement.scrollWidth > W) out.push('page scrolls sideways');
      return out;
    }, where).then(list => [...new Set(list)].forEach(f => note(theme, where, f)));

    const tap = async sel => {
      try { const el = p.locator(sel + ':visible').first(); await el.scrollIntoViewIfNeeded({ timeout: 3000 }); await el.tap({ timeout: 3000 }); await p.waitForTimeout(250); return true; }
      catch (e) { note(theme, 'tap', `${sel}: ${e.message.split('\n')[0]}`); return false; }
    };
    const sheetOpen = () => p.evaluate(() => !!document.querySelector('.modal-ov.active'));
    const closeSheet = async how => {
      if (how === 'x') {   // ✕ on forms; Cancel on choice sheets
        const x = p.locator('.modal-ov.active [data-action="close-modal"]:visible');
        await (await x.count() ? x.first() : p.locator('#ask-actions button:visible').last()).tap({ timeout: 3000 }).catch(e => note(theme, 'sheet', 'close: ' + e.message.split('\n')[0]));
      }
      if (how === 'back') await p.goBack();
      if (how === 'scrim') await p.mouse.click(180, 20);
      await p.waitForTimeout(300);
      if (await sheetOpen()) note(theme, 'sheet', `did not close with ${how}`);
    };
    // Every select in an open sheet: every option can be chosen without errors
    const exerciseSelects = async where => {
      const n = await p.locator('.modal-ov.active select').count();
      for (let i = 0; i < n; i++) {
        const sel = p.locator('.modal-ov.active select').nth(i);
        if (!(await sel.isVisible())) continue;
        const vals = await sel.evaluate(s => [...s.options].map(o => o.value).filter(v => !v.startsWith('__new')));
        for (const v of vals.slice(0, 8)) await sel.selectOption(v).catch(e => note(theme, where, `select #${i} option "${v}": ${e.message.split('\n')[0]}`));
      }
    };
    // Scrolling inside a sheet must not scroll the page behind it
    const scrollLock = async where => {
      const before = await p.evaluate(() => scrollY);
      await p.locator('.modal-ov.active .sheet').first().evaluate(s => s.scrollBy(0, 400));
      await p.mouse.wheel(0, 400); await p.waitForTimeout(150);
      if (await p.evaluate(() => scrollY) !== before) note(theme, where, 'page behind the sheet scrolled');
    };

    // Tabs: tap each, top of page, nav state, symmetry
    for (const t of ['home', 'events', 'expenses', 'vendors', 'summary']) {
      await p.evaluate(() => window.scrollTo(0, 300));
      await tap('#n-' + t);
      if (!(await p.locator('#tab-' + t).isVisible())) note(theme, t, 'tab did not open');
      if (await p.locator('#n-' + t).getAttribute('aria-current') !== 'page') note(theme, t, 'nav button not marked current');
      if (t === 'summary') await tap('#tab-summary [data-period-seg] [data-id="all"]');
      await symmetry(t);
    }
    // Home quick actions open the right sheets; each closes by ✕, Back and tapping outside
    await tap('#n-home');
    for (const [btn, sheet, how] of [['[data-action="quick"][data-id="event"]', '#ev-modal', 'x'], ['[data-action="quick"][data-id="expense"]', '#exp-modal', 'back'], ['[data-action="quick"][data-id="vendor"]', '#ven-modal', 'scrim']]) {
      await tap(btn);
      if (!(await p.locator(sheet + '.active').count())) { note(theme, 'home', `${btn} did not open ${sheet}`); continue; }
      await symmetry(sheet); await exerciseSelects(sheet); await scrollLock(sheet); await closeSheet(how);
    }
    // Event page: every action button
    await tap('#n-events'); await tap('#ev-list [data-action="evdetail"][data-id="e1"]'); await symmetry('event page');
    for (const [btn, sheet] of [['[data-action="lab-edit"]', '#lab-modal'], ['[data-action="menu-edit"]', '#menu-modal'], ['[data-action="order-status"]', null], ['[data-action="order-new"]', '#ord-modal'], ['[data-action="open-cpay"]', '#cpay-modal'], ['[data-action="open-exp"]', '#exp-modal'], ['#hdr-edit', '#ev-modal']]) {
      if (!(await p.locator(btn + ':visible').count())) continue;
      if (!(await tap(btn))) continue;
      if (sheet && !(await p.locator(sheet + '.active').count())) { note(theme, 'event page', `${btn} did not open ${sheet}`); continue; }
      if (!sheet) { if (!(await p.locator('.modal-ov.active').count())) note(theme, 'event page', `${btn} opened nothing`); await closeSheet('x'); continue; }
      await symmetry(sheet); await exerciseSelects(sheet); await closeSheet('x');
    }
    // Labour sheet: add rows, extras, then remove; total stays right
    await tap('[data-action="lab-edit"]'); await tap('#btn-lab-add'); await tap('#btn-lab-extra'); await symmetry('#lab-modal with rows');
    const n = await p.locator('#lab-rows [data-lab]').count(); await tap(`#lab-rows [data-lab="${n - 1}"] [data-lab-del]`);
    if (await p.locator('#lab-rows [data-lab]').count() !== n - 1) note(theme, 'labour', 'remove row did not remove');
    await closeSheet('x');
    // Vendor page and payment
    await tap('#n-vendors'); await tap('#ven-list [data-action="vendetail"]'); await symmetry('vendor page');
    await tap('[data-action="open-vpay"]'); await symmetry('#vpay-modal'); await exerciseSelects('#vpay-modal'); await closeSheet('x');
    // Settings drawer
    await tap('#drawer-toggle'); await symmetry('settings'); await p.goBack(); await p.waitForTimeout(300);
    // Pull to refresh with a finger: indicator appears, then hides
    await tap('#n-home'); await p.evaluate(() => window.scrollTo(0, 0));
    const ptr = await p.evaluate(async () => {
      const t = (type, y) => window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: document.body, clientY: y, clientX: 180 })] }));
      t('touchstart', 100); for (let y = 110; y <= 220; y += 10) t('touchmove', y);
      await new Promise(r => setTimeout(r, 250));   // let the slide-in finish before measuring
      const shown = getComputedStyle(document.querySelector('#ptr')).transform; t('touchend', 220);
      await new Promise(r => setTimeout(r, 2200)); return { shown, after: getComputedStyle(document.querySelector('#ptr')).transform };
    });
    if (!/matrix\(1, 0, 0, 1, -\d+(\.\d+)?, (?!-60)/.test(ptr.shown)) note(theme, 'pull to refresh', `indicator not shown (${ptr.shown})`);
    if (!/-60\)$/.test(ptr.after)) note(theme, 'pull to refresh', `indicator stuck (${ptr.after})`);
    // Jump: total layout shift across all of the above
    const cls = await p.evaluate(() => window.__cls);
    if (cls > 0.1) note(theme, 'layout', `content jumped (layout shift ${cls.toFixed(3)})`);
    for (const e of errors) note(theme, 'console', e);
    await ctx.close();
  }
  await browser.close();
  fs.mkdirSync('test-artifacts', { recursive: true });
  fs.writeFileSync('test-artifacts/ui-audit.json', JSON.stringify(findings, null, 2));
  console.log(findings.length ? findings.join('\n') : 'UI audit: no findings');
  console.log('ui audit ' + (findings.length && !REPORT_ONLY ? 'FAIL' : 'PASS'));
  if (findings.length && !REPORT_ONLY) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; process.exit(1); });
