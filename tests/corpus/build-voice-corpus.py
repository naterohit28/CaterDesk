# Builds tests/corpus/voice-corpus.json: the permanent multilingual test set for CaterDesk's sentence understanding
# (public/nl.js). 26 kinds of everyday catering entries × 4 languages (English, Hindi, Marathi, Hinglish) × 4 variations
# = 416 sentences, each with the values the app must find (or the clarification it must ask for).
# Synthetic names and amounts only: no client records, no production data. Run with: python -I tests/corpus/build-voice-corpus.py
# The JSON is committed; re-run only to change the corpus, then review the diff.
import json, os

LANGS = ['en', 'hi', 'mr', 'hg']
# Spoken amounts, per language (digits are used for the other variations)
A = {
  1500: ['one thousand five hundred', 'डेढ़ हजार', 'दीड हजार', 'dedh hazaar'],
  2500: ['two thousand five hundred', 'ढाई हजार', 'अडीच हजार', 'adhai hazaar'],
  2700: ['twenty seven hundred', 'सत्ताईस सौ', 'सत्तावीसशे', 'sattais sau'],
  1400: ['fourteen hundred', 'चौदह सौ', 'चौदाशे', 'chaudah sau'],
  8500: ['eight thousand five hundred', 'साढ़े आठ हजार', 'साडेआठ हजार', 'saadhe aath hazaar'],
  4500: ['forty five hundred', 'पैंतालीस सौ', 'साडेचार हजार', 'saadhe chaar hazaar'],
  125000: ['one lakh twenty five thousand', 'सवा लाख', 'सव्वा लाख', 'sava lakh'],
  50000: ['fifty thousand', 'पचास हजार', 'पन्नास हजार', 'pachas hazaar'],
  5000: ['five thousand', 'पांच हजार', 'पाच हजार', 'paanch hazaar'],
  2000: ['two thousand', 'दो हजार', 'दोन हजार', 'do hazaar'],
}
N = {15: ['fifteen', 'पंद्रह', 'पंधरा', 'pandrah'], 12: ['twelve', 'बारह', 'बारा', 'barah'], 20: ['twenty', 'बीस', 'वीस', 'bees'],
     3: ['three', 'तीन', 'तीन', 'teen'], 2: ['two', 'दो', 'दोन', 'do'], 8: ['eight', 'आठ', 'आठ', 'aath']}
def amt(v, li, words): return A[v][li] if words else str(v)
def num(v, li, words): return N[v][li] if words else str(v)
ITEM = {  # name per language, Marathi "of" form, expected head
  'veg': (['vegetables', 'सब्जी', 'भाजी', 'sabzi'], 'भाजीचे', 'Vegetable – भाजी'),
  'gas': (['gas', 'गैस', 'गॅस', 'gas'], 'गॅसचे', 'Gas / Cylinder – सिलिंडर'),
  'paneer': (['paneer', 'पनीर', 'पनीर', 'paneer'], 'पनीरचे', 'Milk & Dairy – दूध व दुग्धजन्य पदार्थ'),
  'tempo': (['tempo', 'टेम्पो', 'टेम्पो', 'tempo'], 'टेम्पोचे', 'Transport – वाहतूक'),
}
MODE = {'cash': (['cash', 'नकद', 'रोख', 'cash'], 'Cash – रोख'), 'upi': (['UPI', 'यूपीआई', 'यूपीआय', 'GPay'], 'UPI')}
def it(k, li): return ITEM[k][0][li]
def itc(k): return ITEM[k][1]
def md(k, li): return MODE[k][0][li]

T = []   # (id, what it checks, [fills], render(li, fill) -> text, expect(fill) -> dict)
def tpl(tid, about, fills, render, expect): T.append((tid, about, fills, render, expect))

