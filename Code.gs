/**
 * Roberts Trading — Weekly Report data feed
 * ------------------------------------------
 * Reads the "Weekly Report RT" spreadsheet (week blocks stacked vertically)
 * and serves clean JSON for the dashboard.
 *
 * DEPLOYMENT (one time, from the spreadsheet):
 *   1. Open the spreadsheet → Extensions → Apps Script
 *   2. Delete any code in the editor, paste this entire file, click the save icon
 *   3. Click "Deploy" (top right) → "New deployment"
 *   4. Click the gear icon next to "Select type" → choose "Web app"
 *   5. Set:  Execute as: Me   |   Who has access: Anyone
 *   6. Click "Deploy", approve the permissions screen, copy the Web app URL
 *   7. Paste that URL into SHEET_API_URL at the top of index.html
 *
 * The response is cached for 5 minutes to stay well inside Google's free
 * quotas. Add ?fresh=1 to the URL to bypass the cache (the dashboard's
 * Refresh button does this).
 */

var SHEET_NAME = 'Sheet1';
var CACHE_KEY = 'dashboard_json_v1';
var CACHE_SECONDS = 300; // 5 minutes
var DASHBOARD_URL = 'https://robertstrading.github.io/roberts-dashboard/';

/**
 * Adds a "📊 Dashboard" menu to the spreadsheet so the dashboard can be
 * opened without leaving Google Sheets.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 Dashboard')
    .addItem('Open dashboard', 'showDashboard')
    .addToUi();
}

function showDashboard() {
  var html = HtmlService.createHtmlOutput(
    '<iframe src="' + DASHBOARD_URL + '" style="border:0;position:absolute;top:0;left:0;width:100%;height:100%"></iframe>'
  ).setWidth(1280).setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, 'Roberts Trading — Weekly Performance');
}

function doGet(e) {
  var bypassCache = e && e.parameter && e.parameter.fresh === '1';
  var cache = CacheService.getScriptCache();
  var out = bypassCache ? null : cache.get(CACHE_KEY);
  if (!out) {
    out = JSON.stringify(buildData());
    cache.put(CACHE_KEY, out, CACHE_SECONDS);
  }
  return ContentService.createTextOutput(out)
    .setMimeType(ContentService.MimeType.JSON);
}

function buildData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
  // Display values so we see exactly what the user sees ("70k", "$1,234.50", "25/05")
  var values = sheet.getDataRange().getDisplayValues();
  return {
    weeks: parseWeeks(values),
    lastUpdated: new Date().toISOString()
  };
}

/* ===================== PURE PARSING CORE =====================
 * No Apps Script APIs below this line — this part is unit-tested
 * locally in Node against a CSV export of the sheet.
 *
 * Sheet layout (per week block):
 *   header row : col A = start date DD/MM, col B = end date DD/MM (yellow)
 *   data rows  : B=enquiry name, C=enquiry source,
 *                D=quote number (or "Quotes:"/"Total:" label), E=quote value,
 *                F="Invoice:" label, G=invoice value ("70k" shorthand allowed),
 *                H="Quotes Won:"/"Total" label, I=won value, J=job number
 *   Total rows (labelled "Total:" or an unlabelled green row whose value
 *   equals the running sum) are skipped — totals are recomputed downstream.
 */

