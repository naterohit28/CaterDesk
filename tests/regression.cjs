const BASE_URL = process.env.TEST_BASE_URL; if (!BASE_URL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE_URL)) throw new Error('Use npm test to run against the isolated local test server.');
const {chromium}=require('playwright');const fs=require('fs');const assert=require('assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Kolkata'});const p=await c.newPage();p.setDefaultTimeout(10000);const errors=[];p.on('pageerror',e=>errors.push(e.message));const results=[];const test=async(name,fn)=>{try{const detail=await fn();results.push({name,pass:true,detail})}catch(e){results.push({name,pass:false,error:e.stack})}fs.writeFileSync('test-artifacts/repair-test-results.json',JSON.stringify(results,null,2));console.log(name,results.at(-1).pass?'PASS':'FAIL');};await p.goto(BASE_URL);await p.waitForSelector('#kpi .card');
const ev={id:'e',name:'Wedding',date:'2026-10-25',venue:'Pune',billing:10000,photoIds:[]};const empty=()=>({version:'ffv2',events:[],expenses:[],vendors:[],cPays:[],vPays:[],photos:[]});
const db=(fn,arg)=>p.evaluate(async({fn,arg})=>new Function('d','arg','return ('+fn+')(d,arg)')(await import('./db.js'),arg),{fn:fn.toString(),arg});
const seed=async(a)=>{await db(async(d,a)=>{await d.setMeta('pin_hash',null);await d.importAllData(a)},a||{...empty(),events:[ev]});await p.evaluate(()=>{localStorage.removeItem('ffv2_last');localStorage.removeItem('ffv2_expdraft')});await p.reload();await p.waitForSelector('#kpi .card');};
// Reference events used as benchmarks must be reconciled (v4.2.0, G-22): marks them as the owner would
const reconcileIds=async ids=>{await p.evaluate(async ids=>{const db=await import('./db.js'),u=await import('./utils.js');const d=await db.exportAllData();for(const id of ids){const {_rev,...e}=d.events.find(x=>x.id===id);await db.putOne('events',{...e,...u.reconcileFields(e,d.expenses,['bills','shared','final'])})}},ids);await p.reload();await p.waitForSelector('#kpi .card');};
await test('valid all-store roundtrip',async()=>{const a=empty();a.events=[ev];a.vendors=[{id:'v',name:'Vendor'}];a.expenses=[{id:'x',evId:'e',venId:'v',amt:100,date:'2026-10-25',pay:'credit',billIds:['b']},{id:'draft',draft:true,evId:'e',amt:0}];a.cPays=[{id:'cp',evId:'e',amt:10,date:'2026-10-25'}];a.vPays=[{id:'vp',venId:'v',amt:10,date:'2026-10-25'}];a.photos=[{id:'b',expenseId:'x',data:'data:image/png;base64,AA=='}];await seed(a);const before=await db(async d=>d.exportAllData());await db(async(d,a)=>d.importAllData(a),before);const after=await db(async d=>d.exportAllData());for(const k of ['events','expenses','vendors','cPays','vPays','photos']){assert.equal(before[k].length,after[k].length);assert.deepEqual(before[k].map(({_rev,...r})=>r),after[k].map(({_rev,...r})=>r));}return 'All six stores and drafts retained';});
await test('malformed restore preserves original',async()=>{await seed();let rejected=false;try{await db(async(d,a)=>d.importAllData(a),{...empty(),events:[{name:'Missing ID'}]})}catch{rejected=true}assert(rejected);assert.equal((await db(async d=>d.getAll('events'))).length,1);});
await test('late transaction failure rolls back clears and writes',async()=>{await seed();const result=await db(async(d,a)=>{const native=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='vendors')throw new DOMException('Injected failure','QuotaExceededError');return native.apply(this,args)};let rejected=false;try{await d.importAllData(a)}catch{rejected=true}finally{IDBObjectStore.prototype.put=native}return {rejected,events:await d.getAll('events')}},{...empty(),events:[{...ev,id:'new'}],vendors:[{id:'v',name:'Vendor'}]});assert(result.rejected);assert.equal(result.events[0].id,'e');});
await test('aborted put rejects and does not persist',async()=>{const result=await db(async d=>{const native=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=native.apply(this,args);const tx=this.transaction;r.addEventListener('success',()=>tx.abort());return r};let rejected=false;try{await d.putOne('events',{id:'abort'})}catch{rejected=true}finally{IDBObjectStore.prototype.put=native}return {rejected,stored:await d.getOne('events','abort')}});assert(result.rejected);assert.equal(result.stored,null);});
await test('reject duplicate IDs invalid money dates references',async()=>{for(const bad of [{...empty(),events:[ev,ev]},{...empty(),events:[{...ev,billing:Infinity}]},{...empty(),events:[{...ev,date:'2026-02-30'}]},{...empty(),events:[ev],expenses:[{id:'x',evId:'e',amt:'100',date:'2026-10-25'}]},{...empty(),expenses:[{id:'x',evId:'missing',amt:100,date:'2026-10-25'}]}]){let rejected=false;try{await db(async(d,a)=>d.importAllData(a),bad)}catch{rejected=true}assert(rejected)};});
await test('merge conflicts keep newer values',async()=>{await seed();let rejected=false;try{await db(async(d,a)=>d.importAllData(a,'merge'),{...empty(),events:[{...ev,billing:5}]})}catch{rejected=true}assert(rejected);assert.equal((await db(async d=>d.getOne('events','e'))).billing,10000);});
await test('invalid image rejects promptly',async()=>{const r=await db(async d=>Promise.race([d.savePhoto('e','data:image/png;base64,INVALID').then(()=>false,()=>true),new Promise(r=>setTimeout(()=>r(false),1500))]));assert(r);});
await test('legacy photos converted and exported',async()=>{const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE2kAAAAASUVORK5CYII=';await db(async(d,a)=>d.importAllData(a),{...empty(),version:'ffv5',events:[{...ev,photos:[png]}]});assert.equal((await db(async d=>d.getPhotosForEvent('e'))).length,1);});
await test('partial migration writes nothing and can retry',async()=>{await seed();const result=await db(async d=>{await d.setMeta('ls_migrated',null);localStorage.setItem('ffv5_ev',JSON.stringify([{id:'legacy',name:'Legacy',date:'2026-10-25',billing:100}]));localStorage.setItem('ffv5_ex',JSON.stringify([{amt:5}]));let rejected=false;try{await d.migrateFromLocalStorage()}catch{rejected=true}const mark=await d.getMeta('ls_migrated');const written=await d.getOne('events','legacy');localStorage.setItem('ffv5_ex',JSON.stringify([{id:'lx',evId:'legacy',amt:5,date:'2026-10-25'}]));await d.migrateFromLocalStorage();localStorage.removeItem('ffv5_ev');localStorage.removeItem('ffv5_ex');return {rejected,mark,written,recovered:!!await d.getOne('expenses','lx')}});assert(result.rejected);assert.equal(result.mark,null);assert.equal(result.written,null);assert(result.recovered);});
await test('rapid event save creates one record',async()=>{await seed();await p.locator('[data-action="quick"][data-id="event"]').click();await p.locator('#ev-name').fill('Double tap');await p.locator('#ev-date').fill('2026-10-27');await p.locator('#ev-venue').fill('Hall');await p.locator('#ev-billing').fill('500');await p.locator('#btn-save-event').evaluate(el=>{el.click();el.click()});await p.waitForTimeout(250);assert.equal((await db(async d=>d.getAll('events'))).filter(e=>e.name==='Double tap').length,1);});
await test('stale open form refuses overwrite',async()=>{await seed();const q=await c.newPage();q.setDefaultTimeout(10000);await q.goto(BASE_URL);await q.waitForSelector('#kpi .card');await q.locator('#n-events').click();await q.locator('#ev-list [data-action="evdetail"]').click();await q.locator('#hdr-edit').click();await db(async d=>{const r=await d.getOne('events','e');await d.putOne('events',{...r,billing:20000})});await q.locator('#ev-name').fill('Stale');await q.locator('#btn-save-event').click();await q.waitForTimeout(250);assert.equal((await db(async d=>d.getOne('events','e'))).billing,20000);assert.match(await q.locator('#toast').innerText(),/changed in another/);await q.close();});
await test('storage failure preserves form and explains failure',async()=>{await seed();await p.locator('[data-action="quick"][data-id="event"]').click();for(const [id,v]of [['ev-name','Unsaved'],['ev-date','2026-10-27'],['ev-venue','Hall'],['ev-billing','500']])await p.locator('#'+id).fill(v);await p.evaluate(()=>{window.oldPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw new DOMException('full','QuotaExceededError')}});await p.locator('#btn-save-event').click();await p.waitForTimeout(200);await p.evaluate(()=>{IDBObjectStore.prototype.put=window.oldPut});assert.match(await p.locator('#toast').innerText(),/Could not save/);assert.equal(await p.locator('#ev-name').inputValue(),'Unsaved');});
await test('modal focus stays inside and returns to trigger',async()=>{await seed();await p.locator('#n-events').click();const trigger=p.locator('#fab');await trigger.click();await p.waitForTimeout(30);assert(await p.evaluate(()=>!!document.activeElement.closest('#ev-modal')));await p.locator('#btn-save-event').focus();await p.keyboard.press('Tab');assert(await p.evaluate(()=>!!document.activeElement.closest('#ev-modal')));await p.locator('#ev-modal [data-action="close-modal"]').click();await p.waitForTimeout(100);assert(await trigger.evaluate(el=>document.activeElement===el));});
await test('PIN recovery dismisses without bypass and export blocked',async()=>{await seed();await db(async d=>{const u=await import('./utils.js');await d.setMeta('pin_hash',await u.hashPin('1234'))});await p.reload();await p.locator('#pin-screen.active').waitFor();let downloaded=false;p.on('download',()=>downloaded=true);await p.evaluate(()=>window.FF.exportData());await p.waitForTimeout(150);assert(!downloaded);await p.locator('#pin-alt').click();await p.locator('#ask-actions button').first().click();await p.waitForTimeout(100);assert(await db(async d=>!!await d.getMeta('pin_hash')));assert(await p.locator('#pin-screen').evaluate(e=>e.classList.contains('active')));for(const digit of '1234')await p.locator('.pin-key[data-val="'+digit+'"]').click();await p.waitForTimeout(500);assert(!(await p.locator('#pin-screen').evaluate(e=>e.classList.contains('active'))));});
await test('accounting history blocks event and vendor deletion',async()=>{const a={...empty(),events:[ev],vendors:[{id:'v',name:'Supplier'}],expenses:[{id:'x',evId:'e',venId:'v',amt:50,date:'2026-10-25',pay:'credit'}]};await seed(a);await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').click();await p.locator('#hdr-delete').click();assert.match(await p.locator('#toast').innerText(),/accounting history/);await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]').click();await p.locator('#hdr-delete').click();assert.equal((await db(async d=>d.getAll('vendors'))).length,1);});
await test('10000 expenses render 100 rows with usable pagination',async()=>{const a={...empty(),events:Array.from({length:1000},(_,i)=>({...ev,id:'e'+i,name:'Wedding '+i})),expenses:Array.from({length:10000},(_,i)=>({id:'x'+i,evId:'e'+i%1000,amt:123.45,date:'2026-10-25',cat:'Raw Material',head:'Grocery',pay:'paid'}))};const t=Date.now();await seed(a);const bootAndImport=Date.now()-t;const start=Date.now();await p.locator('#n-expenses').click();const ms=Date.now()-start;assert.equal(await p.locator('#exp-list .row').count(),100);await p.locator('[data-action="expense-next"]').click();assert.equal(await p.locator('#exp-list .row').count(),100);assert.equal((await db(async d=>d.getAll('expenses'))).length,10000);assert(ms<5000);await p.screenshot({path:'test-artifacts/repaired-mobile.png'});return {importAndBootMs:bootAndImport,expensesTabMs:ms,renderedRows:100,storedRows:10000};});
await test('offline reload retains all 10000 expenses',async()=>{await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await p.waitForSelector('#kpi .card');await c.setOffline(true);await p.reload();await p.waitForSelector('#kpi .card');assert.equal((await db(async d=>d.getAll('expenses'))).length,10000);await c.setOffline(false);});
await test('mobile widths no horizontal overflow',async()=>{for(const w of [320,360,390,412,768]){await p.setViewportSize({width:w,height:844});await p.locator('#n-expenses').click();assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));}});
await test('record cash and credit entry with chosen vendors',async()=>{await seed({...empty(),events:[ev],vendors:[{id:'ven_test',name:'Vendor Test',cat:'Raw Material'}]});await p.locator('[data-action="quick"][data-id="expense"]').click();await p.waitForSelector('#exp-modal.active');await p.locator('#exp-amt').fill('150');await p.locator('#exp-vendor').selectOption('ven_test');await p.locator('#btn-save-exp').click();await p.waitForTimeout(300);assert.equal((await db(async d=>d.getAll('expenses'))).filter(x=>x.venId==='ven_test'&&x.pay==='paid').length,1);await p.locator('[data-action="quick"][data-id="expense"]').click();await p.waitForSelector('#exp-modal.active');await p.locator('#exp-amt').fill('250');await p.locator('#exp-pay button[data-pay="credit"]').click();await p.locator('#exp-vendor').selectOption('ven_test');await p.locator('#btn-save-exp').click();await p.waitForTimeout(300);assert.equal((await db(async d=>d.getAll('expenses'))).filter(x=>x.venId==='ven_test'&&x.pay==='credit').length,1);});
await test('closed database auto-reconnects and saves entry without getting stuck',async()=>{await seed({...empty(),events:[ev],vendors:[{id:'ven_reconn',name:'Vendor Reconnect',cat:'Transport'}]});await p.evaluate(async()=>{const d=await import('./db.js');const dbInstance=await d.openDB();dbInstance.close();});await p.locator('[data-action="quick"][data-id="expense"]').click();await p.waitForSelector('#exp-modal.active');await p.locator('#exp-amt').fill('320');await p.locator('#exp-vendor').selectOption('ven_reconn');await p.locator('#btn-save-exp').click();await p.waitForTimeout(300);const expenses=await db(async d=>d.getAll('expenses'));assert.equal(expenses.filter(x=>x.venId==='ven_reconn'&&x.amt===320).length,1);});
await test('vendor suggestions match category and subcategory without replacing chosen vendor',async()=>{
 const heads=await p.evaluate(async()=>Object.entries((await import('./utils.js')).EXPENSE_HEADS));const cat=heads[0][0],head=heads[0][1][0],head2=heads[0][1][1],otherCat=heads[1][0];
 await seed({...empty(),events:[ev],vendors:[{id:'other',name:'AAA Other',cat:otherCat,specialty:head},{id:'category',name:'BBB Category',cat,specialty:head2},{id:'42',name:'ZZZ Exact',cat,specialty:head.split(' – ')[0]}]});
 await p.locator('[data-action="quick"][data-id="expense"]').click();await p.locator(`#exp-cats [data-cat="${cat}"]`).click();await p.locator('#exp-head').selectOption(head);await p.locator('#exp-pay [data-pay="credit"]').click();
 const values=()=>p.locator('#exp-vendor option').evaluateAll(os=>os.map(o=>o.value));assert.deepEqual(await values(),['','42','category','other','__new','__newperson']);assert.equal(await p.locator('#exp-vendor').inputValue(),'');assert.match(await p.locator('#exp-vendor optgroup').first().getAttribute('label'),/Usual for this item/);
 await p.locator('#exp-vendor').selectOption('42');await p.locator('#exp-head').selectOption(head2);assert.deepEqual(await values(),['','category','42','other','__new','__newperson']);assert.equal(await p.locator('#exp-vendor').inputValue(),'42');
 await p.locator(`#exp-cats [data-cat="${otherCat}"]`).click();assert.equal((await values())[1],'other');assert.equal(await p.locator('#exp-vendor').inputValue(),'42');
 await p.locator('#exp-amt').fill('321');await p.locator('#btn-save-exp').click();await p.waitForTimeout(300);assert.equal((await db(async d=>d.getAll('expenses'))).filter(x=>String(x.venId)==='42'&&x.amt===321&&x.pay==='credit').length,1);
 await p.locator('#n-expenses').click();await p.locator('#exp-list [data-action="edit-exp"]').first().click();assert.equal(await p.locator('#exp-vendor').inputValue(),'42');
});
await test('usual vendors are one-tap suggestions and pending credit is listed first',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const pick=(cat,word)=>H[cat].find(h=>h.startsWith(word));
 const chaat=pick('Live Counter','Chaat'),dosa=pick('Live Counter','Dosa'),ice=pick('Live Counter','Ice Cream'),grocery=pick('Raw Material','Grocery');
 await seed({...empty(),events:[ev],vendors:[{id:'rajiv',name:'Rajiv Chaat',cat:'Live Counter',specialty:chaat},{id:'murugan',name:'Murugan',cat:'Live Counter',specialty:dosa},{id:'patel',name:'New Patel',cat:'Raw Material',specialty:grocery}],
  expenses:[{id:'ice1',evId:'e',cat:'Live Counter',head:ice,amt:12000,date:'2026-10-27',pay:'paid',venId:'rajiv'},
            {id:'gro1',evId:'e',cat:'Raw Material',head:grocery,amt:24000,date:'2026-10-26',pay:'credit',venId:'patel'},
            {id:'dosa1',evId:'e',cat:'Live Counter',head:dosa,amt:15000,date:'2026-10-27',pay:'credit',venId:'murugan',dueDate:'2026-10-01'}]});
 await p.locator('[data-action="quick"][data-id="expense"]').click();await p.waitForSelector('#exp-modal.active');
 await p.locator('#exp-cats [data-cat="Live Counter"]').click();
 const firstHead=await p.locator('#exp-head option').first().getAttribute('value');assert(firstHead===ice||firstHead===dosa,'a used item is listed first');
 await p.locator('#exp-head').selectOption(ice);
 const chips=()=>p.locator('#exp-ven-quick [data-ven]').evaluateAll(b=>b.map(x=>x.dataset.ven));
 assert.equal((await chips())[0],'rajiv','vendor who supplied this item before is suggested');
 assert.equal(await p.locator('#exp-vendor').inputValue(),'','suggestion does not choose a vendor by itself');
 await p.locator('#exp-ven-quick [data-ven="rajiv"]').click();assert.equal(await p.locator('#exp-vendor').inputValue(),'rajiv');
 await p.locator('#exp-ven-quick [data-ven="rajiv"]').click();assert.equal(await p.locator('#exp-vendor').inputValue(),'');
 await p.locator('#exp-head').selectOption(chaat);assert.equal((await chips())[0],'rajiv','listed speciality is suggested');
 await p.locator('#exp-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
 await p.locator('#n-expenses').click();
 const firstSection=await p.locator('#exp-list .sec-title').first().innerText();assert.match(firstSection,/To pay/);
 const owed=await p.locator('#to-pay-list .row .title-sm').allInnerTexts();assert.deepEqual(owed,['Murugan','New Patel'],'overdue first, then undated credit');
 await p.locator('#to-pay-list [data-action="open-vpay"]').first().click();await p.waitForSelector('#vpay-modal.active');assert.equal(await p.locator('#vpay-amt').inputValue(),'15000');
 await p.locator('#vpay-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
 await p.locator('#n-home').click();assert.match(await p.locator('#nudges').innerText(),/See all 2 to pay/);
});
await test('lender credit, booking advance, newest events first and staff tips',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const tips=H.Labour.find(h=>h.startsWith('Vendor Staff Tips'));assert(tips&&H.Labour.some(h=>h.startsWith('Staff Tips')),'both tip items exist under Labour');
 await seed({...empty(),events:[ev,{...ev,id:'old',name:'Old Party',date:'2026-01-10'},{...ev,id:'far',name:'Far Wedding',date:'2027-05-01'},{...ev,id:'soon',name:'Soon Wedding',date:'2026-12-01'}],vendors:[{id:'rajiv',name:'Rajiv Chaat',cat:'Live Counter'},{id:'uncle',name:'Uncle Lender',kind:'person'}]});
 await p.locator('#n-events').click();
 assert.deepEqual(await p.locator('#ev-list [data-action="evdetail"] .title-sm').allInnerTexts(),['Far Wedding','Soon Wedding','Wedding','Old Party'],'latest date first');
 await p.locator('#fab').click();await p.waitForSelector('#ev-modal.active');assert(await p.locator('#ev-adv-field').isVisible(),'advance offered when booking');
 for(const [id,v] of [['ev-name','Advance Wedding'],['ev-date','2026-12-20'],['ev-venue','Hall'],['ev-billing','50000'],['ev-adv','60000']])await p.locator('#'+id).fill(v);
 await p.locator('#btn-save-event').click();await p.waitForTimeout(200);assert.match(await p.locator('#ev-modal').innerText(),/more than the total bill/);
 await p.locator('#ev-adv').fill('10000');await p.locator('#btn-save-event').click();await p.waitForTimeout(300);
 const evs=await db(async d=>d.getAll('events'));const adv=evs.find(e=>e.name==='Advance Wedding');assert(adv);
 const pays=(await db(async d=>d.getAll('cPays'))).filter(x=>x.evId===adv.id);assert.equal(pays.length,1);assert.equal(pays[0].amt,10000);
 await p.locator('#fab').click();await p.waitForSelector('#ev-modal.active');for(const [id,v] of [['ev-name','No Advance'],['ev-date','2026-12-21'],['ev-venue','Hall'],['ev-billing','500']])await p.locator('#'+id).fill(v);await p.locator('#btn-save-event').click();await p.waitForTimeout(300);
 const noAdv=(await db(async d=>d.getAll('events'))).find(e=>e.name==='No Advance');assert.equal((await db(async d=>d.getAll('cPays'))).filter(x=>x.evId===noAdv.id).length,0,'advance is optional');
 await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('#hdr-edit').click();assert(!(await p.locator('#ev-adv-field').isVisible()),'no advance field when editing');await p.locator('#ev-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
 await p.locator('#n-home').click();await p.locator('[data-action="quick"][data-id="expense"]').click();await p.waitForSelector('#exp-modal.active');
 const opts=()=>p.locator('#exp-vendor option').evaluateAll(os=>os.map(o=>o.value));
 assert(!(await opts()).includes('uncle'),'a lender is not offered for a cash expense');
 await p.locator('#exp-cats [data-cat="Labour"]').click();await p.locator('#exp-head').selectOption(tips);assert.match(await p.locator('#exp-vendor-lbl').innerText(),/Whose staff/);
 await p.locator('#exp-pay [data-pay="credit"]').click();assert((await opts()).includes('uncle'));assert(!(await p.locator('#exp-ven-quick [data-ven="uncle"]').count()),'never a usual-vendor suggestion');
 await p.locator('#exp-cats [data-cat="Raw Material"]').click();await p.locator('#exp-amt').fill('8000');await p.locator('#exp-vendor').selectOption('uncle');await p.locator('#btn-save-exp').click();await p.waitForTimeout(300);
 assert.equal((await db(async d=>d.getAll('expenses'))).filter(x=>x.venId==='uncle'&&x.pay==='credit'&&x.amt===8000).length,1);
 await p.locator('#n-expenses').click();assert.match(await p.locator('#exp-list .sec .sec-amt').first().innerText(),/1 person/);
 await p.locator('#n-vendors').click();assert.match(await p.locator('#ven-list').innerText(),/Other people[\s\S]*Uncle Lender/);
 await p.locator('#fab').click();await p.waitForSelector('#ven-modal.active');await p.locator('#ven-kind [data-kind="person"]').click();assert(!(await p.locator('#ven-cat-row').isVisible()));
 await p.locator('#ven-name').fill('Cousin');await p.locator('#btn-save-ven').click();await p.waitForTimeout(300);
 const cousin=(await db(async d=>d.getAll('vendors'))).find(v=>v.name==='Cousin');assert.equal(cousin.kind,'person');assert.equal(cousin.cat,'');
 let rejected=false;try{await db(async(d,a)=>d.importAllData(a),{...empty(),vendors:[{id:'bad',name:'Bad',kind:'robot'}]})}catch{rejected=true}assert(rejected,'unknown kind rejected on restore');
});
await test('menu fills bill and expected cost; checklist shows missed usual costs',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const dosa=H['Live Counter'].find(h=>h.startsWith('Dosa')),cook=H.Labour.find(h=>h.startsWith('Cook'));
 const d=new Date();d.setDate(d.getDate()-3);const recent=d.toISOString().slice(0,10);
 await seed({...empty(),vendors:[{id:'murugan',name:'Murugan',cat:'Live Counter'}],
  events:[{...ev,id:'g1',name:'Golden One',menu:'golden',guests:200,date:'2026-09-01'},{...ev,id:'g2',name:'Golden Two',menu:'golden',guests:100,date:recent}],
  expenses:[{id:'a',evId:'g1',cat:'Live Counter',head:dosa,amt:60000,date:'2026-09-01',pay:'paid',venId:'murugan'},{id:'b',evId:'g1',cat:'Labour',head:cook,amt:40000,date:'2026-09-01',pay:'paid'},
            {id:'c',evId:'g2',cat:'Labour',head:cook,amt:20000,date:recent,pay:'paid'}]});await reconcileIds(['g1']);
 assert.match(await p.locator('#nudges').innerText(),/Check costs[\s\S]*Golden Two[\s\S]*1 usual cost not recorded/);
 await p.locator('#n-events').click();await p.locator('#fab').click();await p.waitForSelector('#ev-modal.active');
 await p.locator('#ev-menu').selectOption('golden');await p.locator('#ev-guests').fill('250');
 assert.equal(await p.locator('#ev-billing').inputValue(),'225000','Golden 101-300 pax at 900');
 assert.equal(await p.locator('#ev-budget').inputValue(),String(Math.round(100000/200)*250),'expected cost from reconciled Golden events only (Golden Two is still costs pending)');
 await p.locator('#ev-guests').fill('400');assert.equal(await p.locator('#ev-billing').inputValue(),'320000','301+ pax at 800');
 assert.deepEqual(await p.locator('#ev-menu optgroup').evaluateAll(g=>g.map(x=>x.label.split(' – ')[0])),['Buffet','Banana leaf']);
 await p.locator('#ev-menu').selectOption('maharashtrian');await p.locator('#ev-guests').fill('100');assert.equal(await p.locator('#ev-billing').inputValue(),'80000','banana leaf 50-150 pax at 800');
 await p.locator('#ev-guests').fill('200');assert.equal(await p.locator('#ev-billing').inputValue(),'150000','banana leaf 151-300 pax at 750');
 await p.locator('#ev-menu').selectOption('golden');
 await p.locator('#ev-billing').fill('300000');await p.locator('#ev-guests').fill('350');assert.equal(await p.locator('#ev-billing').inputValue(),'300000','a typed bill is never overwritten');
 for(const [id,v] of [['ev-name','Golden Three'],['ev-date','2026-12-10'],['ev-venue','Lawn']])await p.locator('#'+id).fill(v);await p.locator('#btn-save-event').click();await p.waitForTimeout(300);
 assert.equal((await db(async d=>d.getAll('events'))).find(e=>e.name==='Golden Three').menu,'golden');
 await p.locator('#ev-list [data-action="evdetail"]', {hasText:'Golden Two'}).click();await p.waitForSelector('#tab-evdetail [data-action="check-add"]');
 const card=await p.locator('#tab-evdetail').innerText();assert.match(card,/Golden menu/);assert.match(card,/Cost checklist[\s\S]*Golden One[\s\S]*Dosa/);assert(!/Cook[^\n]*Last time/.test(card),'recorded items are not listed');
 await p.locator('[data-action="check-add"]').first().click();await p.waitForSelector('#exp-modal.active');
 assert.equal(await p.locator('#exp-head').inputValue(),dosa);assert.equal(await p.locator('#exp-vendor').inputValue(),'murugan');assert.equal(await p.locator('#exp-amt').inputValue(),'','amount is never guessed');
 assert.match(await p.locator('#exp-amt').getAttribute('placeholder'),/60,000/);assert.equal(await p.locator('#exp-ev').inputValue(),'g2');
 await p.locator('#exp-amt').fill('30000');await p.locator('#btn-save-exp').click();await p.waitForTimeout(500);
 assert.match(await p.locator('#tab-evdetail').innerText(),/All recorded/);
 await p.locator('#n-summary').click();await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();assert.match(await p.locator('#summary-content').innerText(),/Menu contribution ranking[\s\S]*1\. Golden/);
});
await test('outsourced event saves vendor charge as credit and shows commission',async()=>{
 await seed({...empty(),events:[],vendors:[{id:'kaka',name:'Kaka Caterers',cat:'Live Counter'}]});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="quick"][data-id="event"]').click();await p.waitForSelector('#ev-modal.active');
 for(const [id,v] of [['ev-name','Small Birthday'],['ev-date','2026-01-05'],['ev-venue','Flat'],['ev-billing','50000']])await p.locator('#'+id).fill(v);
 await p.locator('#ev-handling [data-h="out"]').click();await p.locator('#btn-save-event').click();await p.waitForTimeout(200);assert.match(await p.locator('#ev-modal').innerText(),/Choose who does the event/);
 await p.locator('#ev-out-ven').selectOption('kaka');await p.locator('#ev-out-charge').fill('44000');assert.match(await p.locator('#ev-out-hint').innerText(),/commission ₹6,000 · 12% · target 10–20%/);
 await p.locator('#btn-save-event').click();await p.waitForTimeout(300);
 const e=(await db(async d=>d.getAll('events'))).find(x=>x.name==='Small Birthday');assert.equal(e.outsourced,true);assert.equal(e.outVenId,'kaka');
 const xs=(await db(async d=>d.getAll('expenses'))).filter(x=>x.evId===e.id);assert.equal(xs.length,1);assert.equal(xs[0].amt,44000);assert.equal(xs[0].pay,'credit');assert.equal(xs[0].venId,'kaka');
 await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.waitForSelector('#tab-evdetail .detail-name');
 const t=await p.locator('#tab-evdetail').innerText();assert.match(t,/Outsourced/);assert.match(t,/Commission/);assert(!/No expenses recorded yet/.test(t));
 await p.locator('#n-expenses').click();assert.match(await p.locator('#to-pay-list').innerText(),/Kaka Caterers/);
});
await test('newer release found at start-up reloads once, never loops',async()=>{
 const q=await c.newPage();q.setDefaultTimeout(10000);
 await q.addInitScript(()=>{Object.defineProperty(window,'caterDeskUpdate',{configurable:true,get:()=>async()=>'9.9.9',set(){}});sessionStorage.setItem('loads',String(Number(sessionStorage.getItem('loads')||0)+1));});
 await q.goto(BASE_URL);await q.waitForSelector('#kpi .card');await q.waitForTimeout(1500);await q.waitForSelector('#kpi .card');
 assert.equal(await q.evaluate(()=>sessionStorage.getItem('loads')),'2','reloaded exactly once');
 assert.equal(await q.evaluate(()=>sessionStorage.getItem('ff_autoupdate_9.9.9')),'1');await q.close();
});
await test('v3.1: reopens last screen, resumes unsaved expense, vendor habits, cost vs usual, cash 30 days',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const chaat=H['Live Counter'].find(h=>h.startsWith('Chaat')),cook=H.Labour.find(h=>h.startsWith('Cook'));
 const soon=new Date();soon.setDate(soon.getDate()+10);const soonIso=soon.toISOString().slice(0,10);
 await seed({...empty(),vendors:[{id:'rajiv',name:'Rajiv Chaat',cat:'Live Counter'}],
  events:[{...ev,id:'a',name:'Golden A',menu:'golden',guests:100,date:'2026-08-01',billing:90000},{...ev,id:'b',name:'Golden B',menu:'golden',guests:100,date:'2026-09-01',billing:90000},{...ev,id:'s',name:'Soon Party',date:soonIso,billing:50000}],
  cPays:[{id:'cp',evId:'s',amt:20000,date:'2026-10-01'}],
  expenses:[{id:'1',evId:'a',cat:'Live Counter',head:chaat,amt:20000,date:'2026-08-01',pay:'credit',venId:'rajiv'},{id:'2',evId:'a',cat:'Labour',head:cook,amt:10000,date:'2026-08-01',pay:'paid',mode:'UPI'},
            {id:'3',evId:'b',cat:'Live Counter',head:chaat,amt:30000,date:'2026-09-01',pay:'credit',venId:'rajiv'},{id:'4',evId:'b',cat:'Labour',head:cook,amt:10000,date:'2026-09-01',pay:'paid',mode:'UPI'}]});await reconcileIds(['a','b']);
 // Cash: collect 1,60,000 (a, b overdue: 90k each; s: 30k) → to pay: 50,000 undated credit
 const cash=await p.locator('#cash-30').innerText();assert.match(cash,/Next 30 days[\s\S]*₹2,10,000[\s\S]*₹50,000[\s\S]*\+₹1,60,000/);
 // Cost vs usual: B's live counter 300/plate vs usual (from A) 200 → +50%
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Golden B'}).click();await p.waitForSelector('#cost-vs-usual');
 assert.match(await p.locator('#cost-vs-usual').innerText(),/Live Counter[\s\S]*₹300 · usual ₹200[\s\S]*\+50%/);
 await p.locator('#n-summary').click();await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();
 assert.match(await p.locator('#costs-higher').innerText(),/Live Counter[\s\S]*₹10,000/);
 // Vendor first: picking Rajiv fills Chaat and credit; a hand-picked item is never overridden
 await p.locator('#n-home').click();await p.locator('[data-action="quick"][data-id="expense"]').click();await p.waitForSelector('#exp-modal.active');
 await p.locator('#exp-vendor').selectOption('rajiv');assert.equal(await p.locator('#exp-head').inputValue(),chaat);assert.equal(await p.locator('#exp-pay').getAttribute('data-value'),'credit');
 await p.locator('#exp-cats [data-cat="Labour"]').click();await p.locator('#exp-vendor').selectOption('');await p.locator('#exp-vendor').selectOption('rajiv');assert.equal(await p.locator('#exp-cat').inputValue(),'Labour','hand-picked item kept');
 // Unsaved entry survives the app closing, and is offered back
 await p.locator('#exp-amt').fill('4321');await p.waitForTimeout(100);await p.reload();await p.waitForSelector('#kpi .card');
 assert.match(await p.locator('#toast').innerText(),/Unsaved expense ₹4,321/);await p.locator('#toast-action').click();await p.waitForSelector('#exp-modal.active');
 assert.equal(await p.locator('#exp-amt').inputValue(),'4321');assert.equal(await p.locator('#exp-cat').inputValue(),'Labour');
 await p.locator('#exp-modal [data-action="close-modal"]').click();await p.waitForTimeout(200);assert.equal(await p.evaluate(()=>localStorage.getItem('ffv2_expdraft')),null,'closing on purpose discards it');
 // Installed app reopens the last screen
 const q=await c.newPage();q.setDefaultTimeout(10000);await q.addInitScript(()=>{const mm=window.matchMedia.bind(window);window.matchMedia=m=>m.includes('standalone')?{matches:true,addEventListener(){},removeEventListener(){}}:mm(m);});
 await q.goto(BASE_URL);await q.waitForSelector('#kpi .card');await q.locator('#n-vendors').click();await q.reload();await q.waitForSelector('#tab-vendors.active');
 assert(await q.locator('#n-vendors[aria-current="page"]').count());await q.locator('#n-home').click();await q.close();
});
await test('call and WhatsApp for clients and vendors; vendor dues message',async()=>{
 await seed({...empty(),events:[{...ev,mobile:'9876543210'}],vendors:[{id:'m',name:'Murugan',cat:'Live Counter',phone:'9123456780'},{id:'n',name:'No Phone',cat:'Live Counter'}],
  expenses:[{id:'x',evId:'e',cat:'Live Counter',head:'Dosa – डोसा',amt:15000,date:'2026-10-25',pay:'credit',venId:'m'}],cPays:[{id:'cp',evId:'e',amt:10000,date:'2026-10-25'}]});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.waitForSelector('#ev-contact');
 const evLinks=await p.locator('#ev-contact a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));assert.equal(evLinks[0],'tel:+919876543210');assert.equal(evLinks[1],'https://wa.me/919876543210','paid event: plain WhatsApp chat');
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]',{hasText:'Murugan'}).click();await p.waitForSelector('#ven-contact');
 const vLinks=await p.locator('#ven-contact a').evaluateAll(a=>a.map(x=>x.getAttribute('href')));assert.equal(vLinks[0],'tel:+919123456780');assert.equal(vLinks[1],'https://wa.me/919123456780');
 const dues=decodeURIComponent(await p.locator('a',{hasText:'Share dues on WhatsApp'}).getAttribute('href'));assert.match(dues,/^https:\/\/wa\.me\/919123456780\?text=Namaste Murugan![\s\S]*Balance due to you: ₹15,000[\s\S]*• Dosa – Wedding/);
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]',{hasText:'No Phone'}).click();await p.locator('[data-action="open-ven-edit"]').click();await p.waitForSelector('#ven-modal.active');assert.equal(await p.locator('#ven-name').inputValue(),'No Phone');
 await p.locator('#ven-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
});
await test('contacts button fills name and number from the phone contact list',async()=>{
 const q=await c.newPage();q.setDefaultTimeout(10000);
 await q.addInitScript(()=>{window.ContactsManager=function(){};Object.defineProperty(navigator,'contacts',{configurable:true,value:{select:async()=>[{name:['Kaka Caterers'],tel:['+91 98765 43210','098765 43210','022 2345 6789']}]}});});
 await q.goto(BASE_URL);await q.waitForSelector('#kpi .card');await q.locator('#n-vendors').click();await q.locator('#fab').click();await q.waitForSelector('#ven-modal.active');
 await q.locator('[data-contact="ven"]').click();await q.waitForSelector('#ask-actions button');
 assert.deepEqual(await q.locator('#ask-actions button').allInnerTexts().then(t=>t.slice(0,2)),['9876543210','2223456789'],'duplicates merged, choice offered');
 await q.locator('#ask-actions button').first().click();await q.waitForTimeout(150);
 assert.equal(await q.locator('#ven-phone').inputValue(),'9876543210');assert.equal(await q.locator('#ven-name').inputValue(),'Kaka Caterers');
 await q.locator('#ven-modal [data-action="close-modal"]').click();await q.close();
 assert(await p.locator('[data-contact="ev"]').evaluate(b=>b.hidden),'hidden where the browser has no contact picker');
});
await test('event menu becomes counter orders sent on WhatsApp, tracked to delivery',async()=>{
 const t=new Date();const tmr=new Date(t);tmr.setDate(t.getDate()+1);const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 await seed({...empty(),events:[{...ev,date:iso(tmr),guests:300,venue:'Lawn'}],vendors:[{id:'rajiv',name:'Rajiv Chaat',cat:'Live Counter',specialty:'Chaat – चाट',phone:'9876543210'},{id:'mur',name:'Murugan',cat:'Live Counter',specialty:'Dosa – डोसा'}]});
 await p.evaluate(()=>{window.__opened=[];window.open=u=>{window.__opened.push(u);return null}});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.waitForSelector('[data-action="menu-edit"]');
 await p.locator('[data-action="menu-edit"]').click();await p.waitForSelector('#menu-modal.active');
 await p.locator('#menu-text').fill('1. Pani Puri\n2. Sev Puri, Masala Dosa\n• Dal Makhani\nStarters:\nGulab Jamun\npani puri');await p.locator('#btn-save-menu').click();await p.waitForSelector('#menu-orders');
 const card=await p.locator('#menu-orders').innerText();assert.match(card,/Chaat · Rajiv Chaat[\s\S]*Pani Puri, Sev Puri/);assert.match(card,/Dosa · Murugan[\s\S]*Masala Dosa/);assert.match(card,/Our kitchen[\s\S]*Dal Makhani, Gulab Jamun/);
 assert.equal((await db(async d=>d.getOne('events','e'))).dishes.length,5,'duplicates and headings dropped');
 // Teach it a dish: Gulab Jamun comes from the dessert counter, and it is remembered
 await p.locator('[data-action="dish-assign"]',{hasText:'Gulab Jamun'}).click();await p.locator('#ask-actions button',{hasText:'Dessert Counter'}).click();await p.waitForTimeout(250);
 assert.match(await p.locator('#menu-orders').innerText(),/Dessert Counter[\s\S]*Gulab Jamun/);
 const learned=await p.evaluate(async()=>{const u=await import('./utils.js');return u.dishCounter('gulab jamun',u.learnedDishes(window.D.events))});assert.equal(learned,'Dessert Counter');
 // Order the chaat counter: vendor and plates filled, WhatsApp message written
 await p.locator('[data-action="order-new"][data-id^="Chaat"]').click();await p.waitForSelector('#ord-modal.active');
 assert.equal(await p.locator('#ord-ven').inputValue(),'rajiv');assert.equal(await p.locator('#ord-plates').inputValue(),'300');
 await p.locator('#ord-time').fill('19:00');await p.locator('#btn-send-ord').click();await p.waitForTimeout(300);
 const url=decodeURIComponent((await p.evaluate(()=>window.__opened))[0]);assert.match(url,/^https:\/\/wa\.me\/919876543210\?text=Namaste Rajiv Chaat! Order for Wedding:[\s\S]*19:00[\s\S]*Venue: Lawn[\s\S]*Chaat for 300 plates[\s\S]*Items: Pani Puri, Sev Puri/);
 assert.match(await p.locator('#menu-orders').innerText(),/WhatsApp opened\s*· 300/,'opening WhatsApp is not marked as sent (v4.4.1)');assert.match(await p.locator('#menu-orders').innerText(),/Dessert Counter\n/,'no guessed vendor for an unknown counter');
 // Home shows tomorrow's delivery
 await p.locator('#n-home').click();assert.match(await p.locator('#deliveries').innerText(),/Tomorrow 19:00 · Rajiv Chaat[\s\S]*Chaat · 300 plates/);
 // Delivered opens the expense form for that counter and vendor
 await p.locator('#deliveries [data-action="evdetail"]').click();await p.waitForSelector('#menu-orders');
 await p.locator('[data-action="order-status"]').first().click();await p.locator('#ask-actions button',{hasText:'Delivered'}).click();await p.waitForSelector('#exp-modal.active');
 assert.match(await p.locator('#exp-head').inputValue(),/^Chaat/);assert.equal(await p.locator('#exp-vendor').inputValue(),'rajiv');
 await p.locator('#exp-amt').fill('27000');await p.locator('#btn-save-exp').click();await p.waitForTimeout(300);
 assert.equal((await db(async d=>d.getOne('events','e'))).orders[0].status,'delivered');
 // Murugan has no phone: the order is saved and the app says why WhatsApp did not open
 await p.locator('[data-action="order-new"][data-id^="Dosa"]').click();await p.waitForSelector('#ord-modal.active');await p.locator('#btn-send-ord').click();await p.waitForTimeout(300);
 assert.match(await p.locator('#toast').innerText(),/no phone number/);assert.equal((await p.evaluate(()=>window.__opened)).length,1);
 assert.equal((await db(async d=>d.getOne('events','e'))).orders.find(o=>/^Dosa/.test(o.head)).status,'prepared','saved but not sent: no phone');
});
await test('v3.3.1: new caterer on the go, outsourced menu, expenses by event, refresh',async()=>{
 await seed({...empty(),events:[{...ev,id:'own',name:'Own Wedding',date:'2026-12-01'},{...ev,id:'out',name:'Small Birthday',date:'2026-12-05',outsourced:true,outVenId:'kaka',guests:80}],
  vendors:[{id:'kaka',name:'Kaka Caterers',cat:'Operations',phone:'9876543210'}],
  expenses:[{id:'x1',evId:'own',cat:'Raw Material',head:'Grocery – किराणा',amt:1111,date:'2026-12-01',pay:'paid'},{id:'x2',evId:'out',cat:'Operations',head:'Outsourced Event – आउटसोर्स कार्यक्रम',amt:40000,date:'2026-12-05',pay:'credit',venId:'kaka'}]});
 await p.evaluate(()=>{window.__opened=[];window.open=u=>{window.__opened.push(u);return null}});
 // 1. "+ New vendor" from an outsourced event's Done by
 await p.locator('#n-events').click();await p.locator('#fab').click();await p.waitForSelector('#ev-modal.active');await p.locator('#ev-handling [data-h="out"]').click();
 await p.locator('#ev-out-ven').selectOption('__new');await p.waitForSelector('#ven-modal.active');assert.equal(await p.locator('#ven-cat').inputValue(),'Operations');
 await p.locator('#ven-name').fill('Annapurna Caterers');await p.locator('#btn-save-ven').click();await p.waitForTimeout(300);
 assert(await p.locator('#ev-modal.active').count(),'back on the event form');const newId=await p.locator('#ev-out-ven').inputValue();
 assert.equal((await db(async d=>d.getAll('vendors'))).find(v=>v.id===newId).name,'Annapurna Caterers');
 await p.locator('#ev-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
 // 3. outsourced event: the whole menu is one order to the caterer
 await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Small Birthday'}).click();await p.locator('[data-action="menu-edit"]').click();await p.waitForSelector('#menu-modal.active');
 await p.locator('#menu-text').fill('Pani Puri\nMasala Dosa\nDal Makhani');await p.locator('#btn-save-menu').click();await p.waitForSelector('#menu-orders');
 const card=await p.locator('#menu-orders').innerText();assert.match(card,/Whole event · Kaka Caterers[\s\S]*Pani Puri, Masala Dosa, Dal Makhani/);assert.equal(await p.locator('[data-action="dish-assign"]').count(),0);assert.equal(await p.locator('[data-action="order-new"]').count(),1);
 await p.locator('[data-action="order-new"]').click();await p.waitForSelector('#ord-modal.active');assert.equal(await p.locator('#ord-ven').inputValue(),'kaka');assert.equal(await p.locator('#ord-plates').inputValue(),'80');
 await p.locator('#btn-send-ord').click();await p.waitForTimeout(300);
 assert.match(decodeURIComponent((await p.evaluate(()=>window.__opened))[0]),/Full event catering for 80 guests[\s\S]*Menu: Pani Puri, Masala Dosa, Dal Makhani/);
 await p.locator('[data-action="order-status"]').click();await p.locator('#ask-actions button',{hasText:'Delivered'}).click();await p.waitForTimeout(300);
 assert.match(await p.locator('#toast').innerText(),/already recorded/);assert.equal(await p.locator('#exp-modal.active').count(),0,'charge not counted twice');
 // 4. expenses of one event, and Add goes to that event
 await p.locator('#n-expenses').click();await p.locator('#exp-ev-filter').selectOption('own');
 const rows=await p.locator('#exp-list [data-action="edit-exp"]').count();assert.equal(rows,1);assert.equal(await p.locator('#exp-tot').innerText(),'₹1,111');
 await p.locator('#fab').click();await p.waitForSelector('#exp-modal.active');assert.equal(await p.locator('#exp-ev').inputValue(),'own');
 await p.locator('#exp-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);await p.locator('#exp-ev-filter').selectOption('');
 // 2. coming back to the app picks up an entry made elsewhere
 await db(async d=>d.putOne('expenses',{id:'x3',evId:'own',cat:'Labour',head:'Cook – स्वयंपाकी',amt:2222,date:'2026-12-01',pay:'paid'}));
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(1500);assert.match(await p.locator('#exp-list').innerText(),/₹2,222/);
});
await test('v3.4: quote helper, receipt, price creep, labour sheet, quiet refresh, big New event',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const dosa=H['Live Counter'].find(h=>h.startsWith('Dosa')),cook=H.Labour.find(h=>h.startsWith('Cook')),boys=H.Labour.find(h=>h.startsWith('Boys'));
 await seed({...empty(),vendors:[{id:'mur',name:'Murugan',cat:'Live Counter',phone:'9123456780'}],
  events:[{...ev,id:'g1',name:'Golden One',menu:'golden',guests:100,billing:85000,date:'2026-08-01'},{...ev,id:'g2',name:'Golden Two',menu:'golden',guests:200,billing:170000,date:'2026-09-01',mobile:'9876543210'}],
  expenses:[{id:'a',evId:'g1',cat:'Live Counter',head:dosa,amt:5000,date:'2026-08-01',pay:'paid',venId:'mur'},{id:'b',evId:'g1',cat:'Raw Material',head:'Grocery – किराणा',amt:45000,date:'2026-08-01',pay:'paid'},
            {id:'c',evId:'g2',cat:'Live Counter',head:dosa,amt:12000,date:'2026-09-01',pay:'paid',venId:'mur'},{id:'d',evId:'g2',cat:'Raw Material',head:'Grocery – किराणा',amt:88000,date:'2026-09-01',pay:'paid'}],
  cPays:[{id:'cp1',evId:'g2',amt:50000,date:'2026-08-20',mode:'UPI'}]});await reconcileIds(['g1','g2']);
 // Big New event: full width above the other three
 const [ne,ae]=await p.locator('.qa-grid > .qa').evaluateAll(b=>b.slice(0,2).map(x=>x.getBoundingClientRect().width));assert(ne>ae*2.5,'New event spans the row');
 // Quiet refresh: no "Up to date" message
 await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForTimeout(1500);assert(!/Up to date/.test(await p.locator('#toast').innerText()));
 // Quote helper: Golden costs (50000+100000)/300 = 500/plate
 await p.locator('#n-events').click();await p.locator('#fab').click();await p.waitForSelector('#ev-modal.active');
 await p.locator('#ev-menu').selectOption('golden');await p.locator('#ev-guests').fill('250');
 const quote=await p.locator('#ev-quote').innerText();assert.match(quote,/Golden usually costs you ₹500\/plate \(2 reconciled events\)/);assert.match(quote,/margin is about 44%/);assert.match(quote,/quote at least ₹715\/plate/);assert.match(quote,/Card ₹900 · you actually billed ₹850\/plate on average \(2 events\)/);
 await p.locator('#ev-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
 // Receipt: WhatsApp link on the payment, with the account so far
 await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Golden Two'}).click();await p.waitForSelector('#tab-evdetail .detail-name');
 const rec=decodeURIComponent(await p.locator('a[aria-label="Send receipt on WhatsApp"]').getAttribute('href'));assert.match(rec,/^https:\/\/wa\.me\/919876543210\?text=Namaste! Payment receipt for Golden Two[\s\S]*Received: ₹50,000[\s\S]*Paid so far: ₹50,000\nBalance: ₹1,20,000/);
 await db(async d=>d.putOne('cPays',{id:'cp2',evId:'g2',amt:30000,date:'2026-08-25',mode:'Cash'}));await p.reload();await p.waitForSelector('#kpi .card');await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Golden Two'}).click();await p.waitForSelector('#tab-evdetail .detail-name');
 const recs=await p.locator('a[aria-label="Send receipt on WhatsApp"]').evaluateAll(a=>a.map(x=>decodeURIComponent(x.getAttribute('href'))));
 assert(recs.some(r=>/Received: ₹50,000[\s\S]*Paid so far: ₹50,000\n/.test(r)),'older receipt ignores the later payment');assert(recs.some(r=>/Received: ₹30,000[\s\S]*Paid so far: ₹80,000\n/.test(r)));
 // Labour sheet: rates remembered, saved as Labour expenses, edits update them in place
 await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');
 const r0=p.locator('#lab-rows [data-lab="0"]');await r0.locator('[data-k="role"]').selectOption(cook);await r0.locator('[data-k="c-f"]').fill('3');await r0.locator('[data-k="rate"]').fill('1200');
 await p.locator('#btn-lab-add').click();const r1=p.locator('#lab-rows [data-lab="1"]');await r1.locator('[data-k="role"]').selectOption(boys);await r1.locator('[data-k="c-e"]').fill('10');await r1.locator('[data-k="rate"]').fill('500');
 assert.equal(await p.locator('#lab-total').innerText(),'₹8,600');await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 let lab=(await db(async d=>d.getAll('expenses'))).filter(x=>x.evId==='g2'&&x.cat==='Labour');assert.equal(lab.length,2);assert.equal(lab.find(x=>x.head===cook).amt,3600);
 assert.match(await p.locator('#labour-card').innerText(),/Total · 13 shifts[\s\S]*₹8,600/);
 await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');await p.locator('#lab-rows [data-lab="1"] [data-lab-del]').click();await p.locator('#lab-rows [data-lab="0"] [data-k="c-f"]').fill('4');await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 lab=(await db(async d=>d.getAll('expenses'))).filter(x=>x.evId==='g2'&&x.cat==='Labour');assert.equal(lab.length,1,'removed worker type removed');assert.equal(lab[0].amt,4800,'updated in place');
 // Rate remembered on another event
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Golden One'}).click();await p.waitForSelector('[data-action="lab-edit"]');await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');
 await p.locator('#lab-rows [data-lab="0"] [data-k="role"]').selectOption(boys);await p.locator('#lab-rows [data-lab="0"] [data-k="role"]').selectOption(cook);
 assert(!(await p.locator('#btn-lab-copy').isHidden()),'copy from last event offered');await p.locator('#lab-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
 // Price creep: Murugan dosa 50/plate → 60/plate = +20%. The labour sheet added costs to Golden Two, which reopened it; reconcile it again (spend benchmarks use reconciled events only)
 await reconcileIds(['g2']);
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]',{hasText:'Murugan'}).click();await p.waitForSelector('#price-check');
 assert.match(await p.locator('#price-check').innerText(),/Dosa[\s\S]*₹60\/plate now · ₹50 before \(1 event\)[\s\S]*\+20%/);
 await p.locator('#n-summary').click();await p.locator('#tab-summary [data-period-seg] [data-id="all"]').click();assert.match(await p.locator('#price-creep').innerText(),/Murugan · Dosa[\s\S]*\+20%/);
});
await test('labour sheet matches real contractor bills (shifts, fare, mukadam fee, other work)',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const boys=H.Labour.find(h=>h.startsWith('Boys')),roj=H.Labour.find(h=>h.startsWith('Rojiya'));
 await seed({...empty(),vendors:[{id:'muk',name:'Mukadam',cat:'Labour'}],events:[{...ev,id:'lw',name:'Lake Lawn',guests:300,date:'2026-10-24'},{...ev,id:'k2',name:'Second',guests:200,date:'2026-10-30'}]});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Lake Lawn'}).click();await p.waitForSelector('[data-action="lab-edit"]');await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');
 assert.deepEqual(await p.locator('#lab-rows [data-lab="0"] [data-k^="c-"]').evaluateAll(i=>i.map(x=>x.previousElementSibling.textContent)),['Morning','Evening','Night','Full day','Loading','Late'],'one headcount box per shift, as on the bills');
 // Bill: 5 × 650 + 11 × 650, fare 11 × 24, mukadamgiri 500, ice cream cutting 200 = 11,364
 const row=i=>p.locator(`#lab-rows [data-lab="${i}"]`);
 await row(0).locator('[data-k="role"]').selectOption(boys);await row(0).locator('[data-k="c-f"]').fill('5');await row(0).locator('[data-k="rate"]').fill('650');
 await p.locator('#btn-lab-add').click();await row(1).locator('[data-k="role"]').selectOption(roj);await row(1).locator('[data-k="c-f"]').fill('11');await row(1).locator('[data-k="rate"]').fill('650');
 await p.locator('#btn-lab-extra').click();assert.equal(await row(2).locator('[data-k="extra"]').inputValue(),'travel');await row(2).locator('[data-k="count"]').fill('11');await row(2).locator('[data-k="rate"]').fill('24');
 await p.locator('#btn-lab-extra').click();assert.equal(await row(3).locator('[data-k="extra"]').inputValue(),'fee');await row(3).locator('[data-k="rate"]').fill('500');
 await p.locator('#btn-lab-extra').click();assert.equal(await row(4).locator('[data-k="extra"]').inputValue(),'other');await row(4).locator('[data-k="label"]').fill('Ice cream cutting');await row(4).locator('[data-k="rate"]').fill('200');
 assert.equal(await p.locator('#lab-total').innerText(),'₹11,364','same total as the bill');
 await p.locator('#lab-pay [data-pay="credit"]').click();await p.locator('#lab-ven').selectOption('muk');await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 const xs=(await db(async d=>d.getAll('expenses'))).filter(x=>x.evId==='lw');
 const by=h=>xs.find(x=>x.head.startsWith(h));
 assert.equal(xs.reduce((s,x)=>s+x.amt,0),11364);assert.equal(by('Boys').amt,3250);assert.equal(by('Rojiya').amt,7150);
 assert.equal(by('Transport').amt,264);assert.equal(by('Transport').cat,'Operations','fare counts as transport');assert.equal(by('Contractor Fee').amt,500);assert.equal(by('Other Labour Work').amt,200);assert.match(by('Other Labour Work').notes,/Ice cream cutting/);
 assert(xs.every(x=>x.pay==='credit'&&x.venId==='muk'),'all owed to the mukadam');
 assert.match(await p.locator('#labour-card').innerText(),/Ice cream cutting[\s\S]*Total · 16 shifts[\s\S]*₹11,364/);
 // Second bill: 13 boys evening × 700 + vehicle 1,000 = 10,100; copy the last sheet then adjust
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Second'}).click();await p.waitForSelector('[data-action="lab-edit"]');await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');
 await row(0).locator('[data-k="role"]').selectOption(boys);assert.equal(await row(0).locator('[data-k="rate"]').inputValue(),'650','Boys rate remembered from the last bill');
 await row(0).locator('[data-k="c-e"]').fill('13');await row(0).locator('[data-k="rate"]').fill('700');
 await p.locator('#btn-lab-extra').click();assert.equal(await row(1).locator('[data-k="rate"]').inputValue(),'24','last fare rate remembered');await row(1).locator('[data-k="count"]').fill('1');await row(1).locator('[data-k="rate"]').fill('1000');
 assert.equal(await p.locator('#lab-total').innerText(),'₹10,100');await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 // The mukadam's page shows what you owe across both events (to check against his running bill)
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]',{hasText:'Mukadam'}).click();await p.waitForSelector('#tab-vendetail .detail-name');
 const owed=(await db(async d=>d.getAll('expenses'))).filter(x=>x.venId==='muk').reduce((s,x)=>s+x.amt,0);assert.equal(owed,11364,'second sheet paid now by default, so only the first is owed');
});
await test('meals (any mix of breakfast, lunch, high tea, dinner), headcount per shift and bill total',async()=>{
 const H=await p.evaluate(async()=>(await import('./utils.js')).EXPENSE_HEADS);const boys=H.Labour.find(h=>h.startsWith('Boys'));
 await seed({...empty(),events:[{...ev,guests:300}]});
 // Meal: lunch ticks breakfast by default; dinner leaves high tea off; tapping again clears
 await p.locator('#n-events').click();await p.locator('#fab').click();await p.waitForSelector('#ev-modal.active');
 const pressed=m=>p.locator(`#ev-meals [data-meal="${m}"]`).getAttribute('aria-pressed');
 await p.locator('#ev-meals [data-meal="lunch"]').click();assert.equal(await pressed('breakfast'),'true','lunch brings breakfast');
 await p.locator('#ev-meals [data-meal="hightea"]').click();await p.locator('#ev-meals [data-meal="dinner"]').click();assert.equal(await pressed('hightea'),'true');
 for(const [id,v] of [['ev-name','Dinner Party'],['ev-date','2026-12-12'],['ev-venue','Hall'],['ev-billing','90000']])await p.locator('#'+id).fill(v);await p.locator('#btn-save-event').click();await p.waitForTimeout(300);
 const dp=(await db(async d=>d.getAll('events'))).find(e=>e.name==='Dinner Party');assert.deepEqual(dp.meals,['breakfast','lunch','hightea','dinner'],'all four, in day order');
 assert.match(await p.locator('#ev-list').innerText(),/4 meals/);
 await p.locator('#ev-list [data-action="evdetail"]',{hasText:'Dinner Party'}).click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');
 await p.locator('#ev-meals [data-meal="breakfast"]').click();await p.locator('#ev-meals [data-meal="lunch"]').click();await p.locator('#btn-save-event').click();await p.waitForTimeout(300);
 assert.deepEqual((await db(async d=>d.getAll('events'))).find(e=>e.name==='Dinner Party').meals,['hightea','dinner'],'unticking works');
 await p.locator('#n-events').click();
 // Labour: headcount per shift (Night 4, Morning 9, Evening 5) × 600, travel 1,000; bill 11,900 → +100 shown as a bill adjustment
 await p.locator('#ev-list [data-action="evdetail"][data-id="e"]').click();await p.waitForSelector('[data-action="lab-edit"]');
 assert(await p.locator('#hdr-refresh').isHidden(),'detail pages keep the top bar uncluttered');await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');
 const row=i=>p.locator(`#lab-rows [data-lab="${i}"]`);
 await row(0).locator('[data-k="role"]').selectOption(boys);await row(0).locator('[data-k="c-m"]').fill('13');await row(0).locator('[data-k="c-e"]').fill('6.5');await row(0).locator('[data-k="rate"]').fill('333.33');
 assert.match(await row(0).locator('[data-lab-line="0"]').innerText(),/₹6,499\.94/,'money rounded to the paisa');
 await row(0).locator('[data-k="c-n"]').fill('4');await row(0).locator('[data-k="c-m"]').fill('9');await row(0).locator('[data-k="c-e"]').fill('5');await row(0).locator('[data-k="rate"]').fill('600');
 assert.match(await row(0).locator('[data-lab-line="0"]').innerText(),/18 shifts × ₹600 = ₹10,800/,'not every worker does every shift');
 await p.locator('#btn-lab-extra').click();assert.equal(await row(1).locator('[data-k="extra"] option:checked').innerText(),'Travel');await row(1).locator('[data-k="rate"]').fill('1000');
 assert.equal(await p.locator('#lab-total').innerText(),'₹11,800');
 await p.locator('#lab-bill').fill('11900');assert.match(await p.locator('#lab-bill-hint').innerText(),/bill adjustment \+₹100/);assert.equal(await p.locator('#lab-total').innerText(),'₹11,900');
 await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 const xs=(await db(async d=>d.getAll('expenses'))).filter(x=>x.evId==='e');assert.equal(xs.reduce((s,x)=>s+x.amt,0),11900,'final amount matches the bill');
 assert.equal(xs.find(x=>x.head===boys).amt,10900);assert.match(xs.find(x=>x.head===boys).notes,/Morning 9 · Evening 5 · Night 4 @ ₹600[\s\S]*bill adjustment \+₹100 \(bill ₹11,900\)/);
 const card=await p.locator('#labour-card').innerText();assert.match(card,/Morning 9 · Evening 5 · Night 4[\s\S]*₹10,800[\s\S]*₹1,000[\s\S]*Bill adjustment[\s\S]*\+₹100[\s\S]*Total · 18 shifts[\s\S]*₹11,900/,'lines and adjustment add up to the total shown');
 // Reopen: bill total kept; clearing it goes back to the lines
 await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');assert.equal(await p.locator('#lab-bill').inputValue(),'11900');
 await p.locator('#lab-bill').fill('');await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 assert.equal((await db(async d=>d.getAll('expenses'))).filter(x=>x.evId==='e').reduce((s,x)=>s+x.amt,0),11800);
});
await test('labour sheets saved before per-shift headcounts still open and add up',async()=>{
 await seed({...empty(),events:[{...ev,labour:{rows:[{id:'l1',role:'Boys – बॉईज',count:10,shift:'n',shifts:3,rate:600}],pay:'paid',mode:'',venId:'',expIds:{}}}]});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.waitForSelector('#labour-card');
 assert.match(await p.locator('#labour-card').innerText(),/Night 30[\s\S]*₹18,000[\s\S]*Total · 30 shifts[\s\S]*₹18,000/);
 await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');assert.equal(await p.locator('#lab-rows [data-lab="0"] [data-k="c-n"]').inputValue(),'30');
 await p.locator('#lab-modal [data-action="close-modal"]').click();await p.waitForTimeout(150);
});
await test('v4.0.2: editing an event keeps its menu, orders, labour sheet, photos and unknown fields',async()=>{
 const nested={dishes:[{name:'Pani Puri',head:'Chaat – चाट',manual:true}],orders:[{id:'o1',head:'Chaat – चाट',venId:'v',plates:100,date:'2026-10-01',time:'19:00',notes:'',status:'confirmed',at:'2026-09-30T10:00:00.000Z'}],
  labour:{rows:[{id:'l1',role:'Boys – बॉईज',rate:600,counts:{e:10}}],pay:'paid',mode:'',venId:'',expIds:{'Labour|Boys – बॉईज':'x1'},billTotal:6000},
  meals:['lunch'],menu:'golden',photoIds:['ph1'],futureField:{keep:'me'},quoteRef:'Q-7'};
 await seed({...empty(),vendors:[{id:'v',name:'Synthetic Vendor',cat:'Live Counter'}],photos:[{id:'ph1',eventId:'e',data:'data:image/png;base64,AA=='}],
  events:[{...ev,guests:100,...nested}],expenses:[{id:'x1',evId:'e',cat:'Labour',head:'Boys – बॉईज',amt:6000,date:'2026-10-25',pay:'paid',notes:'Labour sheet: Evening 10 @ ₹600'}]});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');
 await p.locator('#ev-guests').fill('120');await p.locator('#ev-name').fill('Wedding Renamed');await p.locator('#btn-save-event').click();await p.waitForTimeout(400);
 const e=await db(async d=>d.getOne('events','e'));
 assert.equal(e.guests,120);assert.equal(e.name,'Wedding Renamed');
 for(const k of ['dishes','orders','labour','photoIds','futureField','quoteRef','menu','meals'])assert.deepEqual(e[k],nested[k],k+' kept after edit');
 // The labour sheet still owns its expense: re-saving it updates in place, no duplicate
 await p.waitForSelector('[data-action="lab-edit"]');await p.locator('[data-action="lab-edit"]').click();await p.waitForSelector('#lab-modal.active');
 await p.locator('#lab-rows [data-lab="0"] [data-k="c-e"]').fill('12');await p.locator('#lab-bill').fill('');await p.locator('#btn-save-lab').click();await p.waitForTimeout(400);
 const lab=(await db(async d=>d.getAll('expenses'))).filter(x=>x.cat==='Labour');assert.equal(lab.length,1,'no duplicate labour expense');assert.equal(lab[0].id,'x1');assert.equal(lab[0].amt,7200);
 // Clearing things the form controls still clears them
 await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');await p.locator('#ev-meals [data-meal="lunch"]').click();await p.locator('#btn-save-event').click();await p.waitForTimeout(400);
 const e2=await db(async d=>d.getOne('events','e'));assert.equal(e2.meals,undefined,'meals unticked are removed');assert.deepEqual(e2.dishes,nested.dishes);assert.deepEqual(e2.futureField,nested.futureField);
});
await test('v4.0.2: outsourced on/off is applied without touching other nested data',async()=>{
 await seed({...empty(),vendors:[{id:'k',name:'Kaka',cat:'Operations'}],events:[{...ev,outsourced:true,outVenId:'k',dishes:[{name:'Thali',head:''}],futureField:1}]});
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');
 await p.locator('#ev-handling [data-h="own"]').click();await p.locator('#btn-save-event').click();await p.waitForTimeout(400);
 const e=await db(async d=>d.getOne('events','e'));assert.equal(e.outsourced,undefined);assert.equal(e.outVenId,undefined);assert.deepEqual(e.dishes,[{name:'Thali',head:''}]);assert.equal(e.futureField,1);
});
await test('v4.0.2: a form opened before the record changed elsewhere cannot overwrite it',async()=>{
 await seed({...empty(),vendors:[{id:'v',name:'Vendor A',cat:'Raw Material',phone:'9000000001'}],events:[{...ev,guests:100}],
  expenses:[{id:'x',evId:'e',cat:'Raw Material',head:'Grocery – किराणा',amt:500,date:'2026-10-25',pay:'paid'}],cPays:[{id:'c',evId:'e',amt:100,date:'2026-10-25'}],vPays:[{id:'vp',venId:'v',amt:50,date:'2026-10-25'}]});
 // Event: another window adds a labour sheet while this form is open
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');
 await db(async d=>{const r=await d.getOne('events','e');await d.putOne('events',{...r,labour:{rows:[{id:'l',role:'Cook – स्वयंपाकी',rate:900,counts:{f:2}}],pay:'paid',mode:'',venId:'',expIds:{}}})});
 await p.locator('#ev-guests').fill('999');await p.locator('#btn-save-event').click();await p.waitForTimeout(400);
 assert.match(await p.locator('#toast').innerText(),/changed in another/);let e=await db(async d=>d.getOne('events','e'));assert.equal(e.guests,100,'stale form refused');assert.equal(e.labour.rows.length,1,'newer data kept');
 await p.locator('#ev-modal [data-action="close-modal"]').click();await p.waitForTimeout(200);
 // Expense, client payment, vendor and vendor payment forms behave the same
 const stale=async(open,store,id,change,fill,save)=>{await open();await db(async(d,a)=>{const r=await d.getOne(a.store,a.id);await d.putOne(a.store,{...r,...a.change})},{store,id,change});
  await fill();await p.locator(save).click();await p.waitForTimeout(400);const r=await db(async(d,a)=>d.getOne(a.store,a.id),{store,id});await p.locator('.modal-ov.active [data-action="close-modal"]').first().click().catch(()=>{});await p.waitForTimeout(200);return r;};
 await p.reload();await p.waitForSelector('#kpi .card');
 let r=await stale(async()=>{await p.locator('#n-expenses').click();await p.locator('#exp-list [data-action="edit-exp"]').first().click();await p.waitForSelector('#exp-modal.active');},'expenses','x',{notes:'changed elsewhere'},async()=>p.locator('#exp-amt').fill('999'),'#btn-save-exp');
 assert.equal(r.amt,500);assert.equal(r.notes,'changed elsewhere');
 r=await stale(async()=>{await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('[data-action="edit-cpay"]').click();await p.waitForSelector('#cpay-modal.active');},'cPays','c',{notes:'changed elsewhere'},async()=>p.locator('#cpay-amt').fill('999'),'#btn-save-cpay');
 assert.equal(r.amt,100);assert.equal(r.notes,'changed elsewhere');
 r=await stale(async()=>{await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]').first().click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ven-modal.active');},'vendors','v',{notes:'changed elsewhere'},async()=>p.locator('#ven-name').fill('Vendor B'),'#btn-save-ven');
 assert.equal(r.name,'Vendor A');assert.equal(r.notes,'changed elsewhere');
 r=await stale(async()=>{await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]').first().click();await p.locator('[data-action="edit-vpay"]').click();await p.waitForSelector('#vpay-modal.active');},'vPays','vp',{notes:'changed elsewhere'},async()=>p.locator('#vpay-amt').fill('999'),'#btn-save-vpay');
 assert.equal(r.amt,50);assert.equal(r.notes,'changed elsewhere');
});
await test('v4.0.2: expense, payment and vendor edits keep unknown fields; repeated saves make one change',async()=>{
 await seed({...empty(),vendors:[{id:'v',name:'Vendor A',cat:'Raw Material',futureField:'v'},{id:'pp',name:'Uncle',kind:'person'}],events:[{...ev}],
  expenses:[{id:'x',evId:'e',cat:'Raw Material',head:'Grocery – किराणा',amt:500,date:'2026-10-25',pay:'paid',futureField:'x'}],cPays:[{id:'c',evId:'e',amt:100,date:'2026-10-25',futureField:'c'}],vPays:[{id:'vp',venId:'v',amt:50,date:'2026-10-25',futureField:'vp'}]});
 await p.locator('#n-expenses').click();await p.locator('#exp-list [data-action="edit-exp"]').first().click();await p.waitForSelector('#exp-modal.active');
 await p.locator('#exp-amt').fill('600');await p.locator('#btn-save-exp').evaluate(b=>{b.click();b.click()});await p.waitForTimeout(500);
 let xs=await db(async d=>d.getAll('expenses'));assert.equal(xs.length,1,'double tap saves once');assert.equal(xs[0].amt,600);assert.equal(xs[0].futureField,'x');
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('[data-action="edit-cpay"]').click();await p.waitForSelector('#cpay-modal.active');
 await p.locator('#cpay-amt').fill('150');await p.locator('#btn-save-cpay').click();await p.waitForTimeout(400);
 const c=await db(async d=>d.getOne('cPays','c'));assert.equal(c.amt,150);assert.equal(c.futureField,'c');
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]',{hasText:'Vendor A'}).click();await p.locator('[data-action="edit-vpay"]').click();await p.waitForSelector('#vpay-modal.active');
 await p.locator('#vpay-amt').fill('75');await p.locator('#btn-save-vpay').click();await p.waitForTimeout(400);
 const vp=await db(async d=>d.getOne('vPays','vp'));assert.equal(vp.amt,75);assert.equal(vp.futureField,'vp');
 await p.locator('#hdr-edit').click();await p.waitForSelector('#ven-modal.active');await p.locator('#ven-phone').fill('9000000002');await p.locator('#btn-save-ven').click();await p.waitForTimeout(400);
 const v=await db(async d=>d.getOne('vendors','v'));assert.equal(v.phone,'9000000002');assert.equal(v.futureField,'v');
 // A person turned into a vendor loses the person marker; nothing else
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]',{hasText:'Uncle'}).click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ven-modal.active');
 await p.locator('#ven-kind [data-kind="vendor"]').click();await p.locator('#btn-save-ven').click();await p.waitForTimeout(400);
 assert.equal((await db(async d=>d.getOne('vendors','pp'))).kind,undefined);
 // A filled-in bill draft becomes a normal expense (draft flag removed)
 await db(async d=>d.putOne('expenses',{id:'dr',draft:true,createdAt:'2026-10-25T00:00:00.000Z',evId:'e',date:'2026-10-25',amt:0,cat:'',head:'',pay:'paid',mode:'',venId:'',notes:'',billIds:[]}));
 await p.reload();await p.waitForSelector('#kpi .card');await p.locator('#nudges [data-action="fill-draft"]').click();await p.waitForSelector('#exp-modal.active');
 await p.locator('#exp-amt').fill('321');await p.locator('#btn-save-exp').click();await p.waitForTimeout(400);
 const dr=await db(async d=>d.getOne('expenses','dr'));assert.equal(dr.draft,undefined,'draft flag cleared');assert.equal(dr.amt,321);
});
await test('v4.0.2: opening snapshots are independent copies, not live references',async()=>{
 await seed({...empty(),vendors:[{id:'v',name:'Vendor A',cat:'Raw Material'}],events:[{...ev,guests:100,dishes:[{name:'Thali',head:''}]}],
  expenses:[{id:'x',evId:'e',cat:'Raw Material',head:'Grocery – किराणा',amt:500,date:'2026-10-25',pay:'paid'}],cPays:[{id:'c',evId:'e',amt:100,date:'2026-10-25'}],vPays:[{id:'vp',venId:'v',amt:50,date:'2026-10-25'}]});
 // While a form is open, the stored record changes and the in-memory object is updated in place to match it,
 // revision included. A reference snapshot would follow the change and let the
 // stale form overwrite it; an independent copy still holds the opening values, so the save is refused.
 const mutateBoth=(store,list,id,change)=>p.evaluate(async a=>{const d=await import('./db.js');const cur=await d.getOne(a.store,a.id);await d.putOne(a.store,{...cur,...a.change});
   // bring the in-memory object up to the stored version in place, revision included (as an in-place update would)
   Object.assign(window.D[a.list].find(r=>r.id===a.id),await d.getOne(a.store,a.id));},{store,list,id,change});
 const check=async(store,id,field,expected)=>{const r=await db(async(d,a)=>d.getOne(a.store,a.id),{store,id});assert.equal(r[field],expected,`${store}.${field} not overwritten by the stale form`);
   assert.match(await p.locator('#toast').innerText(),/changed in another/);await p.locator('.modal-ov.active [data-action="close-modal"]').first().click().catch(()=>{});await p.waitForTimeout(200);};
 await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');
 await mutateBoth('events','events','e',{notes:'changed elsewhere'});await p.locator('#ev-guests').fill('777');await p.locator('#btn-save-event').click();await p.waitForTimeout(400);
 await check('events','e','notes','changed elsewhere');assert.equal((await db(async d=>d.getOne('events','e'))).guests,100);
 await p.locator('[data-action="edit-cpay"]').click();await p.waitForSelector('#cpay-modal.active');
 await mutateBoth('cPays','cPays','c',{notes:'changed elsewhere'});await p.locator('#cpay-amt').fill('777');await p.locator('#btn-save-cpay').click();await p.waitForTimeout(400);
 await check('cPays','c','notes','changed elsewhere');
 await p.locator('#n-expenses').click();await p.locator('#exp-list [data-action="edit-exp"]').first().click();await p.waitForSelector('#exp-modal.active');
 await mutateBoth('expenses','expenses','x',{notes:'changed elsewhere'});await p.locator('#exp-amt').fill('777');await p.locator('#btn-save-exp').click();await p.waitForTimeout(400);
 await check('expenses','x','notes','changed elsewhere');
 await p.locator('#n-vendors').click();await p.locator('#ven-list [data-action="vendetail"]').first().click();await p.locator('[data-action="edit-vpay"]').click();await p.waitForSelector('#vpay-modal.active');
 await mutateBoth('vPays','vPays','vp',{notes:'changed elsewhere'});await p.locator('#vpay-amt').fill('777');await p.locator('#btn-save-vpay').click();await p.waitForTimeout(400);
 await check('vPays','vp','notes','changed elsewhere');
 await p.locator('#hdr-edit').click();await p.waitForSelector('#ven-modal.active');
 await mutateBoth('vendors','vendors','v',{notes:'changed elsewhere'});await p.locator('#ven-name').fill('Vendor B');await p.locator('#btn-save-ven').click();await p.waitForTimeout(400);
 await check('vendors','v','notes','changed elsewhere');assert.equal((await db(async d=>d.getOne('vendors','v'))).name,'Vendor A');
 // An unchanged record still saves normally from a cloned snapshot
 await p.reload();await p.waitForSelector('#kpi .card');await p.locator('#n-events').click();await p.locator('#ev-list [data-action="evdetail"]').first().click();await p.locator('#hdr-edit').click();await p.waitForSelector('#ev-modal.active');
 await p.locator('#ev-guests').fill('130');await p.locator('#btn-save-event').click();await p.waitForTimeout(400);
 const e=await db(async d=>d.getOne('events','e'));assert.equal(e.guests,130);assert.deepEqual(e.dishes,[{name:'Thali',head:''}]);assert.equal(e.notes,'changed elsewhere');
});
results.push({name:'unexpected page errors',pass:errors.length===0,errors});fs.writeFileSync('test-artifacts/repair-test-results.json',JSON.stringify(results,null,2));await browser.close();console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