tpl('paid', 'paid expense', [(4500, 0, 'veg', 'cash'), (1200, 0, 'gas', 'upi'), (2700, 1, 'gas', 'cash'), (1500, 1, 'tempo', 'upi')],
  lambda li, f: [f'Paid {amt(f[0], li, f[1])} {md(f[3], li)} for {it(f[2], li)}', f'{it(f[2], li)} के {amt(f[0], li, f[1])} {md(f[3], li)} दिए',
                 f'{itc(f[2])} {amt(f[0], li, f[1])} {md(f[3], li)} दिले', f'{it(f[2], li)} ka {amt(f[0], li, f[1])} {md(f[3], li)} diya'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'pay': 'paid', 'mode': MODE[f[3]][1], 'head': ITEM[f[2]][2]})
tpl('credit', 'expense on credit', [(8500, 1, 'paneer'), (3200, 0, 'veg'), (1400, 1, 'gas'), (2490, 0, 'paneer')],
  lambda li, f: [f'{it(f[2], li)} {amt(f[0], li, f[1])} on credit', f'{it(f[2], li)} के {amt(f[0], li, f[1])} उधार', f'{itc(f[2])} {amt(f[0], li, f[1])} उधार', f'{it(f[2], li)} {amt(f[0], li, f[1])} udhaar'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'pay': 'credit', 'head': ITEM[f[2]][2]})
tpl('event-name', 'expense for a named event', [(4500, 0, 'veg', 'cash'), (2000, 0, 'gas', 'upi'), (2500, 1, 'veg', 'cash'), (1800, 0, 'tempo', 'cash')],
  lambda li, f: [f'{amt(f[0], li, f[1])} {md(f[3], li)} for {it(f[2], li)} for the Patil wedding', f'पाटिल की शादी के लिए {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)}',
                 f'पाटील लग्नासाठी {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)}', f'Patil shaadi ke liye {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)}'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'pay': 'paid', 'mode': MODE[f[3]][1], 'event': 'P'})
tpl('event-venue', 'expense found by venue or locality', [(4500, 0, 'veg', 'cash'), (1200, 0, 'gas', 'cash'), (1400, 1, 'gas', 'upi'), (3000, 0, 'tempo', 'cash')],
  lambda li, f: [f'MLA Hall {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)}', f'नेरुल में {it(f[2], li)} के {amt(f[0], li, f[1])} {md(f[3], li)} दिए',
                 f'नेरुळला {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)}', f'Nerul {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)}'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'mode': MODE[f[3]][1], 'event': 'K'})
tpl('receipt', 'client payment', [(50000, 0, 'upi'), (50000, 1, 'cash'), (20000, 0, 'cash'), (125000, 1, 'upi')],
  lambda li, f: [f'Received {amt(f[0], li, f[1])} from the client by {md(f[2], li)}', f'ग्राहक से {amt(f[0], li, f[1])} मिले {md(f[2], li)}',
                 f'ग्राहकाकडून {amt(f[0], li, f[1])} मिळाले {md(f[2], li)}', f'Client ne {amt(f[0], li, f[1])} diye {md(f[2], li)}'][li],
  lambda f: {'kind': 'cpay', 'amount': f[0], 'mode': MODE[f[2]][1]})
tpl('client-advance', 'client advance for an event', [(10000, 0, 'cash'), (5000, 1, 'upi'), (25000, 0, 'cash'), (2000, 1, 'cash')],
  lambda li, f: [f'Desai advance {amt(f[0], li, f[1])} received in {md(f[2], li)}', f'देसाई से {amt(f[0], li, f[1])} एडवांस मिला {md(f[2], li)}',
                 f'देसाईंकडून {amt(f[0], li, f[1])} ॲडव्हान्स मिळाला {md(f[2], li)}', f'Desai client ne {amt(f[0], li, f[1])} advance diya {md(f[2], li)}'][li],
  lambda f: {'kind': 'cpay', 'amount': f[0], 'advance': True, 'event': 'D', 'mode': MODE[f[2]][1]})
tpl('vendor-pay', 'payment to a contractor', [(5000, 0, 'upi'), (5000, 1, 'cash'), (2500, 0, 'upi'), (2000, 1, 'upi')],
  lambda li, f: [f'Paid Ramesh {amt(f[0], li, f[1])} by {md(f[2], li)}', f'रमेश को {amt(f[0], li, f[1])} {md(f[2], li)} दिए', f'रमेशला {amt(f[0], li, f[1])} {md(f[2], li)} दिले', f'Ramesh ko {amt(f[0], li, f[1])} {md(f[2], li)} diye'][li],
  lambda f: {'kind': 'payven', 'amount': f[0], 'vendor': 'ram', 'mode': MODE[f[2]][1]})
