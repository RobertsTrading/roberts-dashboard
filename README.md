# Roberts Trading — Live Business Dashboard

A live performance dashboard for Roberts Trading Pty Ltd. It reads the
**Weekly Report RT** Google Spreadsheet automatically — update the sheet,
and the dashboard updates itself. No data entry in the dashboard, ever.

## How it works

```
Google Sheet  →  Apps Script web app (returns clean JSON)  →  this dashboard
(you update      (lives inside the sheet, free,                (hosted free on
 it Fridays)      keeps the sheet private)                      GitHub Pages)
```

- The sheet stays **private** — only a small data feed is published, not the sheet itself.
- The feed caches for 5 minutes. The dashboard's **Refresh** button forces a fresh read.
- If the feed is ever unreachable, the dashboard shows the last saved numbers
  with a yellow warning bar — it never goes blank.

## Weekly routine (nothing new to learn)

Update the spreadsheet on Friday like always. That's it. Anyone opening the
dashboard link sees the new numbers (allow up to 5 minutes for the cache,
or press **Refresh**).

## Files

| File | What it is |
|---|---|
| `index.html` | The dashboard. The only thing you might ever edit is `SHEET_API_URL` at the top of the script section. |
| `Code.gs` | The data feed script. A copy lives inside the spreadsheet (Extensions → Apps Script). This file is the backup/reference copy. |
| `test/parser-test.mjs` | Automated test that checks the parser against a CSV export of the sheet. Run: `node test/parser-test.mjs path/to/export.csv` |

## One-time setup (already done, documented for reference)

### 1. The data feed (Apps Script)

1. Open the spreadsheet → **Extensions → Apps Script**
2. Paste the contents of `Code.gs`, save
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web app URL (ends in `/exec`)

### 2. Point the dashboard at the feed

Open `index.html`, find this near the top of the `<script>` section, and paste
the URL between the quotes:

```js
const SHEET_API_URL = 'https://script.google.com/macros/s/.../exec';
```

### 3. Hosting (GitHub Pages)

1. Push this folder to a GitHub repository
2. Repository → **Settings → Pages**
3. Source: **Deploy from a branch**, Branch: **main**, folder **/ (root)**
4. The dashboard goes live at `https://<account>.github.io/<repo>/`

## Updating the feed script later

If the sheet's layout ever changes and the numbers look wrong:

1. Open the sheet → Extensions → Apps Script, update the code
2. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**

⚠️ Use *Manage deployments → New version*, not *New deployment* — a brand-new
deployment gets a **new URL** and the dashboard would stop seeing updates.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Yellow "Could not reach the Google Sheet" bar | The feed URL is missing/wrong in `index.html`, or the deployment was deleted. Re-check `SHEET_API_URL`. |
| Numbers look 5 minutes stale | That's the cache — press **Refresh** on the dashboard. |
| New week not showing | Check the week's header row in the sheet has both dates (e.g. `16/06` and `20/06`) in the first two columns. |
| A week's totals look wrong | The dashboard recomputes totals from the individual rows — check for a stray or duplicate row in that week's block. |

## Sheet format the parser expects

Week blocks stacked vertically. Each block starts with a row containing the
start and end date (`DD/MM`) in the first two columns, followed by rows of:
enquiry name + source (columns B–C), quote number + value (D–E),
`Invoice:` + value (F–G, "70k" shorthand is fine), won value + job number (I–J).
Typed "Total" rows are ignored — totals are always recomputed from the rows.
