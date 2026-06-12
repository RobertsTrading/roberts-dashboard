// Tests the PURE parsing core inside Code.gs against a real CSV export of
// the Weekly Report RT sheet. Expected numbers come from the sheet's own
// labelled "Total:" rows and the verified history in the project brief.
//
// Run:  node test/parser-test.mjs path/to/sheet.csv
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2];
if (!csvPath) { console.error('usage: node parser-test.mjs <sheet.csv>'); process.exit(1); }

// --- load the pure functions straight out of Code.gs (no copy/paste drift) ---
const gs = readFileSync(join(here, '..', 'Code.gs'), 'utf8');
const sandbox = {};
new Function(
  gs + '\nthis.parseWeeks = parseWeeks; this.parseMoney = parseMoney; this.normaliseSource = normaliseSource;'
).call(sandbox);
const { parseWeeks, parseMoney, normaliseSource } = sandbox;

// --- tiny CSV parser (handles quoted fields with commas) ---
function parseCsv(text) {
  const rows = [[]]; let field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { rows.at(-1).push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.at(-1).push(field); field = ''; rows.push([]);
    } else field += c;
  }
  rows.at(-1).push(field);
  if (rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();
  return rows;
}

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.log(`  FAIL ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
  return ok;
};

// --- unit checks: money + source normalisation ---
check('money 70k', parseMoney('70k'), 70000);
check('money $38,341.60', parseMoney('$38,341.60'), 38341.6);
check('money 75,138', parseMoney('75,138'), 75138);
check('money 1160', parseMoney('1160'), 1160);
check('money empty', parseMoney(''), null);
check('money label', parseMoney('Invoice:'), null);
check('src google', normaliseSource('Servicm8 Enquiry (Google search)', 'Amelia'), 'Google');
check('src referral', normaliseSource('Enquiry (referral heritage windows)', 'Angela'), 'Referral');
check('src text-refferal', normaliseSource('Text (refferal)', 'Janie'), 'Text (friend)');
check('src dulux-by-name', normaliseSource('', 'Dulux Enquiry'), 'Dulux Lead');
check('src bare enquiry', normaliseSource('Enquiry', 'Matthew'), 'Enquiry Text');
check('src email variant', normaliseSource('Email (Old client)', 'Cammeray Gardens'), 'Email');

// --- full parse of the real sheet ---
const weeks = parseWeeks(parseCsv(readFileSync(csvPath, 'utf8')));
const sum = (a) => Math.round(a.reduce((t, x) => t + x.value, 0) * 100) / 100;

// [label, enquiryCount, quoteCount, quoteTotal, wonCount, wonTotal, invoice]
const expected = [
  ['14/04 – 17/04', 7, 10, 523230,    1, 2720,   70000],
  ['20/04 – 24/04', 7,  7, 140700,    3, 49300,  38341.6],
  ['28/04 – 01/05', 2,  3, 41870,     4, 118550, 75138],
  // 04/05: duplicate quote #1344 row removed on 12 Jun 2026 at Rafael's request;
  // the sheet's typed "Total:" (270,781.50) still differs — totals are recomputed from rows.
  ['04/05 – 07/05', 3,  7, 285771.5,  3, 31296,  104119],
  ['11/05 – 15/05', 3, 13, 758487.5,  5, 25055,  167855],
  // 18/05: invoice corrected 71,446.10 → 86,446.10 in the sheet on 12 Jun 2026 (missed 15k)
  ['18/05 – 22/05', 6,  8, 183349.32, 1, 9500,   86446.1],
  ['25/05 – 29/05', 6, 10, 213710,    3, 9296,   42526],
  ['01/06 – 05/06', 5,  4, 25625,     3, 26925,  46868],
  ['09/06 – 12/06', 4,  1, 1160,      2, 163393, 0],
];

check('week count', weeks.length, expected.length);
expected.forEach((e, i) => {
  const w = weeks[i];
  if (!w) { failures++; console.log(`  FAIL week ${i} missing`); return; }
  check(`${e[0]} label`, w.weekLabel, e[0]);
  check(`${e[0]} enquiries`, w.enquiries.length, e[1]);
  check(`${e[0]} quote count`, w.quotes.length, e[2]);
  check(`${e[0]} quote total`, sum(w.quotes), e[3]);
  check(`${e[0]} won count`, w.won.length, e[4]);
  check(`${e[0]} won total`, sum(w.won), e[5]);
  check(`${e[0]} invoice`, w.invoiceValue, e[6]);
});

// spot-checks from the brief's verified history
const w7 = weeks[6];
check('25/05 id', w7.id, '2505-2905');
check('25/05 first won', w7.won[0], { id: 'w1', jobNumber: '#1189', value: 4560 });
check('09/06 hash added to bare job number', weeks[8].won[1].jobNumber, '#1362');
check('14/04 sources all SMS/EnquiryText', weeks[0].enquiries.map(e => e.source),
  ['SMS', 'SMS', 'SMS', 'SMS', 'Enquiry Text', 'Enquiry Text', 'SMS']);

if (failures) { console.log(`\n${failures} FAILURES`); process.exit(1); }
console.log(`ALL CHECKS PASSED — ${weeks.length} weeks parsed cleanly`);

// emit seeds for the dashboard's offline fallback
writeFileSync(join(here, 'seeds.json'), JSON.stringify(weeks, null, 1));
console.log('wrote test/seeds.json');