tpl('vendor-advance', 'advance to a contractor', [(2000, 0, 'cash'), (5000, 1, 'upi'), (3000, 0, 'cash'), (2000, 1, 'cash')],
  lambda li, f: [f'Gave Ramesh {amt(f[0], li, f[1])} advance in {md(f[2], li)}', f'रमेश को {amt(f[0], li, f[1])} एडवांस {md(f[2], li)} दिए', f'रमेशला {amt(f[0], li, f[1])} ॲडव्हान्स {md(f[2], li)} दिले', f'Ramesh ko {amt(f[0], li, f[1])} advance {md(f[2], li)} diya'][li],
  lambda f: {'kind': 'payven', 'amount': f[0], 'vendor': 'ram', 'advance': True})
tpl('negative', 'not paid: nothing proposed', [(1200, 0, 'gas'), (4500, 1, 'veg'), (2000, 0, 'tempo'), (1500, 1, 'gas')],
  lambda li, f: [f'Did not pay {amt(f[0], li, f[1])} for {it(f[2], li)}', f'{it(f[2], li)} के {amt(f[0], li, f[1])} नहीं दिए', f'{itc(f[2])} {amt(f[0], li, f[1])} दिले नाहीत', f'{it(f[2], li)} ka {amt(f[0], li, f[1])} nahi diya'][li],
  lambda f: {'kind': 'unclear', 'reason': 'negative'})
tpl('future-pay', 'still to pay: nothing proposed', [(5000, 0), (2000, 1), (10000, 0), (5000, 1)],
  lambda li, f: [f'Will pay Ramesh {amt(f[0], li, f[1])} tomorrow', f'रमेश को {amt(f[0], li, f[1])} कल देने हैं', f'रमेशला {amt(f[0], li, f[1])} उद्या देणार', f'Ramesh ko {amt(f[0], li, f[1])} kal dena hai'][li],
  lambda f: {'kind': 'unclear', 'reason': 'future'})
tpl('future-receipt', 'still to come: never money received', [(5000, 0), (50000, 1), (20000, 0), (2000, 1)],
  lambda li, f: [f'The client will pay {amt(f[0], li, f[1])} next week', f'ग्राहक से {amt(f[0], li, f[1])} आने वाले हैं', f'ग्राहकाकडून {amt(f[0], li, f[1])} येणार आहेत', f'Client se {amt(f[0], li, f[1])} aane wale hain'][li],
  lambda f: {'kind': 'unclear', 'reason': 'future'})
tpl('refund', 'refund: declined safely', [(1200, 0, 'gas'), (1500, 1, 'tempo'), (500, 0, 'veg'), (2000, 1, 'paneer')],
  lambda li, f: [f'{it(f[2], li)} {amt(f[0], li, f[1])} refunded', f'{it(f[2], li)} के {amt(f[0], li, f[1])} वापस मिले', f'{itc(f[2])} {amt(f[0], li, f[1])} परत मिळाले', f'{it(f[2], li)} ka {amt(f[0], li, f[1])} wapas mila'][li],
  lambda f: {'kind': 'unclear', 'reason': 'refund'})
tpl('multi', 'two amounts: one at a time', [(1200, 0, 4500, 0), (800, 0, 3000, 0), (1500, 1, 2500, 1), (2000, 0, 1400, 1)],
  lambda li, f: [f'Gas {amt(f[0], li, f[1])} cash and vegetables {amt(f[2], li, f[3])} cash', f'गैस {amt(f[0], li, f[1])} नकद और सब्जी {amt(f[2], li, f[3])} नकद',
                 f'गॅस {amt(f[0], li, f[1])} रोख आणि भाजी {amt(f[2], li, f[3])} रोख', f'Gas {amt(f[0], li, f[1])} cash aur sabzi {amt(f[2], li, f[3])} cash'][li],
  lambda f: {'kind': 'multi', 'amounts': [f[0], f[2]]})