function parseWeeks(values) {
  var weeks = [];
  var cur = null;

  for (var r = 0; r < values.length; r++) {
    var row = values[r] || [];
    var cell = function (i) { return row[i] == null ? '' : String(row[i]).trim(); };
    var a = cell(0), b = cell(1);

    // A row with two DD/MM dates starts a new week block
    if (isDayMonth(a) && isDayMonth(b)) {
      cur = {
        id: a.replace('/', '') + '-' + b.replace('/', ''),
        weekLabel: a + ' – ' + b,
        enquiries: [],
        quotes: [],
        won: [],
        invoiceValue: 0
      };
      weeks.push(cur);
      continue;
    }
    if (!cur) continue; // junk above the first block

    // --- Enquiries (col B name, col C source) ---
    // Skip pure numbers (someone sometimes types a count cell) and "Total" labels.
    if (b && !/^\d+(\.\d+)?$/.test(b) && !/^total:?$/i.test(b)) {
      cur.enquiries.push({
        id: 'e' + (cur.enquiries.length + 1),
        name: b.replace(/\.+$/, '').trim(),
        source: normaliseSource(cell(2), b)
      });
    }

    // --- Quotes (col D number/label, col E value) ---
    var dRaw = cell(3);
    var qVal = parseMoney(cell(4));
    if (/total/i.test(dRaw)) {
      // labelled "Total:" row — recomputed instead
    } else if (qVal !== null) {
      var qNumMatch = dRaw.match(/^#?(\d+)$/);
      var qNum = qNumMatch ? qNumMatch[1] : '';
      var qSum = sumValues(cur.quotes);
      // Unlabelled (green) total row: no quote number and value == running sum
      var qIsTotal = !qNum && cur.quotes.length > 1 && Math.abs(qVal - qSum) < 0.01;
      if (!qIsTotal) {
        cur.quotes.push({
          id: 'q' + (cur.quotes.length + 1),
          quoteNumber: qNum,
          value: qVal
        });
      }
    }

    // --- Invoice (col F label, col G value) ---
    if (/^invoice/i.test(cell(5))) {
      var inv = parseMoney(cell(6));
      if (inv !== null) cur.invoiceValue = inv;
    }

    // --- Jobs won (col H label, col I value, col J job number) ---
    var hRaw = cell(7);
    var wVal = parseMoney(cell(8));
    if (/^total:?$/i.test(hRaw)) {
      // labelled won-total row — recomputed instead
    } else if (wVal !== null) {
      var jDigits = (cell(9).match(/\d+/) || [''])[0];
      var wSum = sumValues(cur.won);
      var wIsTotal = !jDigits && cur.won.length > 1 && Math.abs(wVal - wSum) < 0.01;
      if (!wIsTotal) {
        cur.won.push({
          id: 'w' + (cur.won.length + 1),
          jobNumber: jDigits ? '#' + jDigits : '',
          value: wVal
        });
      }
    }
  }
  return weeks;
}

function isDayMonth(s) {
  return /^\d{1,2}\/\d{1,2}$/.test(s);
}

function sumValues(items) {
  var t = 0;
  for (var i = 0; i < items.length; i++) t += items[i].value;
  return t;
}

// "$38,341.60" -> 38341.6   "70k" -> 70000   "75,138" -> 75138   "" -> null
function parseMoney(raw) {
  if (raw == null) return null;
  var s = String(raw).trim();
  if (!s) return null;
  var mult = 1;
  if (/k$/i.test(s)) { mult = 1000; s = s.slice(0, -1); }
  s = s.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * mult * 100) / 100;
}

// Free-text sources -> canonical buckets. Order matters; verified against
// the historical weeks in the project brief.
function normaliseSource(rawSrc, name) {
  var s = (rawSrc || '').trim().toLowerCase();
  var n = (name || '').trim().toLowerCase();
  if (s.indexOf('dulux') !== -1 || n.indexOf('dulux') !== -1) return 'Dulux Lead';
  if (!s) return 'Other';
  if (s.indexOf('google') !== -1) return 'Google';
  if (s === 'sms' || s.indexOf('sms') !== -1) return 'SMS';
  if (s.indexOf('enquiry text') !== -1) return 'Enquiry Text';
  if (s.indexOf('email') === 0) return 'Email';
  if (s.indexOf('call') === 0) return 'Call';
  if (s.indexOf('text') === 0 || s.indexOf('friend') !== -1) return 'Text (friend)';
  if (s.indexOf('referral') !== -1 || s.indexOf('refferal') !== -1) return 'Referral';
  if (s.indexOf('website') !== -1 || s.indexOf('web') === 0) return 'Website';
  if (s.indexOf('enquiry') === 0) return 'Enquiry Text';
  return 'Other';
}