tpl('pay-conflict', 'credit and a way of paying: asked', [(1200, 0, 'gas'), (4500, 1, 'veg'), (900, 0, 'tempo'), (2700, 1, 'gas')],
  lambda li, f: [f'{it(f[2], li)} {amt(f[0], li, f[1])} credit UPI', f'{it(f[2], li)} {amt(f[0], li, f[1])} उधार यूपीआई', f'{it(f[2], li)} {amt(f[0], li, f[1])} उधार यूपीआय', f'{it(f[2], li)} {amt(f[0], li, f[1])} udhar UPI'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'pay': '', 'payConflict': True})
tpl('mode-conflict', 'two ways of paying: asked', [(1200, 0, 'gas'), (4500, 1, 'veg'), (900, 0, 'tempo'), (2700, 1, 'gas')],
  lambda li, f: [f'{it(f[2], li)} {amt(f[0], li, f[1])} cash or UPI', f'{it(f[2], li)} {amt(f[0], li, f[1])} नकद या यूपीआई', f'{it(f[2], li)} {amt(f[0], li, f[1])} रोख किंवा यूपीआय', f'{it(f[2], li)} {amt(f[0], li, f[1])} cash ya UPI'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'mode': '', 'modeConflict': True})
tpl('quick-event', 'quick event tomorrow', [(100,), (150,), (80,), (200,)],
  lambda li, f: [f'Birthday tomorrow at Vashi for {f[0]} guests', f'कल वाशी में {f[0]} प्लेट का बर्थडे है', f'उद्या वाशीमध्ये {f[0]} पाहुण्यांचा वाढदिवस आहे', f'Kal Vashi mein {f[0]} plates ka birthday hai'][li],
  lambda f: {'kind': 'event', 'guests': f[0], 'date': '2026-11-29'})
MON = {12: ['Dec', 'दिसंबर', 'डिसेंबर', 'Dec'], 1: ['January', 'जनवरी', 'जानेवारी', 'Jan'], 2: ['Feb', 'फरवरी', 'फेब्रुवारी', 'February']}
tpl('dated-event', 'event on a calendar date', [(12, 12, 2026, 100), (5, 1, 2027, 250), (20, 12, 2026, 80), (15, 2, 2027, 300)],
  lambda li, f: [f'New wedding at Vashi on {f[0]} {MON[f[1]][0]} {f[2]} for {f[3]} guests', f'{f[0]} {MON[f[1]][1]} {f[2]} को वाशी में {f[3]} प्लेट की शादी',
                 f'{f[0]} {MON[f[1]][2]} {f[2]} ला वाशीत {f[3]} पाहुण्यांचे लग्न', f'{f[0]} {MON[f[1]][3]} {f[2]} ko Vashi mein {f[3]} plates ki shaadi'][li],
  lambda f: {'kind': 'event', 'guests': f[3], 'date': f'{f[2]}-{f[1]:02d}-{f[0]:02d}'})
tpl('labour-asked', 'workers asked for', [(15, 1), (20, 0), (12, 1), (8, 0)],
  lambda li, f: [f'Need {num(f[0], li, f[1])} waiters for dinner tomorrow', f'कल डिनर के लिए {num(f[0], li, f[1])} वेटर बुलाओ', f'उद्या डिनरसाठी {num(f[0], li, f[1])} वेटर पाहिजे', f'Dinner ke liye {num(f[0], li, f[1])} boys bulana'][li],
  lambda f: {'kind': 'labour', 'count': f[0], 'labour': 'asked', 'meal': 'dinner'})
tpl('labour-came', 'workers who came', [(12, 1), (15, 0), (20, 1), (8, 0)],
  lambda li, f: [f'{num(f[0], li, f[1])} waiters came for dinner', f'डिनर में {num(f[0], li, f[1])} वेटर आए', f'डिनरला {num(f[0], li, f[1])} वेटर आले', f'Dinner mein {num(f[0], li, f[1])} boys aaye'][li],
  lambda f: {'kind': 'labour', 'count': f[0], 'labour': 'came', 'meal': 'dinner'})
COOKT = {'chinese': (['Chinese cook for noodles and manchurian', 'चाइनीज़ के लिए नूडल्स और मंचूरियन', 'चायनीज साठी नूडल्स आणि मंचुरियन', 'Chinese ke liye noodles aur Manchurian'], 'Chinese Cook – चायनीज आचारी'),
         'sweet': (['Sweets cook for jalebi and gulab jamun', 'मिठाई के लिए जलेबी और गुलाब जामुन', 'मिठाईसाठी जिलेबी आणि गुलाबजाम', 'Mithai ke liye jalebi aur gulab jamun'], 'Sweet Labour – मिठाई मजूर'),
         'roti': (['Roti cook for puri and phulka', 'रोटी के लिए पूरी और फुलका', 'पोळीसाठी पुरी आणि फुलके', 'Roti ke liye puri aur phulka'], 'Roti Cook (Puri / Phulka) – पोळी आचारी')}
PPL = ['people', 'लोग', 'जण', 'log']
tpl('cook', 'cooking work by order', [('chinese', 2, 0), ('sweet', 3, 1), ('roti', 2, 1), ('chinese', 4, 0)],
  lambda li, f: f'{COOKT[f[0]][0][li]}, {num(f[1], li, f[2]) if f[1] in N else f[1]} {PPL[li]}',
  lambda f: {'kind': 'cook', 'people': f[1], 'role': COOKT[f[0]][1]})
tpl('order', 'supplier order of several items', [(25,), (50,), (10,), (20,)],
  lambda li, f: [f'Order {f[0]} kg rice and 10 kg sugar from kirana', f'किराना से {f[0]} किलो चावल और 10 किलो चीनी मंगाओ', f'किराण्याकडून {f[0]} किलो तांदूळ आणि 10 किलो साखर मागवा', f'Kirana wale ko {f[0]} kilo rice aur 10 kilo sugar'][li],
  lambda f: {'kind': 'order', 'items': [[f[0], 'kg'], [10, 'kg']]})
ORDER_NAMES = [['rice', 'sugar'], ['चावल', 'चीनी'], ['तांदूळ', 'साखर'], ['rice', 'sugar']]
tpl('ladi', 'bread in ladi', [(5,), (10,), (3,), (8,)],
  lambda li, f: [f'Order {f[0]} ladi bread', f'ब्रेड की {f[0]} लडी मंगाओ', f'ब्रेडच्या {f[0]} लडी मागवा', f'Bread ki {f[0]} ladi mangao'][li],
  lambda f: {'kind': 'order', 'items': [[f[0], 'ladi']]})
LADI_NAMES = [['bread'], ['ब्रेड'], ['ब्रेड'], ['bread']]
tpl('guests', 'guest count change', [(400,), (450,), (500,), (380,)],
  lambda li, f: [f'Dinner changed from 350 to {f[0]} plates', f'डिनर 350 से {f[0]} प्लेट हो गया', f'डिनर 350 वरून {f[0]} झाले', f'Dinner 350 se {f[0]} plates ho gaya'][li],
  lambda f: {'kind': 'guests', 'from': 350, 'to': f[0]})
NAMES = [('Raj', 'राज'), ('Suresh', 'सुरेश'), ('Mahesh', 'महेश'), ('Ganesh', 'गणेश')]
PHONES = [('9876543210', '9876543210'), ('98765 43210', '9876543210'), ('+91 9123456780', '9123456780'), ('9988776655', '9988776655')]
tpl('new-vendor', 'new vendor with a phone number (never money)', [(0,), (1,), (2,), (3,)],
  lambda li, f: [f'New supplier {NAMES[f[0]][0]} phone {PHONES[f[0]][0]}', f'नया सप्लायर {NAMES[f[0]][1]} फोन {PHONES[f[0]][0]}', f'नवीन सप्लायर {NAMES[f[0]][1]} फोन {PHONES[f[0]][0]}', f'Naya supplier {NAMES[f[0]][0]} add karo phone {PHONES[f[0]][0]}'][li],
  lambda f: {'kind': 'vendor', 'phone': PHONES[f[0]][1], 'amount': 0})
VENDOR_NAMES = lambda li, f: NAMES[f[0]][0 if li in (0, 3) else 1]
tpl('booking', 'booking with its bill and its advance kept apart', [(50, 25000, 5000, 0), (100, 60000, 10000, 0), (80, 40000, 5000, 1), (120, 75000, 2000, 1)],
  lambda li, f: [f'Book birthday tomorrow at Vashi {f[0]} guests bill {f[1]} advance {amt(f[2], li, f[3])} cash', f'कल वाशी में {f[0]} प्लेट का बर्थडे बुक करो, बिल {f[1]}, एडवांस {amt(f[2], li, f[3])} नकद',
                 f'उद्या वाशीमध्ये {f[0]} पाहुण्यांचा वाढदिवस बुक, बिल {f[1]}, ॲडव्हान्स {amt(f[2], li, f[3])} रोख', f'Kal Vashi mein {f[0]} plates ka birthday book karo, bill {f[1]}, advance {amt(f[2], li, f[3])} cash'][li],
  lambda f: {'kind': 'event', 'guests': f[0], 'bill': f[1], 'advance': f[2], 'date': '2026-11-29', 'mode': 'Cash – रोख'})
tpl('yesterday', 'money moved yesterday', [(1500, 0, 'gas', 'cash'), (2000, 1, 'tempo', 'upi'), (800, 0, 'veg', 'cash'), (1400, 1, 'gas', 'cash')],
  lambda li, f: [f'Yesterday {it(f[2], li)} {amt(f[0], li, f[1])} {md(f[3], li)} paid', f'कल {it(f[2], li)} के {amt(f[0], li, f[1])} {md(f[3], li)} दिए',
                 f'काल {itc(f[2])} {amt(f[0], li, f[1])} {md(f[3], li)} दिले', f'Kal {it(f[2], li)} ka {amt(f[0], li, f[1])} {md(f[3], li)} diya'][li],
  lambda f: {'kind': 'expense', 'amount': f[0], 'pay': 'paid', 'date': '2026-11-27'})

out = []
for tid, about, fills, render, expect in T:
    for li, lang in enumerate(LANGS):
        for k, f in enumerate(fills):
            e = expect(f)
            if tid == 'order': e['itemNames'] = ORDER_NAMES[li]
            if tid == 'ladi': e['itemNames'] = LADI_NAMES[li]
            if tid == 'new-vendor': e['name'] = VENDOR_NAMES(li, f)
            out.append({'id': f'{lang}-{tid}-{k + 1}', 'lang': lang, 'about': about, 'text': render(li, f), 'expect': e})
ctx = {'today': '2026-11-28',
  'events': [{'id': 'P', 'name': 'Sample Patil Wedding', 'date': '2026-11-29', 'venue': 'Sample Lawns', 'locality': 'Vashi'},
             {'id': 'D', 'name': 'Sample Desai Reception', 'date': '2026-11-29', 'venue': 'Sample Banquet', 'locality': 'Thane'},
             {'id': 'K', 'name': 'Sample Kulkarni Pooja', 'date': '2026-11-28', 'venue': 'MLA Hall', 'locality': 'Nerul'}],
  'vendors': [{'id': 'ram', 'name': 'Ramesh Mukadam', 'cat': 'Labour', 'specialty': 'Boys – बॉईज'},
              {'id': 'veg', 'name': 'Sample Bhaji Supplier', 'cat': 'Raw Material', 'specialty': 'Vegetable – भाजी'},
              {'id': 'gro', 'name': 'Sample Kirana Store', 'cat': 'Raw Material', 'specialty': 'Grocery – किराणा'},
              {'id': 'bos', 'name': 'Bay of Snacks', 'cat': 'Live Counter', 'specialty': 'Starter – स्टार्टर'}]}
assert len(out) == 416, len(out)
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'voice-corpus.json'), 'w', encoding='utf-8', newline='\n') as fh:
    json.dump({'about': 'CaterDesk multilingual sentence corpus (synthetic). 104 sentences per language: en, hi, mr, hg (Hinglish). Built by build-voice-corpus.py.',
               'context': ctx, 'sentences': out}, fh, ensure_ascii=False, indent=1)
print(len(out), 'sentences')
